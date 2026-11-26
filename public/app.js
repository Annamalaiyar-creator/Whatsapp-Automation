// Assistant console. Plain JS, no build step. All text goes through textContent, never innerHTML.

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const DAYS_SHORT = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const REASONS = [['busy', 'Busy'], ['no_answer', 'Not answered'], ['unreachable', 'Switched off'], ['unknown', 'Reason unknown']];
const STATUSES = [['available', 'Available'], ['away', 'Away'], ['on_leave', 'On leave']];
const CHANNELS = [['phone', 'Phone call'], ['whatsapp_call', 'WhatsApp call'], ['whatsapp_chat', 'WhatsApp chat']];
const ROLES = [['salesperson', 'Salesperson'], ['manager', 'Manager'], ['ceo', 'CEO'], ['support', 'Support']];

const CONDITIONS = {
  forward_reason: { label: 'Call forwarded because', make: () => ({ in: ['no_answer'] }) },
  not_forwarded: { label: 'Bot number dialled directly', make: () => ({}) },
  outside_business_hours: { label: 'Outside working hours', make: () => ({}) },
  within_business_hours: { label: 'During working hours', make: () => ({}) },
  holiday: { label: 'Holiday', make: () => ({}) },
  time_window: { label: 'Time window', make: () => ({ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], from: '13:00', to: '14:00' }) },
  member_status: { label: 'Salesperson status', make: () => ({ in: ['on_leave'] }) },
  caller_tag: { label: 'Customer tag', make: () => ({ anyOf: ['vip'] }) },
  caller_known: { label: 'Known or new customer', make: () => ({ value: false }) },
  channel: { label: 'Channel', make: () => ({ in: ['phone'] }) },
  dialled_number: { label: 'Number dialled', make: () => ({ in: ['+91'] }) },
  language: { label: 'Customer language', make: () => ({ in: ['ta'] }) },
};
const ACTIONS = {
  bot_answer: { label: 'AI assistant answers', make: () => ({}) },
  ring: { label: 'Ring a person', make: () => ({ target: { kind: 'backup' }, timeoutSeconds: 20 }) },
  create_callback_task: { label: 'Create callback task', make: () => ({}) },
  notify: { label: 'Send a message', make: () => ({ target: { kind: 'assigned' }, via: 'whatsapp' }) },
};

const state = {
  me: null, tab: 'rules', active: null, draft: null, team: [], numbers: [], versions: [],
  editingId: null, issues: [], saveNote: '', test: null, testForm: null, tasks: [], notifications: [], calls: [],
};

// ---------- icons ----------

const ICONS = {
  rules: ['M4 6h16', 'M4 12h10', 'M4 18h6', 'M17 15l3 3-3 3'],
  clock: ['M12 7v5l3 2', 'circle:12,12,9'],
  users: ['circle:9,8,3.5', 'M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5', 'M16 4.6a3.5 3.5 0 0 1 0 6.8', 'M18 14.8c1.9.7 3.1 2.6 3.5 5.2'],
  play: ['M8 5l11 7-11 7z'],
  tasks: ['M4 5h16v14H4z', 'M8 12l3 3 5-6'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  plus: ['M12 5v14', 'M5 12h14'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  logout: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  bot: ['M5 9h14v10H5z', 'M12 5v4', 'M9 14h.01', 'M15 14h.01', 'circle:12,4,1'],
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'],
  task: ['M9 5h10v14H5V9', 'M5 5l4 4', 'M9 5v4H5'],
  message: ['M4 5h16v11H8l-4 4z'],
  lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  info: ['circle:12,12,9', 'M12 11v5', 'M12 8h.01'],
  check: ['M5 12l5 5 9-10'],
  x: ['M7 7l10 10', 'M17 7L7 17'],
  chevron: ['M9 6l6 6-6 6'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
  route: ['circle:6,19,2', 'circle:18,5,2', 'M6 17V9a4 4 0 0 1 4-4h6', 'M8 19h6a4 4 0 0 0 4-4V7'],
};

function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] ?? []) {
    if (d.startsWith('circle:')) {
      const [cx, cy, r] = d.slice(7).split(',');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      svg.append(c);
    } else {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
  }
  return svg;
}

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = Boolean(v);
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
  const t = h('div', { class: 'toast', role: 'status' }, icon('info'), h('span', {}, msg));
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3800);
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const isDirty = () => state.active && state.draft && JSON.stringify(state.draft) !== JSON.stringify(state.active.config);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const canEdit = () => state.me && ['owner', 'manager'].includes(state.me.role);
const labelOf = (pairs, v) => pairs.find(([k]) => k === v)?.[1] ?? v;
const memberName = (id) => state.team.find((m) => m.id === id)?.name ?? 'removed person';
const initials = (name) => (name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

function update(fn) { fn(); render(); }

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return fmtTime(iso);
}

function targetText(t) {
  switch (t.kind) {
    case 'assigned': return 'assigned salesperson';
    case 'backup': return 'backup person';
    case 'role': return labelOf(ROLES, t.role).toLowerCase() === 'ceo' ? 'CEO' : labelOf(ROLES, t.role).toLowerCase();
    case 'member': return memberName(t.memberId);
    default: return '?';
  }
}

function conditionText(c) {
  const list = (pairs, vals) => vals.map((v) => labelOf(pairs, v).toLowerCase()).join(' / ');
  switch (c.type) {
    case 'forward_reason': return `Forwarded: ${list(REASONS, c.in)}`;
    case 'not_forwarded': return 'Dialled bot number directly';
    case 'outside_business_hours': return 'Outside working hours';
    case 'within_business_hours': return 'During working hours';
    case 'holiday': return 'Holiday';
    case 'time_window': return `${c.days.map((d) => labelOf(DAYS_SHORT, d)).join(', ')} ${c.from}–${c.to}`;
    case 'member_status': return `Salesperson ${list(STATUSES, c.in)}`;
    case 'caller_tag': return `Tagged ${c.anyOf.join(' / ')}`;
    case 'caller_known': return c.value ? 'Known customer' : 'New customer';
    case 'channel': return list(CHANNELS, c.in).replace(/^./, (s) => s.toUpperCase());
    case 'dialled_number': return `Dialled ${c.in.join(' / ')}`;
    case 'language': return `Language ${c.in.join(' / ')}`;
    default: return c.type;
  }
}

