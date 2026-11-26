import type { Client } from '../db.js';
import { decide, type CallContext, type Decision } from '../routing/engine.js';
import type { Channel, ForwardReason, RoutingConfig } from '../routing/schema.js';
import { resolveTarget, type Member } from '../routing/targets.js';
import { localTime } from '../routing/time.js';
import { getActiveConfig, listBotNumbers, listMembers } from '../repo.js';

export interface IncomingCall {
  at: Date;
  channel: Channel;
  botNumberId: string | null;
  forwardReason: ForwardReason | null;
  callerPhone: string;
  /** Until a CRM connector is attached, caller details come from the request. */
  callerKnown: boolean;
  callerTags: string[];
  language: string | null;
}

export class NotConfiguredError extends Error {}

/** Builds the rule context for a call: which salesperson the bot number belongs to, and their status. */
export async function buildContext(c: Client, call: IncomingCall) {
  const [members, numbers] = await Promise.all([listMembers(c), listBotNumbers(c)]);
  const number = call.botNumberId ? numbers.find((n) => n.id === call.botNumberId) ?? null : null;
  if (call.botNumberId && !number) throw new NotConfiguredError('That bot number does not exist');
  const assigned = number?.teamMemberId ? members.find((m) => m.id === number.teamMemberId) ?? null : null;
  const ctx: CallContext = {
    at: call.at,
    channel: call.channel,
    forwardReason: call.forwardReason,
    dialledNumber: number?.e164 ?? '',
    caller: { phone: call.callerPhone, known: call.callerKnown, tags: call.callerTags, language: call.language },
    assignedMember: assigned ? { id: assigned.id, name: assigned.name, status: assigned.status } : null,
  };
  return { ctx, members, number, assigned };
}

/** Who would actually be rung or notified, in words, so the tester can show the real people. */
export function describeOutcome(decision: Decision, assigned: Member | null, members: Member[], cfg: RoutingConfig) {
  return decision.actions.map((a) => {
    switch (a.type) {
      case 'bot_answer':
        return 'The AI assistant answers.';
      case 'ring': {
        const who = resolveTarget(a.target, assigned, members);
        return who ? `Ring ${who.name} for ${a.timeoutSeconds} seconds.` : `Ring: nobody available for "${a.target.kind}", so this step is skipped.`;
      }
      case 'create_callback_task': {
        const mins = a.deadlineMinutes ?? cfg.callback.deadlineMinutes;
        return `If no person answered: create a callback task for ${assigned?.name ?? 'the first escalation level'}, due in ${mins} minutes.`;
      }
      case 'notify': {
        const who = resolveTarget(a.target, assigned, members);
        return who ? `If no person answered: send ${who.name} a ${a.via === 'sms' ? 'SMS' : 'WhatsApp'} message.` : 'Notify: nobody available, skipped.';
      }
    }
  });
}

function fmtLocal(d: Date, cfg: RoutingConfig) {
  const l = localTime(d, cfg.timezone);
  return `${l.date} ${l.time}`;
}

/**
 * Records a call and carries out its after-call actions. A telephony adapter will call this when a call ends;
 * the console calls it to simulate a call. Callback tasks and notifications only happen when no person answered.
 */
export async function recordCall(c: Client, tenantId: string, call: IncomingCall, humanAnswered: boolean, simulated: boolean) {
  const active = await getActiveConfig(c);
  if (!active) throw new NotConfiguredError('No routing rules saved yet');
  const { ctx, members, number, assigned } = await buildContext(c, call);
  const decision = decide(active.config, ctx);

  const callRow = await c.query(
    `INSERT INTO calls (tenant_id, channel, bot_number_id, team_member_id, caller_phone, forward_reason, config_version, decision, human_answered, simulated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [tenantId, call.channel, number?.id ?? null, assigned?.id ?? null, call.callerPhone, call.forwardReason, active.version, JSON.stringify(decision), humanAnswered, simulated],
  );
  const callId = callRow.rows[0].id as string;

  let taskId: string | null = null;
  if (!humanAnswered) {
    const taskAction = decision.actions.find((a) => a.type === 'create_callback_task');
    const owner = assigned && assigned.status !== 'on_leave' ? assigned : null;
    const minutes = (taskAction?.type === 'create_callback_task' && taskAction.deadlineMinutes) || active.config.callback.deadlineMinutes;
    const due = new Date(call.at.getTime() + minutes * 60_000);
    if (taskAction) {
      const t = await c.query(
        `INSERT INTO tasks (tenant_id, call_id, caller_phone, original_member_id, assigned_member_id, escalation_level, due_at, note)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7) RETURNING id`,
        // With no usable owner the task starts overdue, so the escalation check routes it to the first available level.
        [tenantId, callId, call.callerPhone, assigned?.id ?? null, owner?.id ?? null, owner ? due : call.at, `Call handled by AI (${decision.ruleName})`],
      );
      taskId = t.rows[0].id;
    }
    for (const a of decision.actions) {
      if (a.type !== 'notify') continue;
      const who = resolveTarget(a.target, assigned, members);
      if (!who) continue;
      const callBack = taskId && owner ? ` Please call back by ${fmtLocal(due, active.config)}.` : '';
      await c.query(
        `INSERT INTO notifications (tenant_id, task_id, member_id, via, message) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, taskId, who.id, a.via, `Missed call from ${call.callerPhone} was answered by the AI assistant (${decision.ruleName}).${callBack}`],
      );
    }
  }
  return { callId, taskId, decision, configVersion: active.version };
}
