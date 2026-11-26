import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { withDatabase } from './config.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

/** Creates the app's limited login role and the database if they don't exist. Needs a superuser connection. */
export async function ensureDatabase(adminUrl: string, database: string, appRole: string, appPassword: string) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appRole]);
    const passwordLiteral = (await admin.query('SELECT quote_literal($1) AS q', [appPassword])).rows[0].q as string;
    if (role.rowCount === 0) {
      await admin.query(`CREATE ROLE ${quoteIdent(appRole)} LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOBYPASSRLS`);
    } else {
      await admin.query(`ALTER ROLE ${quoteIdent(appRole)} LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOBYPASSRLS`);
    }
    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (db.rowCount === 0) await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
  } finally {
    await admin.end();
  }
}

export async function dropDatabase(adminUrl: string, database: string) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** Applies pending migrations as the superuser, then grants the app role table access (RLS still applies to it). */
export async function migrate(adminUrl: string, database: string, appRole: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: withDatabase(adminUrl, database) });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    const r = quoteIdent(appRole);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
    await client.query(`REVOKE ALL ON schema_migrations FROM ${r}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
    await client.query(
      `GRANT EXECUTE ON FUNCTION auth_user_by_email(text), auth_create_session(text, uuid, timestamptz), auth_session(text),
         auth_delete_session(text), tenants_with_overdue_tasks() TO ${r}`,
    );
  } finally {
    await client.end();
  }
  return applied;
}