function actionChip(a, cfg) {
  switch (a.type) {
    case 'bot_answer': return h('span', { class: 'chip bot' }, icon('bot'), 'AI answers');
    case 'ring': return h('span', { class: 'chip ring' }, icon('phone'), `Ring ${targetText(a.target)} · ${a.timeoutSeconds}s`);
    case 'create_callback_task': return h('span', { class: 'chip task' }, icon('task'), `Callback in ${a.deadlineMinutes ?? cfg.callback.deadlineMinutes} min`);
    case 'notify': return h('span', { class: 'chip notify' }, icon('message'), `${a.via === 'sms' ? 'SMS' : 'WhatsApp'} ${targetText(a.target)}`);
    default: return h('span', { class: 'chip' }, a.type);
  }
}

// ---------- form controls ----------

function checkPills(pairs, selected, onChange) {
  return pairs.map(([v, label]) =>
    h('label', { class: 'check-pill' },
      h('input', {
        type: 'checkbox', checked: selected.includes(v), disabled: !canEdit(),
        onchange: (e) => {
          const next = e.target.checked ? [...selected, v] : selected.filter((x) => x !== v);
          if (next.length === 0) { e.target.checked = true; toast('Pick at least one'); return; }
          onChange(pairs.map(([k]) => k).filter((k) => next.includes(k)));
        },
      }),
      label));
}

function listInput(values, placeholder, onChange) {
  return h('input', {
    class: 'input', value: values.join(', '), placeholder, disabled: !canEdit(), 'aria-label': placeholder,
    onchange: (e) => {
      const next = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (next.length === 0) { toast('Enter at least one value'); render(); return; }
      onChange(next);
    },
  });
}

function select(pairs, value, onChange, label, { disabled } = {}) {
  return h('select', { class: 'select', onchange: (e) => onChange(e.target.value), disabled: disabled ?? !canEdit(), 'aria-label': label },
    pairs.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function targetSelect(target, onChange) {
  const pairs = [
    ['assigned', 'Assigned salesperson'],
    ['backup', 'Their backup person'],
    ...ROLES.map(([r, l]) => [`role:${r}`, `Any ${r === 'ceo' ? 'CEO' : l.toLowerCase()}`]),
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
    class: 'input num', type: 'number', min, max, value: value ?? '', placeholder, disabled: !canEdit(), 'aria-label': label,
    onchange: (e) => {
      const raw = e.target.value.trim();
      if (raw === '') return onChange(null);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) { toast(`Enter a whole number from ${min} to ${max}`); render(); return; }
      onChange(n);
    },
  });
}

function switchEl(checked, label, onChange, { disabled } = {}) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked, disabled: disabled ?? !canEdit(), onchange: (e) => onChange(e.target.checked), 'aria-label': label }),
    h('span', { class: 'track' }),
    h('span', {}, checked ? 'On' : 'Off'));
}

function iconBtn(name, label, onclick, { disabled, danger } = {}) {
  return h('button', { class: `icon-btn${danger ? ' danger' : ''}`, title: label, 'aria-label': label, disabled, onclick }, icon(name));
}

function btn(text, onclick, { kind = '', iconName, size = '', type = 'button' } = {}) {
  return h('button', { class: `btn ${kind} ${size}`.trim(), type, onclick }, iconName && icon(iconName), text);
}

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint && h('span', { class: 'hint' }, hint));
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function emptyState(iconName, title, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('h3', {}, title), h('p', {}, text));
}

function pageHead(title, text, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), text && h('p', {}, text)),
    actions.filter(Boolean).length > 0 && h('div', { class: 'actions' }, actions));
}

// ---------- rules ----------

function conditionParams(c, onChange) {
  switch (c.type) {
    case 'forward_reason': return checkPills(REASONS, c.in, (v) => onChange({ ...c, in: v }));
    case 'member_status': return checkPills(STATUSES, c.in, (v) => onChange({ ...c, in: v }));
    case 'channel': return checkPills(CHANNELS, c.in, (v) => onChange({ ...c, in: v }));
    case 'caller_tag': return listInput(c.anyOf, 'Tags, comma separated', (v) => onChange({ ...c, anyOf: v }));
    case 'dialled_number': return listInput(c.in, '+919876543210, …', (v) => onChange({ ...c, in: v }));
    case 'language': return listInput(c.in, 'Language codes: ta, hi, en', (v) => onChange({ ...c, in: v }));
    case 'caller_known': return select([['true', 'Known customer'], ['false', 'New / unknown customer']], String(c.value), (v) => onChange({ ...c, value: v === 'true' }), 'Customer');
    case 'time_window': return [
      checkPills(DAYS_SHORT, c.days, (v) => onChange({ ...c, days: v })),
      h('input', { class: 'input', type: 'time', value: c.from, disabled: !canEdit(), 'aria-label': 'From', onchange: (e) => onChange({ ...c, from: e.target.value }) }),
      h('span', {}, 'to'),
      h('input', { class: 'input', type: 'time', value: c.to, disabled: !canEdit(), 'aria-label': 'To', onchange: (e) => onChange({ ...c, to: e.target.value }) }),
    ];
    default: return h('span', { class: 'muted small' }, 'No settings needed');
  }
}

function actionParams(a, cfg, onChange) {
  switch (a.type) {
    case 'ring': return [targetSelect(a.target, (t) => onChange({ ...a, target: t })), h('span', {}, 'for'),
      numberInput(a.timeoutSeconds, { min: 5, max: 120, label: 'Seconds' }, (n) => onChange({ ...a, timeoutSeconds: n ?? 20 })), h('span', {}, 'seconds')];
    case 'create_callback_task': return [h('span', {}, 'due in'),
      numberInput(a.deadlineMinutes, { min: 1, max: 10080, placeholder: String(cfg.callback.deadlineMinutes), label: 'Minutes' },
        (n) => onChange(n === null ? { type: a.type } : { ...a, deadlineMinutes: n })),
      h('span', {}, 'minutes'), h('span', { class: 'muted small' }, 'Leave empty for the default')];
    case 'notify': return [targetSelect(a.target, (t) => onChange({ ...a, target: t })), h('span', {}, 'by'),
      select([['whatsapp', 'WhatsApp'], ['sms', 'SMS']], a.via, (v) => onChange({ ...a, via: v }), 'How')];
    default: return h('span', { class: 'muted small' }, 'The assistant takes the call or chat');
  }
}

