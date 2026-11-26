// Call routing console. Plain JS, no build step. All text goes through textContent, never innerHTML.

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const REASONS = [['busy', 'Busy on another call'], ['no_answer', 'Not answered'], ['unreachable', 'Switched off / unreachable'], ['unknown', 'Forwarded, reason unknown']];
const STATUSES = [['available', 'Available'], ['away', 'Away'], ['on_leave', 'On leave']];
const CHANNELS = [['phone', 'Phone call'], ['whatsapp_call', 'WhatsApp call'], ['whatsapp_chat', 'WhatsApp chat']];
const ROLES = [['salesperson', 'Salesperson'], ['manager', 'Manager'], ['ceo', 'CEO'], ['support', 'Support']];

const CONDITIONS = {
  forward_reason: { label: 'Call was forwarded because', make: () => ({ in: ['no_answer'] }) },
  not_forwarded: { label: 'Customer dialled the bot number directly', make: () => ({}) },
  outside_business_hours: { label: 'Outside working hours', make: () => ({}) },
  within_business_hours: { label: 'During working hours', make: () => ({}) },
  holiday: { label: 'Today is a holiday', make: () => ({}) },
  time_window: { label: 'Time window', make: () => ({ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], from: '13:00', to: '14:00' }) },
  member_status: { label: 'Salesperson status is', make: () => ({ in: ['on_leave'] }) },
  caller_tag: { label: 'Customer has tag', make: () => ({ anyOf: ['vip'] }) },
  caller_known: { label: 'Customer is', make: () => ({ value: false }) },
  channel: { label: 'Channel is', make: () => ({ in: ['phone'] }) },
  dialled_number: { label: 'Number dialled is', make: () => ({ in: ['+91'] }) },
  language: { label: 'Customer language is', make: () => ({ in: ['ta'] }) },
};
const ACTIONS = {
  bot_answer: { label: 'AI assistant answers', make: () => ({}) },
  ring: { label: 'Ring', make: () => ({ target: { kind: 'backup' }, timeoutSeconds: 20 }) },
  create_callback_task: { label: 'Create callback task', make: () => ({}) },
  notify: { label: 'Send a message to', make: () => ({ target: { kind: 'assigned' }, via: 'whatsapp' }) },
};

const state = {
  me: null,
  tab: 'rules',
  active: null,
  draft: null,
  team: [],
  numbers: [],
  versions: [],
  editingId: null,
  issues: [],
  saveNote: '',
  test: null,
  testForm: null,
  tasks: [],
  notifications: [],
  calls: [],
};

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.issues = data.issues || [];
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const isDirty = () => state.active && state.draft && JSON.stringify(state.draft) !== JSON.stringify(state.active.config);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const canEdit = () => state.me && ['owner', 'manager'].includes(state.me.role);
const labelOf = (pairs, v) => pairs.find(([k]) => k === v)?.[1] ?? v;
const memberName = (id) => state.team.find((m) => m.id === id)?.name ?? 'removed person';

function update(fn) {
  fn();
  render();
}

function targetText(t) {
  switch (t.kind) {
    case 'assigned': return 'the assigned salesperson';
    case 'backup': return 'their backup person';
    case 'role': return `the ${labelOf(ROLES, t.role).toLowerCase()}`;
    case 'member': return memberName(t.memberId);
    default: return '?';
  }
}

function conditionText(c) {
  const list = (pairs, vals) => vals.map((v) => labelOf(pairs, v).toLowerCase()).join(' or ');
  switch (c.type) {
    case 'forward_reason': return `call forwarded because ${list(REASONS, c.in)}`;
    case 'not_forwarded': return 'customer dialled the bot number directly';
    case 'outside_business_hours': return 'outside working hours';
    case 'within_business_hours': return 'during working hours';
    case 'holiday': return 'today is a holiday';
    case 'time_window': return `${c.days.map((d) => labelOf(DAYS, d)).join(', ')} ${c.from}–${c.to}`;
    case 'member_status': return `salesperson is ${list(STATUSES, c.in)}`;
    case 'caller_tag': return `customer tagged ${c.anyOf.join(' or ')}`;
    case 'caller_known': return c.value ? 'customer is already known' : 'customer is new / unknown';
    case 'channel': return `channel is ${list(CHANNELS, c.in)}`;
    case 'dialled_number': return `dialled ${c.in.join(' or ')}`;
    case 'language': return `language is ${c.in.join(' or ')}`;
    default: return c.type;
  }
}

function actionText(a, cfg) {
  switch (a.type) {
    case 'bot_answer': return 'AI assistant answers';
    case 'ring': return `ring ${targetText(a.target)} for ${a.timeoutSeconds}s`;
    case 'create_callback_task': return `callback task, due in ${a.deadlineMinutes ?? cfg.callback.deadlineMinutes} min`;
    case 'notify': return `${a.via === 'sms' ? 'SMS' : 'WhatsApp'} ${targetText(a.target)}`;
    default: return a.type;
  }
}

// ---------- small form controls ----------

