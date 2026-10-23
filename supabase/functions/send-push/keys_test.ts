import { assertEquals, assertThrows } from '@std/assert';
import { serviceKey } from './keys.ts';

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

Deno.test('the default secret key wins when SUPABASE_SECRET_KEYS is valid', () => {
  const keys = JSON.stringify({ default: 'sb_secret_new', other: 'x' });
  assertEquals(
    serviceKey(env({ SUPABASE_SECRET_KEYS: keys, SUPABASE_SERVICE_ROLE_KEY: 'legacy' })),
    'sb_secret_new',
  );
});

Deno.test('malformed SUPABASE_SECRET_KEYS falls back to the legacy key', () => {
  assertEquals(
    serviceKey(env({ SUPABASE_SECRET_KEYS: '{not json', SUPABASE_SERVICE_ROLE_KEY: 'legacy' })),
    'legacy',
  );
});

Deno.test('SUPABASE_SECRET_KEYS without a usable default falls back to the legacy key', () => {
  for (const keys of ['{}', '{"default": ""}', '{"default": 42}', '["sb_secret"]', 'null', '"x"']) {
    assertEquals(
      serviceKey(env({ SUPABASE_SECRET_KEYS: keys, SUPABASE_SERVICE_ROLE_KEY: 'legacy' })),
      'legacy',
    );
  }
});

Deno.test('only the legacy key is enough', () => {
  assertEquals(serviceKey(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })), 'legacy');
});

Deno.test('without any usable key it fails with a descriptive error', () => {
  assertThrows(
    () => serviceKey(env({ SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: '' })),
    Error,
    'SUPABASE_SECRET_KEYS',
  );
  assertThrows(() => serviceKey(env({})), Error, 'SUPABASE_SERVICE_ROLE_KEY');
});
