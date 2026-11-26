import { env } from './env';

export default async function globalSetup(): Promise<void> {
  try {
    await fetch(`${env.supabaseUrl}/rest/v1/`, {
      headers: { apikey: env.anonKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error('Local Supabase is not running. Run "supabase start" first.', {
      cause: error,
    });
  }
}
