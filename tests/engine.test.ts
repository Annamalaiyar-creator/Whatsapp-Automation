import { describe, expect, it } from 'vitest';
import { defaultRoutingConfig } from '../src/routing/defaults.js';
import { decide, type CallContext } from '../src/routing/engine.js';
import { routingConfigSchema, type RoutingConfig } from '../src/routing/schema.js';
import { localTime } from '../src/routing/time.js';

// 2026-12-01 is a Tuesday. India is UTC+05:30.
const tueAt = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00+05:30`);

function ctx(overrides: Partial<CallContext> = {}): CallContext {
  return {
    at: tueAt('11:00'),
    channel: 'phone',
    forwardReason: 'no_answer',
    dialledNumber: '+919000000001',
    caller: { phone: '+919811111111', known: true, tags: [] },
    assignedMember: { id: 'm1', name: 'Salesperson 1', status: 'available' },
    ...overrides,
  };
}

describe('time zone handling', () => {
  it('reads the local weekday and time in the tenant time zone', () => {
    expect(localTime(new Date('2026-12-01T18:45:00Z'), 'Asia/Kolkata')).toEqual({ day: 'wed', time: '00:15', date: '2026-12-02' });
  });
});

describe('default rules', () => {
  const cfg = defaultRoutingConfig();

  it('are valid', () => {
    expect(routingConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('missed call in working hours: bot answers and a callback task is created', () => {
    const d = decide(cfg, ctx());
    expect(d.ruleId).toBe('missed-or-off');
    expect(d.actions.map((a) => a.type)).toEqual(['bot_answer', 'create_callback_task', 'notify']);
  });

  it('busy salesperson: busy rule applies', () => {
    expect(decide(cfg, ctx({ forwardReason: 'busy' })).ruleId).toBe('busy');
  });

  it('switched off: missed-or-off rule applies', () => {
    expect(decide(cfg, ctx({ forwardReason: 'unreachable' })).ruleId).toBe('missed-or-off');
  });

  it('after 18:30 the after-hours rule wins over the missed-call rule', () => {
    expect(decide(cfg, ctx({ at: tueAt('19:40') })).ruleId).toBe('after-hours');
  });

  it('18:30 exactly is already outside working hours', () => {
    expect(decide(cfg, ctx({ at: tueAt('18:30') })).ruleId).toBe('after-hours');
  });

  it('Sunday is outside working hours', () => {
    expect(decide(cfg, ctx({ at: new Date('2026-12-06T11:00:00+05:30') })).ruleId).toBe('after-hours');
  });

  it('a holiday is outside working hours', () => {
    const holiday = { ...cfg, holidays: ['2026-12-01'] };
    expect(decide(holiday, ctx()).ruleId).toBe('after-hours');
  });

  it('salesperson on leave', () => {
    const d = decide(cfg, ctx({ assignedMember: { id: 'm1', name: 'S1', status: 'on_leave' } }));
    expect(d.ruleId).toBe('on-leave');
  });

  it('VIP rule is checked first and rings people before the bot', () => {
    const d = decide(cfg, ctx({ caller: { phone: '+9198', known: true, tags: ['VIP'] }, at: tueAt('20:00') }));
    expect(d.ruleId).toBe('vip');
    expect(d.actions[0]).toMatchObject({ type: 'ring', target: { kind: 'backup' } });
  });

  it('explains every rule it checked', () => {
    const d = decide(cfg, ctx());
    expect(d.trace.map((t) => [t.ruleId, t.status])).toEqual([
      ['vip', 'not_matched'],
      ['after-hours', 'not_matched'],
      ['on-leave', 'not_matched'],
      ['busy', 'not_matched'],
      ['missed-or-off', 'matched'],
    ]);
  });
});

describe('custom rules', () => {
  const base = defaultRoutingConfig();

  it('disabled rules are ignored', () => {
    const cfg: RoutingConfig = { ...base, rules: base.rules.map((r) => (r.id === 'busy' ? { ...r, enabled: false } : r)) };
    const d = decide(cfg, ctx({ forwardReason: 'busy' }));
    expect(d.ruleId).toBeNull();
    expect(d.ruleName).toBe('Otherwise');
    expect(d.trace.find((t) => t.ruleId === 'busy')?.status).toBe('disabled');
  });

  it('rule order decides: moving a rule up changes the result', () => {
    const busyFirst = { ...base, rules: [base.rules[3]!, ...base.rules.filter((r) => r.id !== 'busy')] };
    expect(decide(busyFirst, ctx({ forwardReason: 'busy', at: tueAt('20:00') })).ruleId).toBe('busy');
  });

  it('"any" matches when one condition is true, "all" needs every one', () => {
    const rule = {
      id: 'x', name: 'x', enabled: true, conditions: [{ type: 'channel' as const, in: ['whatsapp_call' as const] }, { type: 'caller_known' as const, value: false }],
      actions: [{ type: 'bot_answer' as const }],
    };
    expect(decide({ ...base, rules: [{ ...rule, match: 'any' }] }, ctx()).ruleId).toBeNull();
    expect(decide({ ...base, rules: [{ ...rule, match: 'any' }] }, ctx({ channel: 'whatsapp_call' })).ruleId).toBe('x');
    expect(decide({ ...base, rules: [{ ...rule, match: 'all' }] }, ctx({ channel: 'whatsapp_call' })).ruleId).toBeNull();
  });

  it('time window, dialled number and language conditions', () => {
    const cfg: RoutingConfig = {
      ...base,
      rules: [
        { id: 'lunch', name: 'Lunch', enabled: true, match: 'all', conditions: [{ type: 'time_window', days: ['tue'], from: '13:00', to: '14:00' }], actions: [{ type: 'bot_answer' }] },
        { id: 'service', name: 'Service line', enabled: true, match: 'all', conditions: [{ type: 'dialled_number', in: ['+919000000099'] }], actions: [{ type: 'bot_answer' }] },
        { id: 'tamil', name: 'Tamil', enabled: true, match: 'all', conditions: [{ type: 'language', in: ['ta'] }], actions: [{ type: 'bot_answer' }] },
      ],
    };
    expect(decide(cfg, ctx({ at: tueAt('13:30') })).ruleId).toBe('lunch');
    expect(decide(cfg, ctx({ dialledNumber: '+919000000099' })).ruleId).toBe('service');
    expect(decide(cfg, ctx({ caller: { phone: '+91', known: true, tags: [], language: 'TA' } })).ruleId).toBe('tamil');
  });
});

describe('safety adjustments', () => {
  const base = defaultRoutingConfig();
  const ringAssigned: RoutingConfig = {
    ...base,
    rules: [{ id: 'r', name: 'Ring salesperson', enabled: true, match: 'all', conditions: [{ type: 'caller_known', value: true }], actions: [{ type: 'ring', target: { kind: 'assigned' }, timeoutSeconds: 20 }] }],
  };

  it('a forwarded call never rings the salesperson it came from, and the bot answers instead', () => {
    const d = decide(ringAssigned, ctx({ forwardReason: 'busy' }));
    expect(d.actions).toEqual([{ type: 'bot_answer' }]);
    expect(d.notes).toHaveLength(2);
  });

  it('a direct call may ring the assigned salesperson', () => {
    const d = decide(ringAssigned, ctx({ forwardReason: null }));
    expect(d.actions).toEqual([{ type: 'ring', target: { kind: 'assigned' }, timeoutSeconds: 20 }]);
    expect(d.notes).toEqual([]);
  });
});

describe('validation', () => {
  const base = defaultRoutingConfig();

  it('rejects a rule that nobody answers', () => {
    const bad = { ...base, rules: [{ ...base.rules[0]!, actions: [{ type: 'create_callback_task' }] }] };
    const r = routingConfigSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/needs an action that answers/);
  });

  it('rejects duplicate rule ids, bad times and bad time zones', () => {
    expect(routingConfigSchema.safeParse({ ...base, rules: [base.rules[0], base.rules[0]] }).success).toBe(false);
    expect(routingConfigSchema.safeParse({ ...base, businessHours: { ...base.businessHours, mon: [{ from: '18:00', to: '09:00' }] } }).success).toBe(false);
    expect(routingConfigSchema.safeParse({ ...base, timezone: 'Mars/Base' }).success).toBe(false);
  });

  it('only the last escalation level may have no deadline', () => {
    const levels = [{ ...base.escalation.levels[2]! }, base.escalation.levels[0]!];
    expect(routingConfigSchema.safeParse({ ...base, escalation: { levels } }).success).toBe(false);
  });
});
