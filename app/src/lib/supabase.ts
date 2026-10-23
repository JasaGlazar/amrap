import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy app/.env.example to app/.env.local for local development, ' +
      'or set both variables in the Cloudflare Pages dashboard.',
  );
}

const RETRY_DELAY_MS = 1000;

async function isIssuedAtFuture(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body: unknown = await response.clone().json();
    return (body as { code?: unknown } | null)?.code === 'PGRST303';
  } catch {
    return false;
  }
}

// PostgREST sometimes refuses a fresh token as issued in the future (PGRST303); a retry passes.
export function retryIssuedAtFuture(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const retryInput = input instanceof Request ? input.clone() : input;
    const response = await fetchImpl(input, init);
    if (!(await isIssuedAtFuture(response))) return response;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fetchImpl(retryInput, init);
  };
}

export const supabase = createClient<Database>(url, anonKey, {
  global: { fetch: retryIssuedAtFuture((input, init) => fetch(input, init)) },
});