function checkGroup(pairs, selected, onChange) {
  return h('span', {}, pairs.map(([v, label]) =>
    h('label', { class: 'inline' },
      h('input', {
        type: 'checkbox', checked: selected.includes(v), disabled: !canEdit(),
        onchange: (e) => {
          const next = e.target.checked ? [...selected, v] : selected.filter((x) => x !== v);
          if (next.length === 0) { e.target.checked = true; toast('Pick at least one'); return; }
          onChange(pairs.map(([k]) => k).filter((k) => next.includes(k)));
        },
      }),
      label)));
}

function listInput(values, placeholder, onChange) {
  return h('input', {
    value: values.join(', '), placeholder, disabled: !canEdit(), 'aria-label': placeholder,
    onchange: (e) => {
      const next = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (next.length === 0) { toast('Enter at least one value'); render(); return; }
      onChange(next);
    },
  });
}

function select(pairs, value, onChange, label) {
  return h('select', { onchange: (e) => onChange(e.target.value), disabled: !canEdit(), 'aria-label': label },
    pairs.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function targetSelect(target, onChange) {
  const pairs = [
    ['assigned', 'Assigned salesperson'],
    ['backup', 'Their backup person'],
    ...ROLES.map(([r, l]) => [`role:${r}`, `Any ${l.toLowerCase()}`]),
    ...state.team.filter((m) => m.active).map((m) => [`member:${m.id}`, m.name]),
  ];
  const value = target.kind === 'role' ? `role:${target.role}` : target.kind === 'member' ? `member:${target.memberId}` : target.kind;
  return select(pairs, value, (v) => {
    if (v.startsWith('role:')) onChange({ kind: 'role', role: v.slice(5) });
    else if (v.startsWith('member:')) onChange({ kind: 'member', memberId: v.slice(7) });
    else onChange({ kind: v });
  }, 'Who');
}

function numberInput(value, { min, max, placeholder, label }, onChange) {
  return h('input', {
    type: 'number', min, max, value: value ?? '', placeholder, disabled: !canEdit(), class: 'w-num', 'aria-label': label,
    onchange: (e) => {
      const raw = e.target.value.trim();
      if (raw === '') return onChange(null);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) { toast(`Enter a whole number from ${min} to ${max}`); render(); return; }
      onChange(n);
    },
  });
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// ---------- rules tab ----------

function conditionEditor(c, onChange) {
  switch (c.type) {
    case 'forward_reason': return checkGroup(REASONS, c.in, (v) => onChange({ ...c, in: v }));
    case 'member_status': return checkGroup(STATUSES, c.in, (v) => onChange({ ...c, in: v }));
    case 'channel': return checkGroup(CHANNELS, c.in, (v) => onChange({ ...c, in: v }));
    case 'caller_tag': return listInput(c.anyOf, 'Tags, comma separated', (v) => onChange({ ...c, anyOf: v }));
    case 'dialled_number': return listInput(c.in, 'Numbers like +919876543210', (v) => onChange({ ...c, in: v }));
    case 'language': return listInput(c.in, 'Language codes like ta, hi, en', (v) => onChange({ ...c, in: v }));
    case 'caller_known': return select([['true', 'Already known'], ['false', 'New / unknown']], String(c.value), (v) => onChange({ ...c, value: v === 'true' }), 'Customer');
    case 'time_window': return h('span', { class: 'row' },
      checkGroup(DAYS, c.days, (v) => onChange({ ...c, days: v })),
      h('input', { type: 'time', value: c.from, disabled: !canEdit(), 'aria-label': 'From', onchange: (e) => onChange({ ...c, from: e.target.value }) }),
      'to',
      h('input', { type: 'time', value: c.to, disabled: !canEdit(), 'aria-label': 'To', onchange: (e) => onChange({ ...c, to: e.target.value }) }));
    default: return null;
  }
}

function actionEditor(a, cfg, onChange) {
  switch (a.type) {
    case 'ring': return h('span', { class: 'row' },
      targetSelect(a.target, (t) => onChange({ ...a, target: t })),
      'for', numberInput(a.timeoutSeconds, { min: 5, max: 120, label: 'Seconds' }, (n) => onChange({ ...a, timeoutSeconds: n ?? 20 })), 'seconds');
    case 'create_callback_task': return h('span', { class: 'row' },
      'due in', numberInput(a.deadlineMinutes, { min: 1, max: 10080, placeholder: String(cfg.callback.deadlineMinutes), label: 'Minutes' },
        (n) => onChange(n === null ? { type: a.type } : { ...a, deadlineMinutes: n })), 'minutes',
      h('span', { class: 'muted small' }, '(empty = default)'));
    case 'notify': return h('span', { class: 'row' },
      targetSelect(a.target, (t) => onChange({ ...a, target: t })),
      'by', select([['whatsapp', 'WhatsApp'], ['sms', 'SMS']], a.via, (v) => onChange({ ...a, via: v }), 'How'));
    default: return null;
  }
}

function actionsEditor(actions, cfg) {
  return h('div', {},
    h('h3', {}, 'Then'),
    h('p', { class: 'muted small' }, 'Steps run in order. Ringing stops at the first person who answers. Callback tasks and messages only happen if no person answered.'),
    actions.map((a, i) => h('div', { class: 'line' },
      h('span', { class: 'num' }, `${i + 1}.`),
      select(Object.entries(ACTIONS).map(([k, v]) => [k, v.label]), a.type,
        (t) => update(() => { actions[i] = { type: t, ...ACTIONS[t].make() }; }), 'Action'),
      actionEditor(a, cfg, (next) => update(() => { actions[i] = next; })),
      canEdit() && h('span', { class: 'row' },
        h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move step up', disabled: i === 0, onclick: () => update(() => moveItem(actions, i, -1)) }, '↑'),
        h('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move step down', disabled: i === actions.length - 1, onclick: () => update(() => moveItem(actions, i, 1)) }, '↓'),
        h('button', { class: 'icon danger', 'aria-label': 'Remove step', disabled: actions.length === 1, onclick: () => update(() => actions.splice(i, 1)) }, '✕')))),
    canEdit() && actions.length < 10 && h('button', { onclick: () => update(() => actions.push({ type: 'notify', ...ACTIONS.notify.make() })) }, '+ Add step'));
}

function ruleCard(rule, i, rules, cfg) {
  const editing = state.editingId === rule.id;
  const joiner = rule.match === 'all' ? ' and ' : ' or ';
  return h('div', { class: `card${rule.enabled ? '' : ' off'}` },
    h('div', { class: 'row' },
      h('span', { class: 'num' }, `${i + 1}`),
      h('h3', { class: 'rule-title' }, rule.name),
      h('label', { class: 'inline small' },
        h('input', { type: 'checkbox', checked: rule.enabled, disabled: !canEdit(), onchange: (e) => update(() => { rule.enabled = e.target.checked; }) }),
        rule.enabled ? 'On' : 'Off'),
      canEdit() && h('button', { class: 'icon', 'aria-label': 'Move rule up', title: 'Move up', disabled: i === 0, onclick: () => update(() => moveItem(rules, i, -1)) }, '↑'),
      canEdit() && h('button', { class: 'icon', 'aria-label': 'Move rule down', title: 'Move down', disabled: i === rules.length - 1, onclick: () => update(() => moveItem(rules, i, 1)) }, '↓'),
      h('button', { onclick: () => update(() => { state.editingId = editing ? null : rule.id; }) }, editing ? 'Close' : canEdit() ? 'Edit' : 'View'),
      canEdit() && h('button', { class: 'danger', onclick: () => { if (confirm(`Delete the rule "${rule.name}"?`)) update(() => rules.splice(i, 1)); } }, 'Delete')),
    h('div', { class: 'summary' },
      h('span', { class: 'k' }, 'When'), h('span', {}, rule.conditions.map(conditionText).join(joiner)),
      h('span', { class: 'k' }, 'Then'), h('span', {}, rule.actions.map((a) => actionText(a, cfg)).join(' → '))),
    editing && h('div', { class: 'editor stack' },
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Rule name',
          h('input', { value: rule.name, maxlength: 120, disabled: !canEdit(), onchange: (e) => update(() => { rule.name = e.target.value.trim() || rule.name; }) })),
        h('label', { class: 'field' }, 'Match',
          select([['all', 'All conditions must be true'], ['any', 'Any one condition is enough']], rule.match, (v) => update(() => { rule.match = v; }), 'Match'))),
      h('div', {},
        h('h3', {}, 'When'),
        rule.conditions.map((c, j) => h('div', { class: 'line' },
          select(Object.entries(CONDITIONS).map(([k, v]) => [k, v.label]), c.type,
            (t) => update(() => { rule.conditions[j] = { type: t, ...CONDITIONS[t].make() }; }), 'Condition'),
          conditionEditor(c, (next) => update(() => { rule.conditions[j] = next; })),
          canEdit() && h('button', { class: 'icon danger', 'aria-label': 'Remove condition', disabled: rule.conditions.length === 1, onclick: () => update(() => rule.conditions.splice(j, 1)) }, '✕'))),
        canEdit() && rule.conditions.length < 20 && h('button', { onclick: () => update(() => rule.conditions.push({ type: 'outside_business_hours' })) }, '+ Add condition')),
      actionsEditor(rule.actions, cfg)));
}

