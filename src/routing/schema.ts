import { z } from 'zod';

export const CHANNELS = ['phone', 'whatsapp_call', 'whatsapp_chat'] as const;
export const FORWARD_REASONS = ['busy', 'no_answer', 'unreachable', 'unknown'] as const;
export const MEMBER_STATUSES = ['available', 'away', 'on_leave'] as const;
export const MEMBER_ROLES = ['salesperson', 'manager', 'ceo', 'support'] as const;
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type Channel = (typeof CHANNELS)[number];
export type ForwardReason = (typeof FORWARD_REASONS)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type Day = (typeof DAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, for example 09:30');
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, for example +919876543210');
const minutes = z.number().int().min(1).max(10080);

const timeRange = z
  .object({ from: hhmm, to: hhmm })
  .refine((r) => r.from < r.to, { message: 'Start time must be before end time. Split overnight hours into two ranges.' });

/** Who an action or escalation level points at. */
export const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assigned') }),
  z.object({ kind: z.literal('backup') }),
  z.object({ kind: z.literal('role'), role: z.enum(MEMBER_ROLES) }),
  z.object({ kind: z.literal('member'), memberId: z.uuid() }),
]);
export type Target = z.infer<typeof targetSchema>;

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('outside_business_hours') }),
  z.object({ type: z.literal('within_business_hours') }),
  z.object({ type: z.literal('holiday') }),
  z.object({ type: z.literal('time_window'), days: z.array(z.enum(DAYS)).min(1), from: hhmm, to: hhmm }),
  z.object({ type: z.literal('forward_reason'), in: z.array(z.enum(FORWARD_REASONS)).min(1) }),
  z.object({ type: z.literal('not_forwarded') }),
  z.object({ type: z.literal('member_status'), in: z.array(z.enum(MEMBER_STATUSES)).min(1) }),
  z.object({ type: z.literal('caller_tag'), anyOf: z.array(z.string().trim().min(1).max(40)).min(1).max(20) }),
  z.object({ type: z.literal('caller_known'), value: z.boolean() }),
  z.object({ type: z.literal('channel'), in: z.array(z.enum(CHANNELS)).min(1) }),
  z.object({ type: z.literal('dialled_number'), in: z.array(e164).min(1).max(50) }),
  z.object({ type: z.literal('language'), in: z.array(z.string().trim().min(2).max(10)).min(1).max(20) }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bot_answer') }),
  z.object({ type: z.literal('ring'), target: targetSchema, timeoutSeconds: z.number().int().min(5).max(120) }),
  z.object({ type: z.literal('create_callback_task'), deadlineMinutes: minutes.optional() }),
  z.object({ type: z.literal('notify'), target: targetSchema, via: z.enum(['whatsapp', 'sms']) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/, 'Rule id may only use a-z, 0-9, _ and -'),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  match: z.enum(['all', 'any']),
  conditions: z.array(conditionSchema).min(1, 'Add at least one condition').max(20),
  actions: z.array(actionSchema).min(1, 'Add at least one action').max(10),
});
export type Rule = z.infer<typeof ruleSchema>;

export const escalationLevelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  target: targetSchema,
  /** Minutes this level has to finish the callback before it moves on. null = last stop. */
  deadlineMinutes: minutes.nullable(),
});
export type EscalationLevel = z.infer<typeof escalationLevelSchema>;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const dayHours = z.array(timeRange).max(4);

export const routingConfigSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, 'Unknown time zone, for example Asia/Kolkata'),
    businessHours: z.object({
      mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours,
    }),
    holidays: z.array(z.iso.date()).max(366),
    callback: z.object({ deadlineMinutes: minutes }),
    escalation: z.object({ levels: z.array(escalationLevelSchema).max(6) }),
    rules: z.array(ruleSchema).max(50),
    fallback: z.object({ actions: z.array(actionSchema).min(1).max(10) }),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    cfg.rules.forEach((rule, i) => {
      if (ids.has(rule.id)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'id'], message: `Two rules use the id "${rule.id}"` });
      ids.add(rule.id);
      if (!rule.actions.some(isAnswerAction)) {
        ctx.addIssue({ code: 'custom', path: ['rules', i, 'actions'], message: `"${rule.name}" needs an action that answers the call: the bot answers, or ring someone` });
      }
      rule.conditions.forEach((c, j) => {
        if (c.type === 'time_window' && c.from >= c.to) {
          ctx.addIssue({ code: 'custom', path: ['rules', i, 'conditions', j], message: 'Start time must be before end time' });
        }
      });
    });
    if (!cfg.fallback.actions.some(isAnswerAction)) {
      ctx.addIssue({ code: 'custom', path: ['fallback', 'actions'], message: 'The "otherwise" rule needs an action that answers the call' });
    }
    cfg.escalation.levels.forEach((level, i) => {
      if (level.deadlineMinutes === null && i < cfg.escalation.levels.length - 1) {
        ctx.addIssue({ code: 'custom', path: ['escalation', 'levels', i, 'deadlineMinutes'], message: 'Only the last level can have no deadline' });
      }
    });
  });
export type RoutingConfig = z.infer<typeof routingConfigSchema>;

export function isAnswerAction(a: Action): boolean {
  return a.type === 'bot_answer' || a.type === 'ring';
}

/** Validation errors as readable { path, message } pairs for the console. */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
