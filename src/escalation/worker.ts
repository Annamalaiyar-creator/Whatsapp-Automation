import { withTenant, type Client, type Pool } from '../db.js';
import { getActiveConfig, listMembers } from '../repo.js';
import { planEscalation } from './plan.js';

/** Moves every overdue callback task of one tenant to its next escalation level. */
export async function escalateTenant(c: Client, tenantId: string, now: Date) {
  const active = await getActiveConfig(c);
  if (!active) return { escalated: 0, exhausted: 0 };
  const members = await listMembers(c);
  const { rows } = await c.query(
    `SELECT id, caller_phone, escalation_level, original_member_id, assigned_member_id
       FROM tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= $1
       ORDER BY due_at FOR UPDATE SKIP LOCKED`,
    [now],
  );
  let escalated = 0;
  let exhausted = 0;
  for (const t of rows) {
    const step = planEscalation(
      { escalationLevel: t.escalation_level, originalMemberId: t.original_member_id, assignedMemberId: t.assigned_member_id },
      active.config, members, now,
    );
    if (step.kind === 'exhausted') {
      await c.query(`UPDATE tasks SET status = 'escalation_exhausted', due_at = NULL, updated_at = now() WHERE id = $1`, [t.id]);
      exhausted++;
      continue;
    }
    await c.query(
      `UPDATE tasks SET assigned_member_id = $2, escalation_level = $3, due_at = $4, updated_at = now() WHERE id = $1`,
      [t.id, step.member.id, step.level, step.dueAt],
    );
    const original = members.find((m) => m.id === t.original_member_id);
    await c.query(
      `INSERT INTO notifications (tenant_id, task_id, member_id, via, message) VALUES ($1, $2, $3, 'whatsapp', $4)`,
      [tenantId, t.id, step.member.id,
        `Escalated to you (${step.levelName}): ${t.caller_phone} still needs a call back${original ? ` for ${original.name}` : ''}.`],
    );
    escalated++;
  }
  return { escalated, exhausted };
}

/** Runs the escalation check for every tenant that has overdue tasks. */
export async function runEscalationTick(pool: Pool, now = new Date()) {
  const { rows } = await pool.query('SELECT tenant_id FROM tenants_with_overdue_tasks()');
  let escalated = 0;
  let exhausted = 0;
  for (const r of rows) {
    const res = await withTenant(pool, r.tenant_id, (c) => escalateTenant(c, r.tenant_id, now));
    escalated += res.escalated;
    exhausted += res.exhausted;
  }
  return { escalated, exhausted };
}
