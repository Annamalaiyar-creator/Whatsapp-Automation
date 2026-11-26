import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { Pool } from '../db.js';
import { hashToken, newSessionToken, verifyPassword } from '../auth/password.js';
import { requireUser, SESSION_COOKIE } from '../auth/session.js';

const loginBody = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

export function authRoutes(app: FastifyInstance, pool: Pool) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter your email and password' });
    const { rows } = await pool.query('SELECT * FROM auth_user_by_email($1)', [body.data.email]);
    const user = rows[0];
    const ok = await verifyPassword(body.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) return reply.code(401).send({ error: 'Email or password is wrong' });

    const token = newSessionToken();
    const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
    await pool.query('SELECT auth_create_session($1, $2, $3)', [hashToken(token), user.id, expires]);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/', expires,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await pool.query('SELECT auth_delete_session($1)', [hashToken(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser(pool) }, async (req) => {
    const a = req.auth!;
    return { name: a.name, email: a.email, role: a.role, tenantName: a.tenantName };
  });
}
