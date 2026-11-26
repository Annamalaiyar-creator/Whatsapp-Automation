import type { RoutingConfig } from './schema.js';

const workday = [{ from: '09:30', to: '18:30' }];

/**
 * Starting rules for a new client company. Everything here can be changed in the console.
 * Assumes salespeople forward busy / unanswered / switched-off calls from their own SIM to their bot number.
 */
export function defaultRoutingConfig(): RoutingConfig {
  return {
    timezone: 'Asia/Kolkata',
    businessHours: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: workday, sun: [] },
    holidays: [],
    callback: { deadlineMinutes: 30 },
    escalation: {
      levels: [
        { name: 'Backup person', target: { kind: 'backup' }, deadlineMinutes: 30 },
        { name: 'Sales manager', target: { kind: 'role', role: 'manager' }, deadlineMinutes: 30 },
        { name: 'CEO', target: { kind: 'role', role: 'ceo' }, deadlineMinutes: null },
      ],
    },
    rules: [
      {
        id: 'vip',
        name: 'VIP customer: a person answers',
        enabled: true,
        match: 'all',
        conditions: [{ type: 'caller_tag', anyOf: ['vip'] }],
        actions: [
          { type: 'ring', target: { kind: 'backup' }, timeoutSeconds: 20 },
          { type: 'ring', target: { kind: 'role', role: 'manager' }, timeoutSeconds: 20 },
          { type: 'bot_answer' },
          { type: 'create_callback_task', deadlineMinutes: 15 },
          { type: 'notify', target: { kind: 'assigned' }, via: 'whatsapp' },
        ],
      },
      {
        id: 'after-hours',
        name: 'Outside working hours or holiday',
        enabled: true,
        match: 'any',
        conditions: [{ type: 'outside_business_hours' }, { type: 'holiday' }],
        actions: [
          { type: 'bot_answer' },
          { type: 'create_callback_task', deadlineMinutes: 720 },
          { type: 'notify', target: { kind: 'assigned' }, via: 'whatsapp' },
        ],
      },
      {
        id: 'on-leave',
        name: 'Salesperson on leave',
        enabled: true,
        match: 'all',
        conditions: [{ type: 'member_status', in: ['on_leave'] }],
        actions: [
          { type: 'bot_answer' },
          { type: 'create_callback_task' },
          { type: 'notify', target: { kind: 'backup' }, via: 'whatsapp' },
        ],
      },
      {
        id: 'busy',
        name: 'Salesperson busy on another call',
        enabled: true,
        match: 'all',
        conditions: [{ type: 'forward_reason', in: ['busy'] }],
        actions: [
          { type: 'bot_answer' },
          { type: 'create_callback_task' },
          { type: 'notify', target: { kind: 'assigned' }, via: 'whatsapp' },
        ],
      },
      {
        id: 'missed-or-off',
        name: 'Not answered or phone switched off',
        enabled: true,
        match: 'all',
        conditions: [{ type: 'forward_reason', in: ['no_answer', 'unreachable', 'unknown'] }],
        actions: [
          { type: 'bot_answer' },
          { type: 'create_callback_task' },
          { type: 'notify', target: { kind: 'assigned' }, via: 'whatsapp' },
        ],
      },
    ],
    fallback: {
      actions: [
        { type: 'bot_answer' },
        { type: 'create_callback_task' },
        { type: 'notify', target: { kind: 'assigned' }, via: 'whatsapp' },
      ],
    },
  };
}
