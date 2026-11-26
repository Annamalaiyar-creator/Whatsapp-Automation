import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Pool } from '../db.js';
import { requireUser } from '../auth/session.js';
import { NotConfiguredError, recordCall } from '../calls/service.js';
import { escalateTenant } from '../escalation/worker.js';
import { formatIssues } from '../routing/schema.js';
import { audit } from '../repo.js';
import { callInputSchema, toIncomingCall } from './callInput.js';

const simulateBody = z.object({ call: callInputSchema, humanAnswered: z.boolean().default(false) });
const idParam = z.object({ id: z.uuid() });

export function callRoutes(app: FastifyInstance, pool: Pool) {
  const anyUser = { preHandler: requireUser(pool) };
  const editors = { preHandler: requireUser(pool, ['owner', 'manager']) };

  /** Runs a pretend call through the real pipeline: rules, call record, callback task, notifications. */
  app.post('/api/calls/simulate', editors, async (req, reply) => {
    const body = simulateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Check the test call details', issues: formatIssues(body.error) });
    const { tenantId, userId } = req.auth!;
    try {
      return await withTenant(pool, tenantId, async (c) => {
        const result = await recordCall(c, tenantId, toIncomingCall(body.data.call), body.data.humanAnswered, true);
        await audit(c, tenantId, userId, 'call.simulate', { callId: result.callId });
        return result;
      });
    } catch (err) {
      if (err instanceof NotConfiguredError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get('/api/calls', anyUser, async (req) =>
    withTenant(pool, req.auth!.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT c.id, c.channel, c.caller_phone, c.forward_reason, c.config_version, c.human_answered, c.simulated, c.created_at,
                c.decision->>'ruleName' AS rule_name, m.name AS member_name
           FROM calls c LEFT JOIN team_members m ON m.id = c.team_member_id
          ORDER BY c.created_at DESC LIMIT 100`,
      );
      return rows;
    }),
  );

  app.get('/api/tasks', anyUser, async (req) =>
    withTenant(pool, req.auth!.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT t.id, t.caller_phone, t.status, t.escalation_level, t.due_at, t.note, t.created_at, t.completed_at,
                a.name AS assigned_name, o.name AS original_name
           FROM tasks t
           LEFT JOIN team_members a ON a.id = t.assigned_member_id
           LEFT JOIN team_members o ON o.id = t.original_member_id
          ORDER BY (t.status = 'open') DESC, t.due_at NULLS LAST, t.created_at DESC LIMIT 200`,
      );
      return rows;
    }),
  );

  app.post('/api/tasks/:id/done', anyUser, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { tenantId, userId } = req.auth!;
    const n = await withTenant(pool, tenantId, async (c) => {
      const r = await c.query(`UPDATE tasks SET status = 'done', completed_at = now(), due_at = NULL, updated_at = now() WHERE id = $1 AND status <> 'done'`, [id]);
      if (r.rowCount) await audit(c, tenantId, userId, 'task.done', { id });
      return r.rowCount;
    });
    return n ? { ok: true } : reply.code(404).send({ error: 'Open task not found' });
  });

  /** Runs this company's escalation check now instead of waiting for the next automatic run. */
  app.post('/api/tasks/run-escalation', editors, async (req) => {
    const { tenantId } = req.auth!;
    return withTenant(pool, tenantId, (c) => escalateTenant(c, tenantId, new Date()));
  });

  app.get('/api/notifications', anyUser, async (req) =>
    withTenant(pool, req.auth!.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT n.id, n.via, n.message, n.created_at, n.sent_at, m.name AS member_name
           FROM notifications n LEFT JOIN team_members m ON m.id = n.member_id
          ORDER BY n.created_at DESC LIMIT 100`,
      );
      return rows;
    }),
  );
}
