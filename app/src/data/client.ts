import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Enums } from '../lib/database.types';
import { fromError } from '../i18n';

export type Client = SupabaseClient<Database>;

export type AppointmentStatus = Enums<'appointment_status'>;
export type TransactionType = Enums<'transaction_type'>;

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export async function runAction<T>(
  action: () => PromiseLike<{ data: T; error: unknown }>,
): Promise<ActionResult<T>> {
  try {
    const { data, error } = await action();
    return error ? { ok: false, message: fromError(error) } : { ok: true, data };
  } catch (error) {
    return { ok: false, message: fromError(error) };
  }
}