function stepsEditor(actions, cfg) {
  return h('div', { class: 'editor-section' },
    h('div', { class: 'sec-head' }, h('h3', {}, 'Then'), h('p', {}, 'Steps run in order. Ringing stops at the first person who answers.')),
    actions.map((a, i) => h('div', { class: 'edit-row' },
      h('span', { class: 'step-no' }, i + 1),
      select(Object.entries(ACTIONS).map(([k, v]) => [k, v.label]), a.type, (t) => update(() => { actions[i] = { type: t, ...ACTIONS[t].make() }; }), 'Step'),
      h('div', { class: 'params' }, actionParams(a, cfg, (next) => update(() => { actions[i] = next; }))),
      canEdit() && h('div', { class: 'tools' },
        iconBtn('up', 'Move step up', () => update(() => moveItem(actions, i, -1)), { disabled: i === 0 }),
        iconBtn('down', 'Move step down', () => update(() => moveItem(actions, i, 1)), { disabled: i === actions.length - 1 }),
        iconBtn('trash', 'Remove step', () => update(() => actions.splice(i, 1)), { disabled: actions.length === 1, danger: true })))),
    canEdit() && actions.length < 10 && h('div', { class: 'add-link' },
      btn('Add step', () => update(() => actions.push({ type: 'notify', ...ACTIONS.notify.make() })), { kind: 'ghost', iconName: 'plus', size: 'sm' })),
    h('div', { class: 'note' }, icon('info'), h('span', {}, 'Callback tasks and messages only happen when no person answered the call.')));
}

function ruleFlow(conditions, match, actions, cfg) {
  const condItems = [];
  conditions.forEach((c, i) => {
    if (i > 0) condItems.push(h('span', { class: 'joiner' }, match === 'all' ? 'and' : 'or'));
    condItems.push(h('span', { class: 'chip cond' }, conditionText(c)));
  });
  const actItems = [];
  actions.forEach((a, i) => {
    if (i > 0) actItems.push(h('span', { class: 'arrow' }, icon('arrow')));
    actItems.push(actionChip(a, cfg));
  });
  return h('div', { class: 'rule-flow' },
    h('span', { class: 'flow-label' }, 'IF'), h('div', { class: 'flow-items' }, conditions ? condItems : null),
    h('span', { class: 'flow-label' }, 'THEN'), h('div', { class: 'flow-items' }, actItems));
}

function ruleCard(rule, i, rules, cfg) {
  const open = state.editingId === rule.id;
  return h('div', { class: `rule${rule.enabled ? '' : ' off'}${open ? ' open' : ''}` },
    h('div', { class: 'rule-head' },
      h('span', { class: 'prio', title: 'Checked in this order' }, i + 1),
      h('div', { class: 'rule-title' }, rule.name),
      switchEl(rule.enabled, `Turn "${rule.name}" on or off`, (v) => update(() => { rule.enabled = v; })),
      h('div', { class: 'rule-tools' },
        canEdit() && iconBtn('up', 'Move rule up', () => update(() => moveItem(rules, i, -1)), { disabled: i === 0 }),
        canEdit() && iconBtn('down', 'Move rule down', () => update(() => moveItem(rules, i, 1)), { disabled: i === rules.length - 1 }),
        iconBtn(open ? 'close' : 'edit', open ? 'Close editor' : canEdit() ? 'Edit rule' : 'View rule', () => update(() => { state.editingId = open ? null : rule.id; })),
        canEdit() && iconBtn('trash', 'Delete rule', () => { if (confirm(`Delete the rule "${rule.name}"?`)) update(() => rules.splice(i, 1)); }, { danger: true }))),
    ruleFlow(rule.conditions, rule.match, rule.actions, cfg),
    open && h('div', { class: 'editor' },
      h('div', { class: 'grid-2' },
        field('Rule name', h('input', { class: 'input', value: rule.name, maxlength: 120, disabled: !canEdit(), onchange: (e) => update(() => { rule.name = e.target.value.trim() || rule.name; }) })),
        field('Match', select([['all', 'All conditions must be true'], ['any', 'Any one condition is enough']], rule.match, (v) => update(() => { rule.match = v; }), 'Match'))),
      h('div', { class: 'editor-section' },
        h('div', { class: 'sec-head' }, h('h3', {}, 'When')),
        rule.conditions.map((c, j) => h('div', { class: 'edit-row' },
          select(Object.entries(CONDITIONS).map(([k, v]) => [k, v.label]), c.type, (t) => update(() => { rule.conditions[j] = { type: t, ...CONDITIONS[t].make() }; }), 'Condition'),
          h('div', { class: 'params' }, conditionParams(c, (next) => update(() => { rule.conditions[j] = next; }))),
          canEdit() && h('div', { class: 'tools' },
            iconBtn('trash', 'Remove condition', () => update(() => rule.conditions.splice(j, 1)), { disabled: rule.conditions.length === 1, danger: true })))),
        canEdit() && rule.conditions.length < 20 && h('div', { class: 'add-link' },
          btn('Add condition', () => update(() => rule.conditions.push({ type: 'outside_business_hours' })), { kind: 'ghost', iconName: 'plus', size: 'sm' }))),
      stepsEditor(rule.actions, cfg)));
}