function rulesTab() {
  const cfg = state.draft;
  return h('div', {},
    h('div', { class: 'row between' },
      h('div', {},
        h('h2', {}, 'Call routing rules'),
        h('p', { class: 'muted' }, 'Rules are checked from top to bottom. The first rule that matches decides what happens. If none match, "Otherwise" applies.')),
      canEdit() && cfg.rules.length < 50 && h('button', {
        onclick: () => update(() => {
          const id = `rule-${Math.random().toString(36).slice(2, 8)}`;
          cfg.rules.unshift({ id, name: 'New rule', enabled: true, match: 'all', conditions: [{ type: 'forward_reason', in: ['no_answer'] }], actions: [{ type: 'bot_answer' }, { type: 'create_callback_task' }] });
          state.editingId = id;
        }),
      }, '+ Add rule')),
    cfg.rules.map((r, i) => ruleCard(r, i, cfg.rules, cfg)),
    h('div', { class: 'card locked' },
      h('div', { class: 'row' },
        h('span', { class: 'num' }, '🔒'),
        h('h3', { class: 'rule-title' }, 'Otherwise'),
        h('button', { onclick: () => update(() => { state.editingId = state.editingId === '__fallback' ? null : '__fallback'; }) }, state.editingId === '__fallback' ? 'Close' : canEdit() ? 'Edit' : 'View')),
      h('div', { class: 'summary' },
        h('span', { class: 'k' }, 'When'), h('span', {}, 'no rule above matched'),
        h('span', { class: 'k' }, 'Then'), h('span', {}, cfg.fallback.actions.map((a) => actionText(a, cfg)).join(' → '))),
      state.editingId === '__fallback' && h('div', { class: 'editor' }, actionsEditor(cfg.fallback.actions, cfg))),
    h('p', { class: 'muted small' }, 'Always on, whatever the rules say: a forwarded call never rings the salesperson it came from, and if nobody else is left to answer, the AI assistant answers.'));
}

