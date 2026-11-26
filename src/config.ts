import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4600),
  databaseUrl: () => required('DATABASE_URL'),
  databaseAdminUrl: () => required('DATABASE_ADMIN_URL'),
  appDbPassword: () => required('APP_DB_PASSWORD'),
  testDatabaseName: process.env.TEST_DATABASE_NAME ?? 'wa_automation_test',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  escalationTickSeconds: Number(process.env.ESCALATION_TICK_SECONDS ?? 60),
  secureCookies: process.env.NODE_ENV === 'production',
};

/** Returns the same connection string pointed at another database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function userName(url: string): string {
  return decodeURIComponent(new URL(url).username);
}
