import { config, databaseName, withDatabase } from '../src/config.js';
import { seedTenant } from '../src/seed.js';

const email = process.env.DEV_OWNER_EMAIL;
const password = process.env.DEV_OWNER_PASSWORD;
if (!email || !password || password === 'CHANGE_ME') {
  throw new Error('Set DEV_OWNER_EMAIL and DEV_OWNER_PASSWORD in .env first.');
}

const adminDbUrl = withDatabase(config.databaseAdminUrl(), databaseName(config.databaseUrl()));
const { created } = await seedTenant(adminDbUrl, { tenantName: 'Businz', ownerEmail: email, ownerPassword: password, sampleTeam: true });
console.log(created
  ? `Created company "Businz" with sample team and default rules. Log in as ${email} (password is DEV_OWNER_PASSWORD in .env).`
  : `Owner ${email} already exists; nothing changed.`);
