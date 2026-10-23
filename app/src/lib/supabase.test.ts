import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('supabase client', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('fails fast when the URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key');
    await expect(import('./supabase')).rejects.toThrow(/VITE_SUPABASE_URL/);
  });

  it('fails fast when the anon key is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    await expect(import('./supabase')).rejects.toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it('creates a client when both variables are set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key');
    const { supabase } = await import('./supabase');
    expect(typeof supabase.from).toBe('function');
  });
});