function rulesTab() {
  const cfg = state.draft;
  const activeCount = cfg.rules.filter((r) => r.enabled).length;
  const fallbackOpen = state.editingId === '__fallback';
  return h('div', { class: 'page' },
    pageHead('Call routing rules', 'Rules are checked from top to bottom. The first rule that matches decides who handles the call. If none match, "Otherwise" applies.',
      canEdit() && cfg.rules.length < 50 && btn('New rule', () => update(() => {
        const id = `rule-${Math.random().toString(36).slice(2, 8)}`;
        cfg.rules.unshift({ id, name: 'New rule', enabled: true, match: 'all', conditions: [{ type: 'forward_reason', in: ['no_answer'] }], actions: [{ type: 'bot_answer' }, { type: 'create_callback_task' }] });
        state.editingId = id;
      }), { kind: 'primary', iconName: 'plus' })),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Active rules'), h('div', { class: 'v' }, `${activeCount}`, h('span', { class: 'muted small' }, ` of ${cfg.rules.length}`))),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Rules version'), h('div', { class: 'v' }, `v${state.active.version}`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Last saved'), h('div', { class: 'v sm' }, relTime(state.active.createdAt)), h('div', { class: 'muted small' }, state.active.createdBy ? `by ${state.active.createdBy}` : '')),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Callback deadline'), h('div', { class: 'v' }, `${cfg.callback.deadlineMinutes}`, h('span', { class: 'muted small' }, ' min')))),
    cfg.rules.length === 0 && h('div', { class: 'card' }, emptyState('rules', 'No rules yet', 'Every call goes to "Otherwise". Add a rule to handle calls differently.')),
    cfg.rules.map((r, i) => ruleCard(r, i, cfg.rules, cfg)),
    h('div', { class: `rule fallback${fallbackOpen ? ' open' : ''}` },
      h('div', { class: 'rule-head' },
        h('span', { class: 'prio' }, icon('lock')),
        h('div', { class: 'rule-title' }, 'Otherwise'),
        h('span', { class: 'badge' }, 'Always on'),
        h('div', { class: 'rule-tools' },
          iconBtn(fallbackOpen ? 'close' : 'edit', fallbackOpen ? 'Close editor' : 'Edit the Otherwise rule', () => update(() => { state.editingId = fallbackOpen ? null : '__fallback'; })))),
      h('div', { class: 'rule-flow' },
        h('span', { class: 'flow-label' }, 'IF'), h('div', { class: 'flow-items' }, h('span', { class: 'chip' }, 'No rule above matched')),
        h('span', { class: 'flow-label' }, 'THEN'), h('div', { class: 'flow-items' },
          cfg.fallback.actions.flatMap((a, i) => [i > 0 && h('span', { class: 'arrow' }, icon('arrow')), actionChip(a, cfg)]))),
      fallbackOpen && h('div', { class: 'editor' }, stepsEditor(cfg.fallback.actions, cfg))),
    h('div', { class: 'note' }, icon('shield'),
      h('span', {}, 'Always applied, whatever the rules say: a forwarded call never rings the salesperson it came from, and if nobody else is left to answer, the AI assistant answers.')));
}

// ---------- hours and escalation ----------

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
  return h('div', { class: 'page' },
    pageHead('Hours and escalation', 'Working hours decide when the "outside working hours" rules apply. The escalation ladder decides who follows up when a callback is late.'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Working hours'), h('p', {}, 'Ranges like 09:30-13:00, 14:00-18:30. Empty means closed.'))),
        h('div', { class: 'card-body' },
          field('Time zone', h('input', { class: 'input wide', value: cfg.timezone, disabled: !canEdit(), onchange: (e) => update(() => { cfg.timezone = e.target.value.trim(); }) })),
          h('div', { class: 'hours' }, DAYS.map(([d, label]) => {
            const ranges = cfg.businessHours[d];
            return h('div', { class: 'hours-row' },
              h('span', { class: 'day' }, label),
              h('input', {
                class: 'input wide', value: ranges.map((r) => `${r.from}-${r.to}`).join(', '), placeholder: 'Closed', disabled: !canEdit(), 'aria-label': `${label} hours`,
                onchange: (e) => {
                  try { const next = parseRanges(e.target.value); update(() => { cfg.businessHours[d] = next; }); }
                  catch (err) { toast(err.message); render(); }
                },
              }),
              ranges.length ? h('span', { class: 'badge green' }, h('span', { class: 'dot' }), 'Open') : h('span', { class: 'badge' }, 'Closed'));
          })))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Holidays'), h('p', {}, 'Treated as closed all day. One date per line.'))),
        h('div', { class: 'card-body' },
          h('textarea', {
            class: 'input', disabled: !canEdit(), value: cfg.holidays.join('\n'), placeholder: '2026-12-25', 'aria-label': 'Holidays',
            onchange: (e) => {
              const dates = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
              const bad = dates.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
              if (bad) { toast(`"${bad}" should look like 2026-12-25`); render(); return; }
              update(() => { cfg.holidays = [...new Set(dates)].sort(); });
            },
          }),
          h('p', { class: 'muted small' }, cfg.holidays.length ? `${cfg.holidays.length} holiday${cfg.holidays.length > 1 ? 's' : ''} set` : 'No holidays set')))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', {}, 'Callback escalation ladder'), h('p', {}, 'If a callback is not marked done before its deadline, it moves to the next level. People on leave and levels with nobody available are skipped.')),
        h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Default deadline'),
          numberInput(cfg.callback.deadlineMinutes, { min: 1, max: 10080, label: 'Default callback deadline in minutes' }, (n) => update(() => { cfg.callback.deadlineMinutes = n ?? 30; })),
          h('span', { class: 'muted small' }, 'min'))),
      h('div', { class: 'card-body' },
        h('div', { class: 'ladder' },
          h('div', { class: 'ladder-item' },
            h('span', { class: 'ladder-dot start' }, icon('bot')),
            h('div', { class: 'ladder-body' }, h('strong', {}, 'AI answers the call'), h('span', { class: 'muted small' }, 'and creates a callback task for the salesperson'))),
          h('div', { class: 'ladder-item' },
            h('span', { class: 'ladder-dot' }, '0'),
            h('div', { class: 'ladder-body' }, h('strong', {}, 'Salesperson'), h('span', { class: 'muted small' }, `calls back within the rule's deadline (default ${cfg.callback.deadlineMinutes} min)`))),
          levels.map((lv, i) => h('div', { class: 'ladder-item' },
            h('span', { class: 'ladder-dot' }, i + 1),
            h('div', { class: 'ladder-body' },
              h('input', { class: 'input', value: lv.name, 'aria-label': 'Level name', disabled: !canEdit(), onchange: (e) => update(() => { lv.name = e.target.value.trim() || lv.name; }) }),
              targetSelect(lv.target, (t) => update(() => { lv.target = t; })),
              h('span', { class: 'muted' }, 'has'),
              numberInput(lv.deadlineMinutes, { min: 1, max: 10080, placeholder: '∞', label: 'Minutes' }, (n) => update(() => { lv.deadlineMinutes = n; })),
              h('span', { class: 'muted' }, lv.deadlineMinutes === null ? 'until done' : 'min'),
              canEdit() && h('div', { class: 'rule-tools' },
                iconBtn('up', 'Move level up', () => update(() => moveItem(levels, i, -1)), { disabled: i === 0 }),
                iconBtn('down', 'Move level down', () => update(() => moveItem(levels, i, 1)), { disabled: i === levels.length - 1 }),
                iconBtn('trash', 'Remove level', () => update(() => levels.splice(i, 1)), { danger: true })))))),
        h('div', { class: 'row' },
          canEdit() && levels.length < 6 && btn('Add level', () => update(() => levels.push({ name: 'Manager', target: { kind: 'role', role: 'manager' }, deadlineMinutes: null })), { kind: 'ghost', iconName: 'plus', size: 'sm' }),
          h('span', { class: 'muted small' }, 'Leave the minutes empty only on the last level: that person keeps the task until it is done.')))));
}

