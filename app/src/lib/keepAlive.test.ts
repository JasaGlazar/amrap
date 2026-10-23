import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from './database.types';
import { keepAlive } from './keepAlive';

function clientReturning(result: Promise<{ error: { message: string } | null }>) {
  const limit = vi.fn(() => result);
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, select, limit };
}

describe('keepAlive', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads one id from settings', async () => {
    const { client, from, select, limit } = clientReturning(Promise.resolve({ error: null }));
    await keepAlive(client);
    expect([from.mock.calls, select.mock.calls, limit.mock.calls]).toEqual([
      [['settings']],
      [['id']],
      [[1]],
    ]);
  });

  it('logs a failed read instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = clientReturning(Promise.resolve({ error: { message: 'paused' } }));
    await expect(keepAlive(client)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('logs a rejected request instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = clientReturning(Promise.reject(new Error('offline')));
    await expect(keepAlive(client)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
