import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Pool } from '../db.js';
import { requireUser } from '../auth/session.js';
import { buildContext, describeOutcome, NotConfiguredError } from '../calls/service.js';
import { decide } from '../routing/engine.js';
import { formatIssues, routingConfigSchema } from '../routing/schema.js';
import { audit, getActiveConfig, getConfigVersion, listConfigVersions, publishConfig } from '../repo.js';
import { callInputSchema, toIncomingCall } from './callInput.js';

const saveBody = z.object({ config: z.unknown(), note: z.string().trim().max(300).optional() });
const testBody = z.object({ config: z.unknown().optional(), call: callInputSchema });
const versionParam = z.object({ version: z.coerce.number().int().min(1) });

export function routingRoutes(app: FastifyInstance, pool: Pool) {
  const anyUser = { preHandler: requireUser(pool) };
  const editors = { preHandler: requireUser(pool, ['owner', 'manager']) };

  app.get('/api/routing/config', anyUser, async (req, reply) => {
    const active = await withTenant(pool, req.auth!.tenantId, getActiveConfig);
    if (!active) return reply.code(404).send({ error: 'No routing rules saved yet' });
    return active;
  });

  app.post('/api/routing/validate', anyUser, async (req) => {
    const parsed = routingConfigSchema.safeParse((req.body as { config?: unknown })?.config);
    return parsed.success ? { valid: true, issues: [] } : { valid: false, issues: formatIssues(parsed.error) };
  });

  /** Saving publishes a new version. It takes effect for the next call. */
  app.put('/api/routing/config', editors, async (req, reply) => {
    const body = saveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid request', issues: formatIssues(body.error) });
    const parsed = routingConfigSchema.safeParse(body.data.config);
    if (!parsed.success) return reply.code(400).send({ error: 'Some rules need fixing', issues: formatIssues(parsed.error) });
    const { tenantId, userId } = req.auth!;
    const version = await withTenant(pool, tenantId, async (c) => {
      const v = await publishConfig(c, tenantId, parsed.data, userId, body.data.note ?? null);
      await audit(c, tenantId, userId, 'routing.publish', { version: v, note: body.data.note ?? null });
      return v;
    });
    return { version };
  });

  app.get('/api/routing/versions', anyUser, async (req) => withTenant(pool, req.auth!.tenantId, (c) => listConfigVersions(c)));

  app.get('/api/routing/versions/:version', anyUser, async (req, reply) => {
    const { version } = versionParam.parse(req.params);
    const cfg = await withTenant(pool, req.auth!.tenantId, (c) => getConfigVersion(c, version));
    return cfg ? { version, config: cfg } : reply.code(404).send({ error: 'Version not found' });
  });

  /** Rolling back copies an old version into a new one, so history is never rewritten. */
  app.post('/api/routing/versions/:version/restore', editors, async (req, reply) => {
    const { version } = versionParam.parse(req.params);
    const { tenantId, userId } = req.auth!;
    const result = await withTenant(pool, tenantId, async (c) => {
      const cfg = await getConfigVersion(c, version);
      if (!cfg) return null;
      const v = await publishConfig(c, tenantId, cfg, userId, `Restored version ${version}`);
      await audit(c, tenantId, userId, 'routing.restore', { from: version, version: v });
      return v;
    });
    return result ? { version: result } : reply.code(404).send({ error: 'Version not found' });
  });

  /** Dry run: shows what would happen to a call, optionally with unsaved changes. Writes nothing. */
  app.post('/api/routing/test', anyUser, async (req, reply) => {
    const body = testBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Check the test call details', issues: formatIssues(body.error) });
    try {
      return await withTenant(pool, req.auth!.tenantId, async (c) => {
        let cfg;
        if (body.data.config !== undefined) {
          const parsed = routingConfigSchema.safeParse(body.data.config);
          if (!parsed.success) return reply.code(400).send({ error: 'Some rules need fixing', issues: formatIssues(parsed.error) });
          cfg = parsed.data;
        } else {
          cfg = (await getActiveConfig(c))?.config;
          if (!cfg) return reply.code(404).send({ error: 'No routing rules saved yet' });
        }
        const { ctx, members, assigned } = await buildContext(c, toIncomingCall(body.data.call));
        const decision = decide(cfg, ctx);
        return { decision, outcome: describeOutcome(decision, assigned, members, cfg), assignedMember: assigned?.name ?? null };
      });
    } catch (err) {
      if (err instanceof NotConfiguredError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
