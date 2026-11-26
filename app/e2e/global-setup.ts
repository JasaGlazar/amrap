import { env } from './env';

const NOT_RUNNING = 'Local Supabase is not running. Run "supabase start" first.';

export default async function globalSetup(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/rest/v1/`, {
      headers: { apikey: env.anonKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error(NOT_RUNNING, { cause: error });
  }
  if (response.status >= 500) {
    throw new Error(`${NOT_RUNNING} The REST endpoint answered ${response.status}.`);
  }
}
