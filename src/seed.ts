import pg from 'pg';
import { hashPassword } from './auth/password.js';
import { defaultRoutingConfig } from './routing/defaults.js';

export interface SeedOptions {
  tenantName: string;
  ownerEmail: string;
  ownerPassword: string;
  sampleTeam?: boolean;
  /** First digits of the placeholder bot numbers; bot numbers must be unique across all companies. */
  sampleNumberSeries?: string;
}

/**
 * Creates a client company with an owner login and the default rules. Runs as the superuser because
 * the company doesn't exist yet. Returns the tenant id; does nothing if the owner email is taken.
 */
export async function seedTenant(adminDbUrl: string, opts: SeedOptions): Promise<{ tenantId: string; created: boolean }> {
  const c = new pg.Client({ connectionString: adminDbUrl });
  await c.connect();
  try {
    const existing = await c.query('SELECT tenant_id FROM users WHERE lower(email) = lower($1)', [opts.ownerEmail]);
    if (existing.rowCount) return { tenantId: existing.rows[0].tenant_id, created: false };

    await c.query('BEGIN');
    const tenantId = (await c.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [opts.tenantName])).rows[0].id as string;
    const owner = await c.query(
      `INSERT INTO users (tenant_id, email, name, role, password_hash) VALUES ($1, $2, 'Owner', 'owner', $3) RETURNING id`,
      [tenantId, opts.ownerEmail, await hashPassword(opts.ownerPassword)],
    );

    if (opts.sampleTeam) {
      const add = async (name: string, role: string, crmRef: string | null, phone: string, backup: string | null = null) =>
        (await c.query(
          `INSERT INTO team_members (tenant_id, name, phone, crm_ref, role, backup_member_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, name, phone, crmRef, role, backup],
        )).rows[0].id as string;
      // Sample people and numbers only (the 90000 0000x range is a placeholder). Replace them in the console.
      const ceo = await add('CEO (sample)', 'ceo', null, '+919000000100');
      await add('Sales manager (sample)', 'manager', null, '+919000000101');
      const sp2 = await add('Salesperson 2 (sample)', 'salesperson', 'SE-002', '+919000000102');
      const sp1 = await add('Salesperson 1 (sample)', 'salesperson', 'SE-001', '+919000000103', sp2);
      await c.query('UPDATE team_members SET backup_member_id = $1 WHERE id = $2', [sp1, sp2]);
      const num = (e164: string, memberId: string, label: string) =>
        c.query(`INSERT INTO bot_numbers (tenant_id, e164, channel, team_member_id, label) VALUES ($1, $2, 'phone', $3, $4)`, [tenantId, e164, memberId, label]);
      const series = opts.sampleNumberSeries ?? '+9190000';
      await num(`${series}00001`, sp1, 'Salesperson 1 forwarding');
      await num(`${series}00002`, sp2, 'Salesperson 2 forwarding');
      await num(`${series}00009`, ceo, 'CEO forwarding');
    }

    await c.query(
      `INSERT INTO routing_config_versions (tenant_id, version, config, note, created_by) VALUES ($1, 1, $2, 'Default rules', $3)`,
      [tenantId, JSON.stringify(defaultRoutingConfig()), owner.rows[0].id],
    );
    await c.query('INSERT INTO routing_config_active (tenant_id, version) VALUES ($1, 1)', [tenantId]);
    await c.query('COMMIT');
    return { tenantId, created: true };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}