// ---------- hours and escalation tab ----------

function parseRanges(text) {
  const t = text.trim();
  if (t === '' || t.toLowerCase() === 'closed') return [];
  return t.split(',').map((part) => {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error(`"${part.trim()}" should look like 09:30-18:30`);
    const pad = (s) => s.padStart(2, '0');
    return { from: `${pad(m[1])}:${m[2]}`, to: `${pad(m[3])}:${m[4]}` };
  });
}

function hoursTab() {
  const cfg = state.draft;
  const levels = cfg.escalation.levels;
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Working hours'),
      h('p', { class: 'muted small' }, 'Used by the "outside working hours" and "during working hours" conditions. Write ranges like 09:30-13:00, 14:00-18:30. Leave empty for a day off.'),
      h('label', { class: 'field' }, 'Time zone',
        h('input', { value: cfg.timezone, disabled: !canEdit(), onchange: (e) => update(() => { cfg.timezone = e.target.value.trim(); }) })),
      h('div', { class: 'grid2' }, DAYS.map(([d, label]) =>
        h('label', { class: 'field' }, label,
          h('input', {
            value: cfg.businessHours[d].map((r) => `${r.from}-${r.to}`).join(', '), placeholder: 'Closed', disabled: !canEdit(),
            onchange: (e) => {
              try { const ranges = parseRanges(e.target.value); update(() => { cfg.businessHours[d] = ranges; }); }
              catch (err) { toast(err.message); render(); }
            },
          })))),
      h('label', { class: 'field' }, 'Holidays (one date per line, YYYY-MM-DD)',
        h('textarea', {
          disabled: !canEdit(), value: cfg.holidays.join('\n'),
          onchange: (e) => {
            const dates = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
            const bad = dates.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
            if (bad) { toast(`"${bad}" should look like 2026-12-25`); render(); return; }
            update(() => { cfg.holidays = [...new Set(dates)].sort(); });
          },
        }))),
    h('div', { class: 'card stack' },
      h('h2', {}, 'Callbacks and escalation'),
      h('p', { class: 'muted small' }, 'When the AI answers a call, a callback task goes to the salesperson. If it is not marked done before the deadline, it moves down this ladder. People on leave and levels with nobody available are skipped.'),
      h('label', { class: 'field' }, 'Default callback deadline (minutes)',
        numberInput(cfg.callback.deadlineMinutes, { min: 1, max: 10080, label: 'Default callback deadline' }, (n) => update(() => { cfg.callback.deadlineMinutes = n ?? 30; }))),
      h('div', { class: 'line' }, h('span', { class: 'num' }, '0'), h('strong', {}, 'Salesperson'), h('span', { class: 'muted small' }, 'gets the task first')),
      levels.map((lv, i) => h('div', { class: 'line' },
        h('span', { class: 'num' }, `${i + 1}`),
        h('input', { value: lv.name, 'aria-label': 'Level name', disabled: !canEdit(), onchange: (e) => update(() => { lv.name = e.target.value.trim() || lv.name; }) }),
        targetSelect(lv.target, (t) => update(() => { lv.target = t; })),
        'has', numberInput(lv.deadlineMinutes, { min: 1, max: 10080, placeholder: 'no limit', label: 'Minutes' }, (n) => update(() => { lv.deadlineMinutes = n; })), 'minutes',
        canEdit() && h('span', { class: 'row' },
          h('button', { class: 'icon', 'aria-label': 'Move level up', disabled: i === 0, onclick: () => update(() => moveItem(levels, i, -1)) }, '↑'),
          h('button', { class: 'icon', 'aria-label': 'Move level down', disabled: i === levels.length - 1, onclick: () => update(() => moveItem(levels, i, 1)) }, '↓'),
          h('button', { class: 'icon danger', 'aria-label': 'Remove level', onclick: () => update(() => levels.splice(i, 1)) }, '✕')))),
      h('p', { class: 'muted small' }, 'Leave the minutes empty only on the last level: that person keeps the task until it is done.'),
      canEdit() && levels.length < 6 && h('button', { onclick: () => update(() => levels.push({ name: 'Manager', target: { kind: 'role', role: 'manager' }, deadlineMinutes: null })) }, '+ Add level')));
}

// ---------- team tab ----------

async function patchMember(id, changes) {
  try { await api('PATCH', `/api/team/${id}`, changes); state.team = await api('GET', '/api/team'); toast('Saved'); }
  catch (err) { toast(err.issues?.[0]?.message || err.message); }
  render();
}

async function patchNumber(id, changes) {
  try { await api('PATCH', `/api/bot-numbers/${id}`, changes); state.numbers = await api('GET', '/api/bot-numbers'); toast('Saved'); }
  catch (err) { toast(err.issues?.[0]?.message || err.message); }
  render();
}

