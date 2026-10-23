import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// ADR 0005: the Supabase Free Plan pauses an idle project, so every signed-in load does one
// cheap authenticated read. A failure is only logged; it must never block the app.
export async function keepAlive(client: SupabaseClient<Database>): Promise<void> {
  try {
    const { error } = await client.from('settings').select('id').limit(1);
    if (error) console.warn('keep-alive read failed', error.message);
  } catch (error) {
    console.warn('keep-alive read failed', error);
  }
}
