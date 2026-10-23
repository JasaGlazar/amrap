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

export const supabase = createClient<Database>(url, anonKey);
