import { describe, expect, it } from 'vitest';
import { planEscalation } from '../src/escalation/plan.js';
import { defaultRoutingConfig } from '../src/routing/defaults.js';
import type { Member } from '../src/routing/targets.js';

const m = (id: string, role: Member['role'], extra: Partial<Member> = {}): Member => ({
  id, name: id, phone: null, role, status: 'available', active: true, backupMemberId: null, ...extra,
});

const now = new Date('2026-12-01T10:00:00Z');
const cfg = defaultRoutingConfig();

describe('escalation ladder: salesperson → backup → manager → CEO', () => {
  const team = [m('sp', 'salesperson', { backupMemberId: 'bk' }), m('bk', 'salesperson'), m('mgr', 'manager'), m('ceo', 'ceo')];

  it('goes to the backup person first, with a new deadline', () => {
    const step = planEscalation({ escalationLevel: 0, originalMemberId: 'sp', assignedMemberId: 'sp' }, cfg, team, now);
    expect(step).toMatchObject({ kind: 'escalate', level: 1, member: { id: 'bk' }, dueAt: new Date('2026-12-01T10:30:00Z') });
  });

  it('then the manager, then the CEO with no further deadline', () => {
    const two = planEscalation({ escalationLevel: 1, originalMemberId: 'sp', assignedMemberId: 'bk' }, cfg, team, now);
    expect(two).toMatchObject({ kind: 'escalate', level: 2, member: { id: 'mgr' } });
    const three = planEscalation({ escalationLevel: 2, originalMemberId: 'sp', assignedMemberId: 'mgr' }, cfg, team, now);
    expect(three).toMatchObject({ kind: 'escalate', level: 3, member: { id: 'ceo' }, dueAt: null });
  });

  it('stops after the last level', () => {
    expect(planEscalation({ escalationLevel: 3, originalMemberId: 'sp', assignedMemberId: 'ceo' }, cfg, team, now).kind).toBe('exhausted');
  });

  it('skips a level with nobody available', () => {
    const noBackup = [m('sp', 'salesperson'), m('mgr', 'manager', { status: 'on_leave' }), m('ceo', 'ceo')];
    const step = planEscalation({ escalationLevel: 0, originalMemberId: 'sp', assignedMemberId: 'sp' }, cfg, noBackup, now);
    expect(step).toMatchObject({ kind: 'escalate', level: 3, member: { id: 'ceo' } });
    expect(step.skipped).toHaveLength(2);
  });

  it('can go straight to the CEO when that is the only level configured', () => {
    const ceoOnly = { ...cfg, escalation: { levels: [{ name: 'CEO', target: { kind: 'role' as const, role: 'ceo' as const }, deadlineMinutes: null }] } };
    expect(planEscalation({ escalationLevel: 0, originalMemberId: 'sp', assignedMemberId: 'sp' }, ceoOnly, team, now)).toMatchObject({ member: { id: 'ceo' } });
  });
});