function teamTab() {
  const ed = !canEdit();
  const memberPairs = [['', '—'], ...state.team.map((m) => [m.id, m.name])];
  const memberSelect = (value, onChange, exclude, label) =>
    h('select', { disabled: ed, 'aria-label': label, onchange: (e) => onChange(e.target.value || null) },
      memberPairs.filter(([id]) => id !== exclude).map(([id, name]) => h('option', { value: id, selected: id === (value ?? '') }, name)));

  const newMember = { name: '', role: 'salesperson', phone: '', crmRef: '' };
  const newNumber = { e164: '', channel: 'phone', teamMemberId: null, label: '' };

  return h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Changes on this page save straight away. Status changes take effect for the next call.'),
    h('div', { class: 'card' },
      h('h2', {}, 'Team'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Name', 'Role', 'Phone', 'CRM code', 'Backup person', 'Status', 'Active'].map((t) => h('th', {}, t)))),
        h('tbody', {}, state.team.map((m) => h('tr', {},
          h('td', {}, h('input', { value: m.name, disabled: ed, 'aria-label': 'Name', onchange: (e) => patchMember(m.id, { name: e.target.value }) })),
          h('td', {}, select(ROLES, m.role, (v) => patchMember(m.id, { role: v }), 'Role')),
          h('td', {}, h('input', { value: m.phone ?? '', placeholder: '+91…', disabled: ed, 'aria-label': 'Phone', onchange: (e) => patchMember(m.id, { phone: e.target.value.trim() || null }) })),
          h('td', {}, h('input', { value: m.crmRef ?? '', disabled: ed, 'aria-label': 'CRM code', onchange: (e) => patchMember(m.id, { crmRef: e.target.value.trim() || null }) })),
          h('td', {}, memberSelect(m.backupMemberId, (v) => patchMember(m.id, { backupMemberId: v }), m.id, 'Backup person')),
          h('td', {}, select(STATUSES, m.status, (v) => patchMember(m.id, { status: v }), 'Status')),
          h('td', {}, h('input', { type: 'checkbox', checked: m.active, disabled: ed, 'aria-label': 'Active', onchange: (e) => patchMember(m.id, { active: e.target.checked }) }))))))),
      canEdit() && h('div', { class: 'row', 'aria-label': 'Add team member' },
        h('input', { placeholder: 'Name', 'aria-label': 'New member name', oninput: (e) => { newMember.name = e.target.value; } }),
        h('select', { 'aria-label': 'New member role', onchange: (e) => { newMember.role = e.target.value; } }, ROLES.map(([v, l]) => h('option', { value: v }, l))),
        h('input', { placeholder: 'Phone +91…', 'aria-label': 'New member phone', oninput: (e) => { newMember.phone = e.target.value; } }),
        h('input', { placeholder: 'CRM code', 'aria-label': 'New member CRM code', oninput: (e) => { newMember.crmRef = e.target.value; } }),
        h('button', {
          onclick: async () => {
            if (!newMember.name.trim()) return toast('Enter a name');
            try {
              await api('POST', '/api/team', { name: newMember.name, role: newMember.role, phone: newMember.phone.trim() || null, crmRef: newMember.crmRef.trim() || null });
              state.team = await api('GET', '/api/team'); toast('Team member added'); render();
            } catch (err) { toast(err.issues?.[0]?.message || err.message); }
          },
        }, 'Add person'))),
    h('div', { class: 'card' },
      h('h2', {}, 'Bot numbers'),
      h('p', { class: 'muted small' }, 'Each salesperson forwards busy, unanswered and switched-off calls from their own SIM to their bot number, so the platform knows whose customer is calling.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Number', 'Channel', 'Belongs to', 'Label', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, state.numbers.map((n) => h('tr', {},
          h('td', {}, n.e164),
          h('td', {}, select([['phone', 'Phone'], ['whatsapp', 'WhatsApp']], n.channel, (v) => patchNumber(n.id, { channel: v }), 'Channel')),
          h('td', {}, memberSelect(n.teamMemberId, (v) => patchNumber(n.id, { teamMemberId: v }), null, 'Belongs to')),
          h('td', {}, h('input', { value: n.label ?? '', disabled: ed, 'aria-label': 'Label', onchange: (e) => patchNumber(n.id, { label: e.target.value.trim() || null }) })),
          h('td', {}, canEdit() && h('button', {
            class: 'danger',
            onclick: async () => {
              if (!confirm(`Remove ${n.e164}? Calls to it will no longer be routed.`)) return;
              try { await api('DELETE', `/api/bot-numbers/${n.id}`); state.numbers = await api('GET', '/api/bot-numbers'); toast('Number removed'); render(); }
              catch (err) { toast(err.message); }
            },
          }, 'Remove'))))))),
      canEdit() && h('div', { class: 'row' },
        h('input', { placeholder: '+919876543210', 'aria-label': 'New bot number', oninput: (e) => { newNumber.e164 = e.target.value.trim(); } }),
        h('select', { 'aria-label': 'New number channel', onchange: (e) => { newNumber.channel = e.target.value; } }, h('option', { value: 'phone' }, 'Phone'), h('option', { value: 'whatsapp' }, 'WhatsApp')),
        h('select', { 'aria-label': 'New number belongs to', onchange: (e) => { newNumber.teamMemberId = e.target.value || null; } }, memberPairs.map(([id, name]) => h('option', { value: id }, name))),
        h('input', { placeholder: 'Label', 'aria-label': 'New number label', oninput: (e) => { newNumber.label = e.target.value; } }),
        h('button', {
          onclick: async () => {
            try {
              await api('POST', '/api/bot-numbers', { ...newNumber, label: newNumber.label.trim() || null });
              state.numbers = await api('GET', '/api/bot-numbers'); toast('Number added'); render();
            } catch (err) { toast(err.issues?.[0]?.message || err.message); }
          },
        }, 'Add number'))));
}

