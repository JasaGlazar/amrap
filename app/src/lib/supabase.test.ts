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

describe('retrying a fresh token refused as issued in the future', () => {
  const issuedAtFuture = () =>
    new Response(
      JSON.stringify({
        code: 'PGRST303',
        details: null,
        hint: null,
        message: 'JWT issued at future',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  const ok = () => new Response('[{"id":"c1"}]', { status: 200 });

  async function loadWrapper() {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key');
    return (await import('./supabase')).retryIssuedAtFuture;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('retries once, a second later, with the same request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(issuedAtFuture()).mockResolvedValueOnce(ok());
    const wrapped = (await loadWrapper())(fetchMock);
    const init = {
      method: 'POST',
      body: '{"p_token":"t"}',
      headers: { Authorization: 'Bearer x' },
    };

    const pending = wrapped('http://api/rest/v1/rpc/accept_invite', init);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(['http://api/rest/v1/rpc/accept_invite', init]);
    expect(response.status).toBe(200);
  });

  it('retries only once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(issuedAtFuture())
      .mockResolvedValueOnce(issuedAtFuture());
    const wrapped = (await loadWrapper())(fetchMock);

    const pending = wrapped('http://api/rest/v1/customers');
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('PGRST303');
  });

  it.each([
    [
      'another 401',
      () => new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401 }),
    ],
    ['a 401 that is not JSON', () => new Response('Unauthorized', { status: 401 })],
    ['PGRST303 with another status', () => new Response('{"code":"PGRST303"}', { status: 400 })],
    ['a success', ok],
  ])('does not retry %s and leaves its body readable', async (_name, make) => {
    const expected = await make().text();
    const fetchMock = vi.fn().mockResolvedValueOnce(make());
    const wrapped = (await loadWrapper())(fetchMock);

    const response = await wrapped('http://api/rest/v1/customers');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe(expected);
  });

  it('is what the client fetches through', async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(issuedAtFuture()).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'key');
    const { supabase } = await import('./supabase');

    const { data, error } = await supabase.from('customers').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'c1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
