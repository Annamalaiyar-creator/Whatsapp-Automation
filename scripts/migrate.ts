import { config, databaseName, userName } from '../src/config.js';
import { migrate } from '../src/dbAdmin.js';

const url = config.databaseUrl();
const applied = await migrate(config.databaseAdminUrl(), databaseName(url), userName(url));
console.log(`Migrations applied: ${applied.length ? applied.join(', ') : 'none (up to date)'}`);
