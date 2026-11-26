import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Pool } from '../db.js';
import { requireUser } from '../auth/session.js';
import { formatIssues, MEMBER_ROLES, MEMBER_STATUSES } from '../routing/schema.js';
import { audit, listBotNumbers, listMembers } from '../repo.js';

const e164 = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, for example +919876543210');

const memberBody = z.object({
  name: z.string().trim().min(1).max(120),
  phone: e164.nullable().default(null),
  crmRef: z.string().trim().max(60).nullable().default(null),
  role: z.enum(MEMBER_ROLES),
  backupMemberId: z.uuid().nullable().default(null),
  status: z.enum(MEMBER_STATUSES).default('available'),
  active: z.boolean().default(true),
});
const memberPatch = memberBody.partial();

const numberBody = z.object({
  e164,
  channel: z.enum(['phone', 'whatsapp']),
  teamMemberId: z.uuid().nullable().default(null),
  label: z.string().trim().max(80).nullable().default(null),
});
const numberPatch = numberBody.partial();
const idParam = z.object({ id: z.uuid() });

function isUniqueViolation(err: unknown) {
  return (err as { code?: string }).code === '23505';
}
function isForeignKeyViolation(err: unknown) {
  return (err as { code?: string }).code === '23503';
}

export function teamRoutes(app: FastifyInstance, pool: Pool) {
  const anyUser = { preHandler: requireUser(pool) };
  const editors = { preHandler: requireUser(pool, ['owner', 'manager']) };

  app.get('/api/team', anyUser, async (req) => withTenant(pool, req.auth!.tenantId, listMembers));

  app.post('/api/team', editors, async (req, reply) => {
    const body = memberBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Check the team member details', issues: formatIssues(body.error) });
    const { tenantId, userId } = req.auth!;
    const m = body.data;
    try {
      return await withTenant(pool, tenantId, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO team_members (tenant_id, name, phone, crm_ref, role, backup_member_id, status, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tenantId, m.name, m.phone, m.crmRef, m.role, m.backupMemberId, m.status, m.active],
        );
        await audit(c, tenantId, userId, 'team.create', { id: rows[0].id, name: m.name });
        return { id: rows[0].id };
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) return reply.code(400).send({ error: 'The backup person was not found' });
      throw err;
    }
  });

  app.patch('/api/team/:id', editors, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = memberPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Check the team member details', issues: formatIssues(body.error) });
    if (body.data.backupMemberId === id) return reply.code(400).send({ error: 'A person cannot be their own backup' });
    const cols: Record<string, string> = { name: 'name', phone: 'phone', crmRef: 'crm_ref', role: 'role', backupMemberId: 'backup_member_id', status: 'status', active: 'active' };
    const entries = Object.entries(body.data).filter(([k, v]) => v !== undefined && k in cols);
    if (!entries.length) return reply.code(400).send({ error: 'Nothing to change' });
    const { tenantId, userId } = req.auth!;
    try {
      const updated = await withTenant(pool, tenantId, async (c) => {
        const sets = entries.map(([k], i) => `${cols[k]} = $${i + 2}`).join(', ');
        const r = await c.query(`UPDATE team_members SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
        if (r.rowCount) await audit(c, tenantId, userId, 'team.update', { id, changes: Object.fromEntries(entries) });
        return r.rowCount;
      });
      return updated ? { ok: true } : reply.code(404).send({ error: 'Team member not found' });
    } catch (err) {
      if (isForeignKeyViolation(err)) return reply.code(400).send({ error: 'The backup person was not found' });
      throw err;
    }
  });

  app.get('/api/bot-numbers', anyUser, async (req) => withTenant(pool, req.auth!.tenantId, listBotNumbers));

  app.post('/api/bot-numbers', editors, async (req, reply) => {
    const body = numberBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Check the number details', issues: formatIssues(body.error) });
    const { tenantId, userId } = req.auth!;
    const n = body.data;
    try {
      return await withTenant(pool, tenantId, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO bot_numbers (tenant_id, e164, channel, team_member_id, label) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenantId, n.e164, n.channel, n.teamMemberId, n.label],
        );
        await audit(c, tenantId, userId, 'bot_number.create', { id: rows[0].id, e164: n.e164 });
        return { id: rows[0].id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'That number is already in use' });
      if (isForeignKeyViolation(err)) return reply.code(400).send({ error: 'That team member was not found' });
      throw err;
    }
  });

  app.patch('/api/bot-numbers/:id', editors, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = numberPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Check the number details', issues: formatIssues(body.error) });
    const cols: Record<string, string> = { e164: 'e164', channel: 'channel', teamMemberId: 'team_member_id', label: 'label' };
    const entries = Object.entries(body.data).filter(([k, v]) => v !== undefined && k in cols);
    if (!entries.length) return reply.code(400).send({ error: 'Nothing to change' });
    const { tenantId, userId } = req.auth!;
    try {
      const updated = await withTenant(pool, tenantId, async (c) => {
        const sets = entries.map(([k], i) => `${cols[k]} = $${i + 2}`).join(', ');
        const r = await c.query(`UPDATE bot_numbers SET ${sets} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
        if (r.rowCount) await audit(c, tenantId, userId, 'bot_number.update', { id, changes: Object.fromEntries(entries) });
        return r.rowCount;
      });
      return updated ? { ok: true } : reply.code(404).send({ error: 'Number not found' });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'That number is already in use' });
      if (isForeignKeyViolation(err)) return reply.code(400).send({ error: 'That team member was not found' });
      throw err;
    }
  });

  app.delete('/api/bot-numbers/:id', editors, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { tenantId, userId } = req.auth!;
    const deleted = await withTenant(pool, tenantId, async (c) => {
      const r = await c.query(`DELETE FROM bot_numbers WHERE id = $1`, [id]);
      if (r.rowCount) await audit(c, tenantId, userId, 'bot_number.delete', { id });
      return r.rowCount;
    });
    return deleted ? { ok: true } : reply.code(404).send({ error: 'Number not found' });
  });
}
