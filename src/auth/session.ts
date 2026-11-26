import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../db.js';
import { hashToken } from './password.js';

export const SESSION_COOKIE = 'wa_session';
export type UserRole = 'owner' | 'manager' | 'agent';

export interface AuthInfo {
  userId: string;
  tenantId: string;
  tenantName: string;
  name: string;
  email: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthInfo;
  }
}

export async function loadSession(pool: Pool, token: string | undefined): Promise<AuthInfo | null> {
  if (!token) return null;
  const { rows } = await pool.query('SELECT * FROM auth_session($1)', [hashToken(token)]);
  const r = rows[0];
  if (!r) return null;
  return { userId: r.user_id, tenantId: r.tenant_id, tenantName: r.tenant_name, name: r.name, email: r.email, role: r.role };
}

/** Route guard: requires a logged-in user, optionally with one of the given roles. */
export function requireUser(pool: Pool, roles?: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await loadSession(pool, req.cookies[SESSION_COOKIE]);
    if (!auth) return reply.code(401).send({ error: 'Please log in' });
    if (roles && !roles.includes(auth.role)) return reply.code(403).send({ error: 'Your role is not allowed to do this' });
    req.auth = auth;
  };
}
