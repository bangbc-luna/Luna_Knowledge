import { APP_DB_ROLE, ensureAppLogin } from '@luna/db';
import { databaseEnvSchema, loadEnv } from '@luna/shared';
import { z } from 'zod';

const env = loadEnv(databaseEnvSchema.extend({ APP_DATABASE_URL: z.url().optional() }));
if (!env.APP_DATABASE_URL) {
  console.log('APP_DATABASE_URL is not set; the app keeps using DATABASE_URL as is.');
  process.exit(0);
}

const user = decodeURIComponent(new URL(env.APP_DATABASE_URL).username);
const result = await ensureAppLogin(env.DATABASE_URL, env.APP_DATABASE_URL);
console.log(
  result === 'same-user'
    ? `App and migrations share the login ${user}; no separate app login to manage.`
    : `App login ${user} ${result} as a member of ${APP_DB_ROLE}.`,
);