// ---------- test tab ----------

function localDateTimeValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function testTab() {
  if (!state.testForm) {
    state.testForm = {
      at: localDateTimeValue(), channel: 'phone', botNumberId: state.numbers[0]?.id ?? '', forwardReason: 'no_answer',
      callerPhone: '+919811111111', callerKnown: true, tags: '', language: '', useDraft: true, humanAnswered: false,
    };
  }
  const f = state.testForm;
  const call = () => ({
    at: new Date(f.at).toISOString(),
    channel: f.channel,
    botNumberId: f.botNumberId || null,
    forwardReason: f.forwardReason || null,
    callerPhone: f.callerPhone.trim(),
    callerKnown: f.callerKnown,
    callerTags: f.tags.split(',').map((s) => s.trim()).filter(Boolean),
    language: f.language.trim() || null,
  });
  const field = (label, control) => h('label', { class: 'field' }, label, control);
  const bind = (key) => (e) => { f[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };

  const run = async () => {
    try {
      const body = { call: call() };
      if (isDirty() && f.useDraft) body.config = state.draft;
      state.test = { kind: 'test', ...(await api('POST', '/api/routing/test', body)) };
    } catch (err) { state.test = null; toast(err.issues?.[0] ? `${err.issues[0].path}: ${err.issues[0].message}` : err.message); }
    render();
  };
  const simulate = async () => {
    if (isDirty()) return toast('Save your rule changes first. A simulated call uses the saved rules.');
    try {
      const r = await api('POST', '/api/calls/simulate', { call: call(), humanAnswered: f.humanAnswered });
      const preview = await api('POST', '/api/routing/test', { call: call() });
      state.test = { kind: 'simulated', taskId: r.taskId, ...preview };
      toast(r.taskId ? 'Call recorded and callback task created. See Tasks.' : 'Call recorded. No callback task was needed.');
    } catch (err) { toast(err.issues?.[0]?.message || err.message); }
    render();
  };

  const t = state.test;
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Test a call'),
      h('p', { class: 'muted small' }, '"Test" only shows what would happen and saves nothing. "Simulate" runs the saved rules for real: it records the call and creates the callback task and messages.'),
      h('div', { class: 'grid2' },
        field('When (your computer\'s time)', h('input', { type: 'datetime-local', value: f.at, onchange: bind('at') })),
        field('Channel', h('select', { onchange: bind('channel') }, CHANNELS.map(([v, l]) => h('option', { value: v, selected: v === f.channel }, l)))),
        field('Bot number called', h('select', { onchange: bind('botNumberId') },
          h('option', { value: '', selected: !f.botNumberId }, 'None / business number'),
          state.numbers.map((n) => h('option', { value: n.id, selected: n.id === f.botNumberId }, `${n.e164}${n.teamMemberId ? ` · ${memberName(n.teamMemberId)}` : ''}`)))),
        field('Why it reached the bot', h('select', { onchange: bind('forwardReason') },
          h('option', { value: '', selected: !f.forwardReason }, 'Not forwarded (dialled directly)'),
          REASONS.map(([v, l]) => h('option', { value: v, selected: v === f.forwardReason }, l)))),
        field('Caller phone', h('input', { value: f.callerPhone, oninput: bind('callerPhone') })),
        field('Customer tags (comma separated)', h('input', { value: f.tags, placeholder: 'vip', oninput: bind('tags') })),
        field('Language code', h('input', { value: f.language, placeholder: 'ta', oninput: bind('language') }))),
      h('div', { class: 'row' },
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: f.callerKnown, onchange: bind('callerKnown') }), 'Known customer'),
        isDirty() && h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: f.useDraft, onchange: bind('useDraft') }), 'Test with my unsaved changes'),
        canEdit() && h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: f.humanAnswered, onchange: bind('humanAnswered') }), 'A person answered (simulate only)')),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: run }, 'Test'),
        canEdit() && h('button', { onclick: simulate }, 'Simulate a real call'))),
    t && h('div', { class: 'card stack' },
      h('div', { class: 'result' },
        h('h3', {}, t.decision.ruleId ? `Rule: ${t.decision.ruleName}` : 'No rule matched, so "Otherwise" applies'),
        h('p', { class: 'muted small' }, `Local time ${t.decision.localTime.day} ${t.decision.localTime.date} ${t.decision.localTime.time}${t.assignedMember ? ` · Salesperson: ${t.assignedMember}` : ''}`),
        h('ol', {}, t.outcome.map((o) => h('li', {}, o)))),
      t.decision.notes.length > 0 && h('div', {}, h('h3', {}, 'Safety adjustments'), h('ul', {}, t.decision.notes.map((n) => h('li', {}, n)))),
      h('div', {},
        h('h3', {}, 'How each rule was checked'),
        h('ol', { class: 'trace' }, t.decision.trace.map((r) => h('li', {},
          h('span', { class: `pill ${r.status === 'matched' ? 'ok' : r.status === 'disabled' ? 'warn' : ''}` },
            { matched: 'Matched', not_matched: 'No match', disabled: 'Off', skipped: 'Not checked' }[r.status]),
          ' ', r.ruleName,
          r.conditions.length > 0 && h('ul', {}, r.conditions.map((c) => h('li', { class: 'cond' }, `${c.result ? '✓' : '✗'} ${CONDITIONS[c.type]?.label ?? c.type}: ${c.detail}`)))))))));
}

