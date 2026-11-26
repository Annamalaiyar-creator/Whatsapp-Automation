import { config, databaseName, userName } from '../src/config.js';
import { ensureDatabase, migrate } from '../src/dbAdmin.js';

const url = config.databaseUrl();
const database = databaseName(url);
const role = userName(url);
await ensureDatabase(config.databaseAdminUrl(), database, role, config.appDbPassword());
const applied = await migrate(config.databaseAdminUrl(), database, role);
console.log(`Database "${database}" ready for role "${role}". Migrations applied: ${applied.length ? applied.join(', ') : 'none (up to date)'}`);
