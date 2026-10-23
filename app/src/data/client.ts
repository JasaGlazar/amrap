import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Enums } from '../lib/database.types';
import { fromError } from '../i18n';

export type Client = SupabaseClient<Database>;

export type AppointmentStatus = Enums<'appointment_status'>;
export type TransactionType = Enums<'transaction_type'>;

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function runAction(
  action: () => PromiseLike<{ error: unknown }>,
): Promise<ActionResult> {
  try {
    const { error } = await action();
    return error ? { ok: false, message: fromError(error) } : { ok: true };
  } catch (error) {
    return { ok: false, message: fromError(error) };
  }
}
