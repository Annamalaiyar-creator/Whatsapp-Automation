import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Pool } from './db.js';
import { formatIssues } from './routing/schema.js';
import { authRoutes } from './routes/auth.js';
import { callRoutes } from './routes/calls.js';
import { routingRoutes } from './routes/routing.js';
import { teamRoutes } from './routes/team.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export async function buildApp(pool: Pool, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 512 * 1024 });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // State-changing requests must be JSON. Browsers can't send cross-site JSON without CORS, which blocks CSRF.
  app.addHook('onRequest', async (req, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.url.startsWith('/api/')) {
      const type = req.headers['content-type'] ?? '';
      if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !type.startsWith('application/json')) {
        return reply.code(415).send({ error: 'Send JSON' });
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: formatIssues(err) });
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status < 500) return reply.code(status).send({ error: message ?? 'Request failed' });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong. Try again.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(app, pool);
  routingRoutes(app, pool);
  teamRoutes(app, pool);
  callRoutes(app, pool);

  await app.register(fastifyStatic, { root: publicDir, index: 'index.html' });
  return app;
}