// ---------- tasks tab ----------

async function loadActivity() {
  [state.tasks, state.notifications, state.calls] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/notifications'), api('GET', '/api/calls')]);
}

function tasksTab() {
  const levelName = (n) => (n === 0 ? 'Salesperson' : state.active.config.escalation.levels[n - 1]?.name ?? `Level ${n}`);
  const statusPill = (t) => {
    if (t.status === 'done') return h('span', { class: 'pill ok' }, 'Done');
    if (t.status === 'escalation_exhausted') return h('span', { class: 'pill bad' }, 'Nobody left to escalate to');
    if (t.due_at && new Date(t.due_at) < new Date()) return h('span', { class: 'pill bad' }, 'Overdue');
    return h('span', { class: 'pill info' }, 'Open');
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('h2', {}, 'Callback tasks'),
        h('span', { class: 'row' },
          h('button', { onclick: async () => { await loadActivity(); render(); } }, 'Refresh'),
          canEdit() && h('button', {
            onclick: async () => {
              try { const r = await api('POST', '/api/tasks/run-escalation'); toast(`Escalated ${r.escalated}, nobody left for ${r.exhausted}`); await loadActivity(); render(); }
              catch (err) { toast(err.message); }
            },
          }, 'Run escalation check now'))),
      h('p', { class: 'muted small' }, 'The escalation check also runs automatically every minute.'),
      state.tasks.length === 0 ? h('p', { class: 'muted' }, 'No callback tasks yet. Simulate a missed call on the Test page to create one.') :
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Caller', 'Salesperson', 'With now', 'Due', 'Status', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, state.tasks.map((t) => h('tr', {},
            h('td', {}, t.caller_phone, h('div', { class: 'muted small' }, t.note ?? '')),
            h('td', {}, t.original_name ?? '—'),
            h('td', {}, t.assigned_name ?? '—', h('div', { class: 'muted small' }, levelName(t.escalation_level))),
            h('td', {}, fmtTime(t.due_at)),
            h('td', {}, statusPill(t)),
            h('td', {}, t.status !== 'done' && h('button', {
              onclick: async () => { try { await api('POST', `/api/tasks/${t.id}/done`); await loadActivity(); toast('Marked done'); render(); } catch (err) { toast(err.message); } },
            }, 'Mark done')))))))),
    h('div', { class: 'card' },
      h('h2', {}, 'Messages to the team'),
      h('p', { class: 'muted small' }, 'Queued here until the WhatsApp/SMS sender is connected in a later step.'),
      state.notifications.length === 0 ? h('p', { class: 'muted' }, 'No messages yet.') :
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['When', 'To', 'Via', 'Message'].map((x) => h('th', {}, x)))),
          h('tbody', {}, state.notifications.map((n) => h('tr', {},
            h('td', {}, fmtTime(n.created_at)), h('td', {}, n.member_name ?? '—'), h('td', {}, n.via === 'sms' ? 'SMS' : 'WhatsApp'), h('td', {}, n.message))))))),
    h('div', { class: 'card' },
      h('h2', {}, 'Recent calls'),
      state.calls.length === 0 ? h('p', { class: 'muted' }, 'No calls yet.') :
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['When', 'Caller', 'Salesperson', 'Rule used', 'Rules version', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, state.calls.map((c) => h('tr', {},
            h('td', {}, fmtTime(c.created_at)), h('td', {}, c.caller_phone), h('td', {}, c.member_name ?? '—'), h('td', {}, c.rule_name),
            h('td', {}, `v${c.config_version}`),
            h('td', {}, c.simulated && h('span', { class: 'pill' }, 'Simulated'), ' ', c.human_answered && h('span', { class: 'pill ok' }, 'Person answered')))))))));
}

// ---------- history tab ----------

function historyTab() {
  return h('div', { class: 'card' },
    h('h2', {}, 'Rule history'),
    h('p', { class: 'muted small' }, 'Every save creates a new version. Restoring an old version saves it again as the newest, so nothing is ever lost.'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Version', 'Note', 'By', 'When', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, state.versions.map((v) => h('tr', {},
        h('td', {}, `v${v.version} `, v.active && h('span', { class: 'pill ok' }, 'In use')),
        h('td', {}, v.note ?? '—'), h('td', {}, v.createdBy ?? '—'), h('td', {}, fmtTime(v.createdAt)),
        h('td', {}, canEdit() && !v.active && h('button', {
          onclick: async () => {
            if (isDirty() && !confirm('You have unsaved changes. Restoring will discard them. Continue?')) return;
            if (!confirm(`Make version ${v.version} the rules in use?`)) return;
            try { const r = await api('POST', `/api/routing/versions/${v.version}/restore`); await loadConfig(); toast(`Version ${v.version} restored as v${r.version}`); render(); }
            catch (err) { toast(err.message); }
          },
        }, 'Restore'))))))));
}

