import pg from 'pg';

export const APP_DB_ROLE = 'luna_app';

export type AppLoginResult = 'created' | 'updated' | 'same-user';

function credentials(url: string) {
  const parsed = new URL(url);
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}

export async function ensureAppLogin(adminUrl: string, appUrl: string): Promise<AppLoginResult> {
  const admin = credentials(adminUrl);
  const app = credentials(appUrl);
  if (!app.user) throw new Error('The app database URL has no user');
  if (app.user === admin.user) return 'same-user';
  if (!app.password) throw new Error(`The app database URL has no password for ${app.user}`);

  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const run = async (template: string, ...args: string[]) => {
    const params = args.map((_, i) => `$${i + 2}::text`).join(', ');
    const { rows } = await client.query<{ sql: string }>(
      `SELECT format($1::text, ${params}) AS sql`,
      [template, ...args],
    );
    await client.query(rows[0]!.sql);
  };
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ super: boolean }>(
      'SELECT rolsuper AS super FROM pg_roles WHERE rolname = $1',
      [app.user],
    );
    if (rows[0]?.super) throw new Error(`${app.user} is a superuser; the app needs its own login`);
    const result: AppLoginResult = rows.length ? 'updated' : 'created';
    if (result === 'created')
      await run('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE %I', app.user, app.password, APP_DB_ROLE);
    else {
      await run('ALTER ROLE %I WITH LOGIN PASSWORD %L', app.user, app.password);
      await run('GRANT %I TO %I', APP_DB_ROLE, app.user);
    }
    await run('GRANT CONNECT ON DATABASE %I TO %I', app.database || admin.database, app.user);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}
