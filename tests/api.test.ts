import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { config, userName, withDatabase } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { dropDatabase, ensureDatabase, migrate } from '../src/dbAdmin.js';
import { defaultRoutingConfig } from '../src/routing/defaults.js';
import { seedTenant } from '../src/seed.js';

const testDb = config.testDatabaseName;
const adminUrl = config.databaseAdminUrl();
const adminDbUrl = withDatabase(adminUrl, testDb);
const appRole = userName(config.databaseUrl());
const PASSWORD = 'test-password-for-local-tests';

let pool: Pool;
let app: FastifyInstance;
let tenantA: string;

async function login(email: string, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const cookie = res.cookies.find((c) => c.name === 'wa_session');
  return { res, headers: cookie ? { cookie: `wa_session=${cookie.value}` } : {} };
}

beforeAll(async () => {
  await dropDatabase(adminUrl, testDb);
  await ensureDatabase(adminUrl, testDb, appRole, config.appDbPassword());
  await migrate(adminUrl, testDb, appRole);
  tenantA = (await seedTenant(adminDbUrl, { tenantName: 'Company A', ownerEmail: 'owner-a@example.test', ownerPassword: PASSWORD, sampleTeam: true })).tenantId;
  await seedTenant(adminDbUrl, { tenantName: 'Company B', ownerEmail: 'owner-b@example.test', ownerPassword: PASSWORD, sampleTeam: true, sampleNumberSeries: '+9190001' });
  const admin = new pg.Client({ connectionString: adminDbUrl });
  await admin.connect();
  await admin.query(`INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES ($1, 'agent-a@example.test', 'Agent', 'agent', $2)`, [tenantA, await hashPassword(PASSWORD)]);
  await admin.end();
  pool = createPool(withDatabase(config.databaseUrl(), testDb));
  app = await buildApp(pool);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('login', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    expect((await login('owner-a@example.test', 'wrong')).res.statusCode).toBe(401);
    const ok = await login('owner-a@example.test');
    expect(ok.res.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: ok.headers });
    expect(me.json()).toMatchObject({ role: 'owner', tenantName: 'Company A' });
  });

  it('requires a login for the API', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/routing/config' })).statusCode).toBe(401);
  });
});

describe('changing rules', () => {
  it('rejects invalid rules with readable messages', async () => {
    const { headers } = await login('owner-a@example.test');
    const bad = { ...defaultRoutingConfig(), fallback: { actions: [{ type: 'create_callback_task' }] } };
    const res = await app.inject({ method: 'PUT', url: '/api/routing/config', headers, payload: { config: bad } });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].message).toMatch(/needs an action that answers/);
  });

  it('saves a new version, keeps history and can roll back', async () => {
    const { headers } = await login('owner-a@example.test');
    const cfg = defaultRoutingConfig();
    cfg.callback.deadlineMinutes = 45;
    const saved = await app.inject({ method: 'PUT', url: '/api/routing/config', headers, payload: { config: cfg, note: 'Longer callback time' } });
    expect(saved.json()).toEqual({ version: 2 });

    const active = await app.inject({ method: 'GET', url: '/api/routing/config', headers });
    expect(active.json().config.callback.deadlineMinutes).toBe(45);

    const restored = await app.inject({ method: 'POST', url: '/api/routing/versions/1/restore', headers });
    expect(restored.json()).toEqual({ version: 3 });
    const versions = (await app.inject({ method: 'GET', url: '/api/routing/versions', headers })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0]).toMatchObject({ active: true, note: 'Restored version 1' });
  });

  it('agents can view rules but not change them', async () => {
    const { headers } = await login('agent-a@example.test');
    expect((await app.inject({ method: 'GET', url: '/api/routing/config', headers })).statusCode).toBe(200);
    const res = await app.inject({ method: 'PUT', url: '/api/routing/config', headers, payload: { config: defaultRoutingConfig() } });
    expect(res.statusCode).toBe(403);
  });
});