// ---------- team ----------

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
  const ro = !canEdit();
  const memberPairs = [['', '—'], ...state.team.map((m) => [m.id, m.name])];
  const memberSelect = (value, onChange, exclude, label) =>
    h('select', { class: 'select', disabled: ro, 'aria-label': label, onchange: (e) => onChange(e.target.value || null) },
      memberPairs.filter(([id]) => id !== exclude).map(([id, name]) => h('option', { value: id, selected: id === (value ?? '') }, name)));
  const statusBadge = (s) => h('span', { class: `badge ${s === 'available' ? 'green' : s === 'on_leave' ? 'red' : 'amber'}` }, h('span', { class: 'dot' }), labelOf(STATUSES, s));

  const newMember = { name: '', role: 'salesperson', phone: '', crmRef: '' };
  const newNumber = { e164: '', channel: 'phone', teamMemberId: null, label: '' };
  const onLeave = state.team.filter((m) => m.status === 'on_leave').length;

  return h('div', { class: 'page' },
    pageHead('Team and numbers', 'Who receives calls, callbacks and escalations. Changes here save straight away and apply to the next call.'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'People'), h('div', { class: 'v' }, state.team.filter((m) => m.active).length)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Salespeople'), h('div', { class: 'v' }, state.team.filter((m) => m.role === 'salesperson' && m.active).length)),
      h('div', { class: `stat${onLeave ? ' alert' : ''}` }, h('div', { class: 'k' }, 'On leave'), h('div', { class: 'v' }, onLeave)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Bot numbers'), h('div', { class: 'v' }, state.numbers.length))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Team'), h('p', {}, 'Set each person\'s backup and status. "On leave" sends their calls and callbacks onward.'))),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Person', 'Role', 'Phone', 'CRM code', 'Backup person', 'Status', 'Active'].map((t) => h('th', {}, t)))),
        h('tbody', {}, state.team.map((m) => h('tr', {},
          h('td', {}, h('div', { class: 'person' }, h('span', { class: 'avatar' }, initials(m.name)),
            h('input', { class: 'input', value: m.name, disabled: ro, 'aria-label': 'Name', onchange: (e) => patchMember(m.id, { name: e.target.value }) }))),
          h('td', {}, select(ROLES, m.role, (v) => patchMember(m.id, { role: v }), 'Role')),
          h('td', {}, h('input', { class: 'input', value: m.phone ?? '', placeholder: '+91…', disabled: ro, 'aria-label': 'Phone', onchange: (e) => patchMember(m.id, { phone: e.target.value.trim() || null }) })),
          h('td', {}, h('input', { class: 'input num', value: m.crmRef ?? '', disabled: ro, 'aria-label': 'CRM code', onchange: (e) => patchMember(m.id, { crmRef: e.target.value.trim() || null }) })),
          h('td', {}, memberSelect(m.backupMemberId, (v) => patchMember(m.id, { backupMemberId: v }), m.id, 'Backup person')),
          h('td', {}, ro ? statusBadge(m.status) : select(STATUSES, m.status, (v) => patchMember(m.id, { status: v }), 'Status')),
          h('td', {}, switchEl(m.active, `${m.name} active`, (v) => patchMember(m.id, { active: v }), { disabled: ro }))))))),
      canEdit() && h('div', { class: 'add-bar' },
        h('input', { class: 'input', placeholder: 'Name', 'aria-label': 'New person name', oninput: (e) => { newMember.name = e.target.value; } }),
        h('select', { class: 'select', 'aria-label': 'New person role', onchange: (e) => { newMember.role = e.target.value; } }, ROLES.map(([v, l]) => h('option', { value: v }, l))),
        h('input', { class: 'input', placeholder: 'Phone +91…', 'aria-label': 'New person phone', oninput: (e) => { newMember.phone = e.target.value; } }),
        h('input', { class: 'input num', placeholder: 'CRM code', 'aria-label': 'New person CRM code', oninput: (e) => { newMember.crmRef = e.target.value; } }),
        btn('Add person', async () => {
          if (!newMember.name.trim()) return toast('Enter a name');
          try {
            await api('POST', '/api/team', { name: newMember.name, role: newMember.role, phone: newMember.phone.trim() || null, crmRef: newMember.crmRef.trim() || null });
            state.team = await api('GET', '/api/team'); toast('Person added'); render();
          } catch (err) { toast(err.issues?.[0]?.message || err.message); }
        }, { iconName: 'plus' }))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Bot numbers'),
        h('p', {}, 'Each salesperson forwards busy, unanswered and switched-off calls from their own SIM to their bot number, so the assistant knows whose customer is calling.'))),
      state.numbers.length === 0 ? emptyState('phone', 'No bot numbers yet', 'Add a number and link it to a salesperson.') :
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Number', 'Channel', 'Belongs to', 'Label', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, state.numbers.map((n) => h('tr', {},
            h('td', {}, h('strong', {}, n.e164)),
            h('td', {}, select([['phone', 'Phone'], ['whatsapp', 'WhatsApp']], n.channel, (v) => patchNumber(n.id, { channel: v }), 'Channel')),
            h('td', {}, memberSelect(n.teamMemberId, (v) => patchNumber(n.id, { teamMemberId: v }), null, 'Belongs to')),
            h('td', {}, h('input', { class: 'input', value: n.label ?? '', disabled: ro, 'aria-label': 'Label', onchange: (e) => patchNumber(n.id, { label: e.target.value.trim() || null }) })),
            h('td', {}, canEdit() && iconBtn('trash', `Remove ${n.e164}`, async () => {
              if (!confirm(`Remove ${n.e164}? Calls to it will no longer be routed.`)) return;
              try { await api('DELETE', `/api/bot-numbers/${n.id}`); state.numbers = await api('GET', '/api/bot-numbers'); toast('Number removed'); render(); }
              catch (err) { toast(err.message); }
            }, { danger: true }))))))),
      canEdit() && h('div', { class: 'add-bar' },
        h('input', { class: 'input', placeholder: '+919876543210', 'aria-label': 'New bot number', oninput: (e) => { newNumber.e164 = e.target.value.trim(); } }),
        h('select', { class: 'select', 'aria-label': 'New number channel', onchange: (e) => { newNumber.channel = e.target.value; } }, h('option', { value: 'phone' }, 'Phone'), h('option', { value: 'whatsapp' }, 'WhatsApp')),
        h('select', { class: 'select', 'aria-label': 'New number belongs to', onchange: (e) => { newNumber.teamMemberId = e.target.value || null; } }, memberPairs.map(([id, name]) => h('option', { value: id }, name))),
        h('input', { class: 'input', placeholder: 'Label', 'aria-label': 'New number label', oninput: (e) => { newNumber.label = e.target.value; } }),
        btn('Add number', async () => {
          try {
            await api('POST', '/api/bot-numbers', { ...newNumber, label: newNumber.label.trim() || null });
            state.numbers = await api('GET', '/api/bot-numbers'); toast('Number added'); render();
          } catch (err) { toast(err.issues?.[0]?.message || err.message); }
        }, { iconName: 'plus' }))));
}

