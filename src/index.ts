import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { runEscalationTick } from './escalation/worker.js';

const pool = createPool(config.databaseUrl());
const app = await buildApp(pool, { logger: true });

const timer = setInterval(() => {
  runEscalationTick(pool)
    .then((r) => r.escalated + r.exhausted > 0 && app.log.info(r, 'escalation check'))
    .catch((err) => app.log.error(err, 'escalation check failed'));
}, config.escalationTickSeconds * 1000);

async function shutdown() {
  clearInterval(timer);
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '127.0.0.1' });