describe('testing and simulating calls', () => {
  it('the rule tester explains the decision with real names, and can test unsaved rules', async () => {
    const { headers } = await login('owner-a@example.test');
    const numbers = (await app.inject({ method: 'GET', url: '/api/bot-numbers', headers })).json();
    const sp1Number = numbers.find((n: { e164: string }) => n.e164 === '+919000000001');
    const call = { at: '2026-12-01T19:40:00+05:30', channel: 'phone', botNumberId: sp1Number.id, forwardReason: 'no_answer', callerPhone: '+919811111111' };

    const saved = await app.inject({ method: 'POST', url: '/api/routing/test', headers, payload: { call } });
    expect(saved.json().decision.ruleId).toBe('after-hours');
    expect(saved.json().assignedMember).toBe('Salesperson 1 (sample)');

    const draft = defaultRoutingConfig();
    draft.rules = draft.rules.filter((r) => r.id !== 'after-hours');
    const unsaved = await app.inject({ method: 'POST', url: '/api/routing/test', headers, payload: { call, config: draft } });
    expect(unsaved.json().decision.ruleId).toBe('missed-or-off');
  });

  it('a missed call creates a callback task, which escalates to the backup person when overdue', async () => {
    const { headers } = await login('owner-a@example.test');
    const numbers = (await app.inject({ method: 'GET', url: '/api/bot-numbers', headers })).json();
    const sp1Number = numbers.find((n: { e164: string }) => n.e164 === '+919000000001');
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const sim = await app.inject({
      method: 'POST', url: '/api/calls/simulate', headers,
      payload: { call: { at: twoHoursAgo, channel: 'phone', botNumberId: sp1Number.id, forwardReason: 'busy', callerPhone: '+919822222222' } },
    });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().taskId).toBeTruthy();

    const notes = (await app.inject({ method: 'GET', url: '/api/notifications', headers })).json();
    expect(notes[0]).toMatchObject({ member_name: 'Salesperson 1 (sample)', via: 'whatsapp' });

    const esc = await app.inject({ method: 'POST', url: '/api/tasks/run-escalation', headers });
    expect(esc.json()).toMatchObject({ escalated: 1 });
    const tasks = (await app.inject({ method: 'GET', url: '/api/tasks', headers })).json();
    const task = tasks.find((t: { id: string }) => t.id === sim.json().taskId);
    expect(task).toMatchObject({ assigned_name: 'Salesperson 2 (sample)', escalation_level: 1, status: 'open' });

    const done = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/done`, headers });
    expect(done.statusCode).toBe(200);
  });

  it('no callback task when a person answered', async () => {
    const { headers } = await login('owner-a@example.test');
    const sim = await app.inject({
      method: 'POST', url: '/api/calls/simulate', headers,
      payload: { humanAnswered: true, call: { channel: 'phone', botNumberId: null, forwardReason: null, callerPhone: '+919833333333' } },
    });
    expect(sim.json().taskId).toBeNull();
  });
});

describe('company data is kept apart', () => {
  it('company B cannot see or change company A data', async () => {
    const a = await login('owner-a@example.test');
    const b = await login('owner-b@example.test');
    const teamA = (await app.inject({ method: 'GET', url: '/api/team', headers: a.headers })).json();
    const teamB = (await app.inject({ method: 'GET', url: '/api/team', headers: b.headers })).json();
    const idsA = new Set(teamA.map((m: { id: string }) => m.id));
    expect(teamB.some((m: { id: string }) => idsA.has(m.id))).toBe(false);

    const patch = await app.inject({ method: 'PATCH', url: `/api/team/${teamA[0].id}`, headers: b.headers, payload: { status: 'away' } });
    expect(patch.statusCode).toBe(404);

    const tasksB = (await app.inject({ method: 'GET', url: '/api/tasks', headers: b.headers })).json();
    expect(tasksB).toEqual([]);
    const versionsB = (await app.inject({ method: 'GET', url: '/api/routing/versions', headers: b.headers })).json();
    expect(versionsB.map((v: { version: number }) => v.version)).toEqual([1]);
  });

  it('the database itself returns nothing when no company is selected', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM team_members');
    expect(rows[0].n).toBe(0);
  });
});
