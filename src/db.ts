import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * Runs fn inside a transaction scoped to one tenant. Row-level security uses app.tenant_id,
 * so every query in fn can only read and write that tenant's rows.
 */
export async function withTenant<T>(pool: Pool, tenantId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
