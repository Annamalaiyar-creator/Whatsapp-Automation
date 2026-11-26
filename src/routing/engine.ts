import type { Action, Channel, Condition, ForwardReason, MemberStatus, Rule, RoutingConfig } from './schema.js';
import { isAnswerAction } from './schema.js';
import { isHoliday, isWithinBusinessHours, localTime, type LocalTime } from './time.js';

/** Everything the rules can look at for one incoming call or chat. */
export interface CallContext {
  at: Date;
  channel: Channel;
  /** Why the call reached the bot. null = the customer dialled the bot or business number directly. */
  forwardReason: ForwardReason | null;
  dialledNumber: string;
  caller: {
    phone: string;
    known: boolean;
    tags: string[];
    language?: string | null;
  };
  /** The salesperson this bot number belongs to, if any. */
  assignedMember: { id: string; name: string; status: MemberStatus } | null;
}

export interface ConditionTrace {
  type: Condition['type'];
  result: boolean;
  detail: string;
}

export interface RuleTrace {
  ruleId: string;
  ruleName: string;
  status: 'matched' | 'not_matched' | 'disabled' | 'skipped';
  conditions: ConditionTrace[];
}

export interface Decision {
  /** The rule that decided, or null when the "otherwise" rule was used. */
  ruleId: string | null;
  ruleName: string;
  actions: Action[];
  /** Safety adjustments the engine made to the chosen actions. */
  notes: string[];
  localTime: LocalTime;
  trace: RuleTrace[];
}

const FALLBACK_NAME = 'Otherwise';

function evalCondition(c: Condition, ctx: CallContext, cfg: RoutingConfig, local: LocalTime): ConditionTrace {
  const at = `${local.day} ${local.date} ${local.time} (${cfg.timezone})`;
  switch (c.type) {
    case 'outside_business_hours': {
      const within = isWithinBusinessHours(cfg, local);
      return { type: c.type, result: !within, detail: `${at} is ${within ? 'within' : 'outside'} working hours` };
    }
    case 'within_business_hours': {
      const within = isWithinBusinessHours(cfg, local);
      return { type: c.type, result: within, detail: `${at} is ${within ? 'within' : 'outside'} working hours` };
    }
    case 'holiday': {
      const h = isHoliday(cfg, local);
      return { type: c.type, result: h, detail: `${local.date} is ${h ? '' : 'not '}a holiday` };
    }
    case 'time_window': {
      const hit = c.days.includes(local.day) && local.time >= c.from && local.time < c.to;
      return { type: c.type, result: hit, detail: `${at} vs ${c.days.join(',')} ${c.from}-${c.to}` };
    }
    case 'forward_reason': {
      const hit = ctx.forwardReason !== null && c.in.includes(ctx.forwardReason);
      return { type: c.type, result: hit, detail: `forwarded because: ${ctx.forwardReason ?? 'not forwarded'}` };
    }
    case 'not_forwarded':
      return { type: c.type, result: ctx.forwardReason === null, detail: `forwarded because: ${ctx.forwardReason ?? 'not forwarded'}` };
    case 'member_status': {
      if (!ctx.assignedMember) return { type: c.type, result: false, detail: 'no salesperson linked to this number' };
      const hit = c.in.includes(ctx.assignedMember.status);
      return { type: c.type, result: hit, detail: `${ctx.assignedMember.name} is ${ctx.assignedMember.status}` };
    }
    case 'caller_tag': {
      const tags = ctx.caller.tags.map((t) => t.toLowerCase());
      const hit = c.anyOf.some((t) => tags.includes(t.toLowerCase()));
      return { type: c.type, result: hit, detail: `caller tags: ${ctx.caller.tags.join(', ') || 'none'}` };
    }
    case 'caller_known':
      return { type: c.type, result: ctx.caller.known === c.value, detail: `caller is ${ctx.caller.known ? 'a known' : 'an unknown'} contact` };
    case 'channel':
      return { type: c.type, result: c.in.includes(ctx.channel), detail: `channel: ${ctx.channel}` };
    case 'dialled_number':
      return { type: c.type, result: c.in.includes(ctx.dialledNumber), detail: `dialled: ${ctx.dialledNumber}` };
    case 'language': {
      const lang = ctx.caller.language?.toLowerCase() ?? null;
      const hit = lang !== null && c.in.some((l) => l.toLowerCase() === lang);
      return { type: c.type, result: hit, detail: `language: ${lang ?? 'not known yet'}` };
    }
  }
}

function evalRule(rule: Rule, ctx: CallContext, cfg: RoutingConfig, local: LocalTime): RuleTrace {
  const conditions = rule.conditions.map((c) => evalCondition(c, ctx, cfg, local));
  const matched = rule.match === 'all' ? conditions.every((c) => c.result) : conditions.some((c) => c.result);
  return { ruleId: rule.id, ruleName: rule.name, status: matched ? 'matched' : 'not_matched', conditions };
}

/**
 * Applies safety adjustments that rules can't switch off:
 * - A forwarded call must never ring the salesperson it came from (that would loop straight back).
 * - Every decision ends with someone answering; if nothing would, the bot answers.
 */
function applySafety(actions: Action[], ctx: CallContext): { actions: Action[]; notes: string[] } {
  const notes: string[] = [];
  let result = actions;
  if (ctx.forwardReason !== null) {
    const before = result.length;
    result = result.filter((a) => !(a.type === 'ring' && a.target.kind === 'assigned'));
    if (result.length !== before) {
      notes.push('Skipped "ring the assigned salesperson": this call was forwarded from their phone, so ringing them again would loop.');
    }
  }
  if (!result.some(isAnswerAction)) {
    result = [{ type: 'bot_answer' }, ...result];
    notes.push('No one else was left to answer, so the bot answers.');
  }
  return { actions: result, notes };
}

/** Decides who handles a call. Rules are checked top to bottom; the first matching enabled rule wins. */
export function decide(cfg: RoutingConfig, ctx: CallContext): Decision {
  const local = localTime(ctx.at, cfg.timezone);
  const trace: RuleTrace[] = [];
  let chosen: Rule | null = null;

  for (const rule of cfg.rules) {
    if (chosen) {
      trace.push({ ruleId: rule.id, ruleName: rule.name, status: 'skipped', conditions: [] });
      continue;
    }
    if (!rule.enabled) {
      trace.push({ ruleId: rule.id, ruleName: rule.name, status: 'disabled', conditions: [] });
      continue;
    }
    const t = evalRule(rule, ctx, cfg, local);
    trace.push(t);
    if (t.status === 'matched') chosen = rule;
  }

  const { actions, notes } = applySafety(chosen ? chosen.actions : cfg.fallback.actions, ctx);
  return {
    ruleId: chosen?.id ?? null,
    ruleName: chosen?.name ?? FALLBACK_NAME,
    actions,
    notes,
    localTime: local,
    trace,
  };
}
