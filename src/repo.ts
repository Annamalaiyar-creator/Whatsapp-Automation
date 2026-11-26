import type { Client } from './db.js';
import { routingConfigSchema, type RoutingConfig } from './routing/schema.js';
import type { Member } from './routing/targets.js';

/** Data access. Every function takes a client from withTenant(), so row-level security scopes it to one tenant. */

export async function listMembers(c: Client): Promise<(Member & { crmRef: string | null })[]> {
  const { rows } = await c.query(
    `SELECT id, name, phone, crm_ref, role, status, active, backup_member_id FROM team_members ORDER BY role, name`,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, crmRef: r.crm_ref, role: r.role, status: r.status, active: r.active, backupMemberId: r.backup_member_id,
  }));
}

export interface BotNumber {
  id: string;
  e164: string;
  channel: 'phone' | 'whatsapp';
  teamMemberId: string | null;
  label: string | null;
}

export async function listBotNumbers(c: Client): Promise<BotNumber[]> {
  const { rows } = await c.query(`SELECT id, e164, channel, team_member_id, label FROM bot_numbers ORDER BY e164`);
  return rows.map((r) => ({ id: r.id, e164: r.e164, channel: r.channel, teamMemberId: r.team_member_id, label: r.label }));
}

export interface ConfigVersion {
  version: number;
  config: RoutingConfig;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export async function getActiveConfig(c: Client): Promise<ConfigVersion | null> {
  const { rows } = await c.query(
    `SELECT v.version, v.config, v.note, v.created_at, u.name AS created_by
       FROM routing_config_active a
       JOIN routing_config_versions v ON v.tenant_id = a.tenant_id AND v.version = a.version
       LEFT JOIN users u ON u.id = v.created_by`,
  );
  const r = rows[0];
  if (!r) return null;
  // Stored versions were validated on save; parse again so a hand-edited row can't break routing.
  return { version: r.version, config: routingConfigSchema.parse(r.config), note: r.note, createdAt: r.created_at, createdBy: r.created_by };
}

export async function listConfigVersions(c: Client, limit = 50) {
  const { rows } = await c.query(
    `SELECT v.version, v.note, v.created_at, u.name AS created_by, (a.version = v.version) AS active
       FROM routing_config_versions v
       LEFT JOIN users u ON u.id = v.created_by
       LEFT JOIN routing_config_active a ON a.tenant_id = v.tenant_id
      ORDER BY v.version DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ version: r.version, note: r.note, createdAt: r.created_at, createdBy: r.created_by, active: Boolean(r.active) }));
}

export async function getConfigVersion(c: Client, version: number): Promise<RoutingConfig | null> {
  const { rows } = await c.query(`SELECT config FROM routing_config_versions WHERE version = $1`, [version]);
  return rows[0] ? routingConfigSchema.parse(rows[0].config) : null;
}

/** Saves a new version and makes it active. Old versions are kept for history and rollback. */
export async function publishConfig(c: Client, tenantId: string, cfg: RoutingConfig, userId: string | null, note: string | null): Promise<number> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('routing:' || $1))`, [tenantId]);
  const { rows } = await c.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM routing_config_versions`);
  const version = rows[0].next as number;
  await c.query(
    `INSERT INTO routing_config_versions (tenant_id, version, config, note, created_by) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, version, JSON.stringify(cfg), note, userId],
  );
  await c.query(
    `INSERT INTO routing_config_active (tenant_id, version) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET version = EXCLUDED.version, updated_at = now()`,
    [tenantId, version],
  );
  return version;
}

export async function audit(c: Client, tenantId: string, userId: string | null, action: string, details: unknown) {
  await c.query(`INSERT INTO audit_log (tenant_id, user_id, action, details) VALUES ($1, $2, $3, $4)`, [tenantId, userId, action, JSON.stringify(details ?? null)]);
}