// ---------- test ----------

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
    at: new Date(f.at).toISOString(), channel: f.channel, botNumberId: f.botNumberId || null, forwardReason: f.forwardReason || null,
    callerPhone: f.callerPhone.trim(), callerKnown: f.callerKnown,
    callerTags: f.tags.split(',').map((s) => s.trim()).filter(Boolean), language: f.language.trim() || null,
  });
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
  const statusBadge = { matched: ['green', 'Matched'], not_matched: ['', 'No match'], disabled: ['amber', 'Off'], skipped: ['', 'Not checked'] };

  return h('div', { class: 'page' },
    pageHead('Test a call', '"Test" shows what would happen and saves nothing. "Simulate" runs the saved rules for real: it records the call and creates the callback task and messages.'),
    h('div', { class: 'test-layout' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Incoming call')),
        h('div', { class: 'card-body stack' },
          field('When', h('input', { class: 'input wide', type: 'datetime-local', value: f.at, onchange: bind('at') }), 'Your computer\'s time'),
          h('div', { class: 'grid-2' },
            field('Channel', h('select', { class: 'select', onchange: bind('channel') }, CHANNELS.map(([v, l]) => h('option', { value: v, selected: v === f.channel }, l)))),
            field('Why it reached the bot', h('select', { class: 'select', onchange: bind('forwardReason') },
              h('option', { value: '', selected: !f.forwardReason }, 'Dialled directly'),
              REASONS.map(([v, l]) => h('option', { value: v, selected: v === f.forwardReason }, l))))),
          field('Bot number called', h('select', { class: 'select', onchange: bind('botNumberId') },
            h('option', { value: '', selected: !f.botNumberId }, 'None / business number'),
            state.numbers.map((n) => h('option', { value: n.id, selected: n.id === f.botNumberId }, `${n.e164}${n.teamMemberId ? ` · ${memberName(n.teamMemberId)}` : ''}`)))),
          h('div', { class: 'grid-2' },
            field('Caller phone', h('input', { class: 'input', value: f.callerPhone, oninput: bind('callerPhone') })),
            field('Language', h('input', { class: 'input', value: f.language, placeholder: 'ta, hi, en…', oninput: bind('language') }))),
          field('Customer tags', h('input', { class: 'input', value: f.tags, placeholder: 'vip', oninput: bind('tags') }), 'Comma separated'),
          h('div', { class: 'stack' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.callerKnown, onchange: bind('callerKnown') }), 'Known customer'),
            isDirty() && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.useDraft, onchange: bind('useDraft') }), 'Test with my unsaved changes'),
            canEdit() && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.humanAnswered, onchange: bind('humanAnswered') }), 'A person answered (simulate only)'))),
        h('div', { class: 'add-bar' },
          btn('Test', run, { kind: 'primary', iconName: 'play' }),
          canEdit() && btn('Simulate a real call', simulate, { iconName: 'phone' }))),
      h('div', { class: 'card' },
        !t ? emptyState('route', 'No result yet', 'Fill in the call on the left and click Test to see which rule decides and what happens.') : [
          h('div', { class: 'result-hero' },
            h('div', { class: 'eyebrow' }, t.kind === 'simulated' ? 'Simulated call recorded' : 'Result'),
            h('h2', {}, t.decision.ruleId ? t.decision.ruleName : 'Otherwise (no rule matched)'),
            h('div', { class: 'row' },
              h('span', { class: 'badge' }, icon('clock'), `${labelOf(DAYS_SHORT, t.decision.localTime.day)} ${t.decision.localTime.date} ${t.decision.localTime.time}`),
              t.assignedMember && h('span', { class: 'badge brand' }, icon('users'), t.assignedMember))),
          h('div', { class: 'card-body' },
            h('ol', { class: 'steps' }, t.outcome.map((o, i) => h('li', {}, h('span', { class: 'step-no' }, i + 1), h('span', {}, o))))),
          t.decision.notes.length > 0 && h('div', { class: 'warn-box' }, h('strong', {}, 'Safety adjustments: '), t.decision.notes.join(' ')),
          h('details', {},
            h('summary', {}, h('span', { class: 'chev' }, icon('chevron')), 'How each rule was checked'),
            h('div', { class: 'details-body' },
              h('ul', { class: 'trace' }, t.decision.trace.map((r) => h('li', {},
                h('div', { class: 'row' }, h('span', { class: `badge ${statusBadge[r.status][0]}` }, statusBadge[r.status][1]), h('strong', {}, r.ruleName)),
                r.conditions.length > 0 && h('ul', { class: 'conds' }, r.conditions.map((c) =>
                  h('li', {}, h('span', { class: c.result ? 'ok' : 'no' }, icon(c.result ? 'check' : 'x')),
                    h('span', {}, `${CONDITIONS[c.type]?.label ?? c.type}: ${c.detail}`))))))))),
        ])));
}