// ---------- shell ----------

async function loadConfig() {
  state.active = await api('GET', '/api/routing/config');
  state.draft = clone(state.active.config);
  state.versions = await api('GET', '/api/routing/versions');
  state.issues = [];
}

async function save() {
  try {
    const r = await api('PUT', '/api/routing/config', { config: state.draft, note: state.saveNote.trim() || undefined });
    state.saveNote = '';
    await loadConfig();
    toast(`Saved as version ${r.version}. It applies from the next call.`);
  } catch (err) {
    state.issues = err.issues?.length ? err.issues : [{ path: '', message: err.message }];
  }
  render();
}

function issueText(issue) {
  const m = issue.path.match(/^rules\.(\d+)/);
  const rule = m ? state.draft.rules[Number(m[1])] : null;
  const where = rule ? `Rule "${rule.name}"` : issue.path.startsWith('fallback') ? 'Otherwise' : issue.path.startsWith('escalation') ? 'Escalation' : issue.path.startsWith('businessHours') ? 'Working hours' : issue.path;
  return where ? `${where}: ${issue.message}` : issue.message;
}

function saveBar() {
  if (!isDirty()) return null;
  return h('div', { class: 'savebar', role: 'region', 'aria-label': 'Unsaved changes' },
    h('strong', {}, 'Unsaved changes'),
    canEdit() && h('input', { placeholder: 'What changed? (optional)', value: state.saveNote, 'aria-label': 'Change note', oninput: (e) => { state.saveNote = e.target.value; } }),
    h('button', { onclick: () => { if (confirm('Discard your unsaved changes?')) update(() => { state.draft = clone(state.active.config); state.issues = []; state.editingId = null; }); } }, 'Discard'),
    canEdit() && h('button', { class: 'primary', onclick: save }, 'Save changes'));
}

const TABS = [['rules', 'Rules'], ['hours', 'Hours and escalation'], ['team', 'Team and numbers'], ['test', 'Test a call'], ['tasks', 'Tasks'], ['history', 'History']];

function render() {
  const root = document.getElementById('app');
  if (!state.me) { root.replaceChildren(loginView()); return; }
  const body = { rules: rulesTab, hours: hoursTab, team: teamTab, test: testTab, tasks: tasksTab, history: historyTab }[state.tab]();
  root.replaceChildren(...[
    h('header', { class: 'topbar' },
      h('h1', {}, 'Call routing console'),
      h('div', { class: 'who' },
        h('span', {}, `${state.me.tenantName} · ${state.me.name} (${state.me.role})`),
        h('button', { onclick: async () => { await api('POST', '/api/auth/logout'); state.me = null; render(); } }, 'Log out'))),
    h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS.map(([k, l]) =>
      h('button', {
        class: state.tab === k ? 'active' : '', 'aria-current': state.tab === k ? 'page' : null,
        onclick: async () => {
          state.tab = k;
          if (k === 'test' && state.testForm) state.testForm.at = localDateTimeValue();
          if (k === 'tasks') await loadActivity().catch(() => {});
          if (k === 'history') state.versions = await api('GET', '/api/routing/versions').catch(() => state.versions);
          render();
        },
      }, l))),
    saveBar(),
    state.issues.length > 0 && h('div', { class: 'issues', role: 'alert' },
      h('strong', {}, 'Fix these before saving:'), h('ul', {}, state.issues.map((i) => h('li', {}, issueText(i))))),
    !canEdit() && h('p', { class: 'muted small' }, 'You can view the rules. Only owners and managers can change them.'),
    body].filter((x) => x instanceof Node));
}

function loginView() {
  let email = '';
  let password = '';
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try { await api('POST', '/api/auth/login', { email, password }); await start(); }
    catch (ex) { err.textContent = ex.message; }
  };
  return h('div', { class: 'login' }, h('form', { class: 'card', onsubmit: submit },
    h('h1', {}, 'Log in'),
    h('p', { class: 'muted' }, 'Call routing console'),
    h('label', { class: 'field' }, 'Email', h('input', { type: 'email', autocomplete: 'username', required: true, oninput: (e) => { email = e.target.value; } })),
    h('label', { class: 'field' }, 'Password', h('input', { type: 'password', autocomplete: 'current-password', required: true, oninput: (e) => { password = e.target.value; } })),
    err,
    h('button', { class: 'primary', type: 'submit' }, 'Log in')));
}

async function start() {
  try {
    state.me = await api('GET', '/api/me');
    [state.team, state.numbers] = await Promise.all([api('GET', '/api/team'), api('GET', '/api/bot-numbers')]);
    await loadConfig();
  } catch (err) {
    state.me = null;
    if (err.status !== 401) toast(err.message);
  }
  render();
}

window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
start();