// ---------- tasks ----------

async function loadActivity() {
  [state.tasks, state.notifications, state.calls] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/notifications'), api('GET', '/api/calls')]);
}

const isOverdue = (t) => t.status === 'open' && t.due_at && new Date(t.due_at) < new Date();

function tasksTab() {
  const levelName = (n) => (n === 0 ? 'Salesperson' : state.active.config.escalation.levels[n - 1]?.name ?? `Level ${n}`);
  const statusBadge = (t) => {
    if (t.status === 'done') return h('span', { class: 'badge green' }, icon('check'), 'Done');
    if (t.status === 'escalation_exhausted') return h('span', { class: 'badge red' }, 'Nobody left');
    if (isOverdue(t)) return h('span', { class: 'badge red' }, h('span', { class: 'dot' }), 'Overdue');
    return h('span', { class: 'badge blue' }, h('span', { class: 'dot' }), 'Open');
  };
  const open = state.tasks.filter((t) => t.status === 'open').length;
  const overdue = state.tasks.filter(isOverdue).length;
  const escalated = state.tasks.filter((t) => t.status === 'open' && t.escalation_level > 0).length;

  return h('div', { class: 'page' },
    pageHead('Tasks', 'Callbacks created when the AI answered, where each one is on the escalation ladder, and the messages sent to the team.',
      btn('Refresh', async () => { await loadActivity(); render(); }, { iconName: 'history' }),
      canEdit() && btn('Run escalation check', async () => {
        try { const r = await api('POST', '/api/tasks/run-escalation'); toast(`Escalated ${r.escalated}, nobody left for ${r.exhausted}`); await loadActivity(); render(); }
        catch (err) { toast(err.message); }
      }, { kind: 'primary', iconName: 'play' })),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Open callbacks'), h('div', { class: 'v' }, open)),
      h('div', { class: `stat${overdue ? ' alert' : ''}` }, h('div', { class: 'k' }, 'Overdue'), h('div', { class: 'v' }, overdue)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Escalated'), h('div', { class: 'v' }, escalated)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Calls handled'), h('div', { class: 'v' }, state.calls.length))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Callback tasks'), h('p', {}, 'The escalation check also runs automatically every minute.'))),
      state.tasks.length === 0 ? emptyState('tasks', 'No callbacks yet', 'Simulate a missed call on the Test page to create one.') :
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Caller', 'Salesperson', 'With now', 'Due', 'Status', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, state.tasks.map((t) => h('tr', {},
            h('td', {}, h('strong', {}, t.caller_phone), h('div', { class: 'sub' }, t.note ?? '')),
            h('td', {}, t.original_name ? h('div', { class: 'person' }, h('span', { class: 'avatar' }, initials(t.original_name)), t.original_name) : '—'),
            h('td', {}, h('div', {}, t.assigned_name ?? '—'), h('div', { class: 'sub' }, levelName(t.escalation_level))),
            h('td', { class: 'nowrap' }, fmtTime(t.due_at)),
            h('td', { class: 'nowrap' }, statusBadge(t)),
            h('td', {}, t.status !== 'done' && btn('Mark done', async () => {
              try { await api('POST', `/api/tasks/${t.id}/done`); await loadActivity(); toast('Marked done'); render(); } catch (err) { toast(err.message); }
            }, { size: 'sm', iconName: 'check' })))))))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Messages to the team'), h('p', {}, 'Queued until the WhatsApp/SMS sender is connected.'))),
        state.notifications.length === 0 ? emptyState('message', 'No messages yet', 'Messages appear when the AI handles a call.') :
          h('div', { class: 'card-body' }, h('ol', { class: 'steps' }, state.notifications.map((n) => h('li', {},
            h('span', { class: 'avatar' }, initials(n.member_name)),
            h('div', {}, h('div', { class: 'row' }, h('strong', {}, n.member_name ?? '—'), h('span', { class: 'badge green' }, n.via === 'sms' ? 'SMS' : 'WhatsApp'), h('span', { class: 'muted small' }, fmtTime(n.created_at))),
              h('div', { class: 'muted' }, n.message))))))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Recent calls'), h('p', {}, 'Which rule decided each call.'))),
        state.calls.length === 0 ? emptyState('phone', 'No calls yet', 'Calls appear here once they reach the assistant.') :
          h('div', { class: 'card-body' }, h('ol', { class: 'steps' }, state.calls.map((c) => h('li', {},
            h('span', { class: 'avatar' }, icon('phone')),
            h('div', {},
              h('div', { class: 'row' }, h('strong', {}, c.caller_phone), c.simulated && h('span', { class: 'badge' }, 'Simulated'), c.human_answered && h('span', { class: 'badge green' }, 'Person answered')),
              h('div', { class: 'muted small' }, `${fmtTime(c.created_at)} · ${c.member_name ?? 'no salesperson'} · ${c.rule_name} · rules v${c.config_version}`)))))))));
}

// ---------- history ----------

function historyTab() {
  return h('div', { class: 'page' },
    pageHead('History', 'Every save creates a new version. Restoring an old version saves it again as the newest, so nothing is ever lost.'),
    h('div', { class: 'card' },
      h('div', { class: 'card-body' },
        h('div', { class: 'ladder' }, state.versions.map((v) => h('div', { class: 'ladder-item' },
          h('span', { class: `ladder-dot${v.active ? '' : ' start'}` }, `v${v.version}`),
          h('div', { class: 'ladder-body' },
            h('div', {},
              h('div', { class: 'row' }, h('strong', {}, v.note ?? 'No note'), v.active && h('span', { class: 'badge green' }, h('span', { class: 'dot' }), 'In use')),
              h('div', { class: 'muted small' }, `${v.createdBy ?? 'Unknown'} · ${fmtTime(v.createdAt)}`)),
            h('span', { class: 'spacer' }),
            canEdit() && !v.active && btn('Restore', async () => {
              if (isDirty() && !confirm('You have unsaved changes. Restoring will discard them. Continue?')) return;
              if (!confirm(`Make version ${v.version} the rules in use?`)) return;
              try { const r = await api('POST', `/api/routing/versions/${v.version}/restore`); await loadConfig(); toast(`Version ${v.version} restored as v${r.version}`); render(); }
              catch (err) { toast(err.message); }
            }, { size: 'sm', iconName: 'history' }))))))));
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
    state.editingId = null;
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
    h('span', { class: 'dot' }),
    h('strong', {}, 'Unsaved changes'),
    canEdit() && h('input', { placeholder: 'What changed? (optional)', value: state.saveNote, 'aria-label': 'Change note', oninput: (e) => { state.saveNote = e.target.value; } }),
    btn('Discard', () => { if (confirm('Discard your unsaved changes?')) update(() => { state.draft = clone(state.active.config); state.issues = []; state.editingId = null; }); }, { kind: 'ghost' }),
    canEdit() && btn('Save changes', save, { kind: 'primary', iconName: 'check' }));
}

const TABS = [
  ['rules', 'Routing rules', 'rules'],
  ['hours', 'Hours and escalation', 'clock'],
  ['team', 'Team and numbers', 'users'],
  ['test', 'Test a call', 'play'],
  ['tasks', 'Tasks', 'tasks'],
  ['history', 'History', 'history'],
];

async function openTab(k) {
  state.tab = k;
  if (k === 'test' && state.testForm) state.testForm.at = localDateTimeValue();
  if (k === 'tasks') await loadActivity().catch(() => {});
  if (k === 'history') state.versions = await api('GET', '/api/routing/versions').catch(() => state.versions);
  render();
  document.querySelector('.main')?.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function sidebar() {
  const overdue = state.tasks.filter(isOverdue).length;
  return h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark' }, icon('route')),
      h('div', {}, h('div', { class: 'brand-name' }, 'Assistant console'), h('div', { class: 'brand-sub' }, state.me.tenantName))),
    h('nav', { class: 'nav', 'aria-label': 'Sections' }, TABS.map(([k, label, ic]) =>
      h('button', { class: `nav-item${state.tab === k ? ' active' : ''}`, 'aria-current': state.tab === k ? 'page' : null, onclick: () => openTab(k) },
        icon(ic), label,
        k === 'tasks' && overdue > 0 && h('span', { class: 'count' }, overdue),
        k === 'rules' && isDirty() && h('span', { class: 'count' }, '•')))),
    h('div', { class: 'sidebar-foot' },
      h('span', { class: 'avatar' }, initials(state.me.name)),
      h('div', { class: 'who' }, h('div', {}, h('strong', {}, state.me.name)), h('div', { class: 'muted small' }, state.me.role)),
      iconBtn('logout', 'Log out', async () => { await api('POST', '/api/auth/logout'); state.me = null; render(); })));
}

function render() {
  const root = document.getElementById('app');
  if (!state.me) { root.replaceChildren(loginView()); return; }
  const body = { rules: rulesTab, hours: hoursTab, team: teamTab, test: testTab, tasks: tasksTab, history: historyTab }[state.tab]();
  const main = h('main', { class: 'main' },
    state.issues.length > 0 && h('div', { class: 'page' }, h('div', { class: 'alert', role: 'alert' }, icon('info'),
      h('div', {}, h('strong', {}, 'Fix these before saving'), h('ul', {}, state.issues.map((i) => h('li', {}, issueText(i))))))),
    !canEdit() && h('div', { class: 'page' }, h('div', { class: 'banner' }, icon('lock'), 'You can view everything. Only owners and managers can change rules.')),
    body,
    saveBar());
  root.replaceChildren(h('div', { class: 'shell' }, sidebar(), main));
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
  return h('div', { class: 'login-wrap' }, h('div', { class: 'login' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('route')), h('div', {}, h('div', { class: 'brand-name' }, 'Assistant console'), h('div', { class: 'brand-sub' }, 'Calls, chats and callbacks'))),
    h('form', { class: 'card', onsubmit: submit },
      h('div', { class: 'card-body' },
        h('h2', {}, 'Log in'),
        h('p', { class: 'muted small' }, 'Use your company account.'),
        h('div', { class: 'stack' },
          field('Email', h('input', { class: 'input wide', type: 'email', autocomplete: 'username', required: true, oninput: (e) => { email = e.target.value; } })),
          field('Password', h('input', { class: 'input wide', type: 'password', autocomplete: 'current-password', required: true, oninput: (e) => { password = e.target.value; } }))),
        err,
        h('button', { class: 'btn primary', type: 'submit' }, 'Log in')))));
}

async function start() {
  try {
    state.me = await api('GET', '/api/me');
    [state.team, state.numbers] = await Promise.all([api('GET', '/api/team'), api('GET', '/api/bot-numbers')]);
    await loadConfig();
    await loadActivity().catch(() => {});
  } catch (err) {
    state.me = null;
    if (err.status !== 401) toast(err.message);
  }
  render();
}

window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
start();
