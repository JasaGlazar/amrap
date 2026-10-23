import { assertEquals } from '@std/assert';
import { type Deps, handle } from './handler.ts';
import type { BuiltPush, ClaimedRow } from './types.ts';

const SECRET = 'test-secret';

const logged: unknown[][] = [];
console.error = (...args: unknown[]) => logged.push(args);

function claimed(id: string, endpoint: string): ClaimedRow {
  return {
    notification_id: id,
    kind: 'credit_topup',
    data: { amount: 5 },
    endpoint,
    p256dh: 'k',
    auth: 'a',
  };
}

function fakeDeps(rows: ClaimedRow[], failures: Record<string, unknown> = {}) {
  const calls = { claimed: [] as string[][], sent: [] as string[], removed: [] as string[][] };
  const deps: Deps = {
    pushSecret: SECRET,
    vapidConfigured: true,
    claim: (ids) => {
      calls.claimed.push(ids);
      return Promise.resolve(rows.filter((r) => ids.includes(r.notification_id)));
    },
    send: (row: ClaimedRow, _push: BuiltPush) => {
      calls.sent.push(row.endpoint);
      const failure = failures[row.endpoint];
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    },
    removeSubscriptions: (endpoints) => {
      calls.removed.push(endpoints);
      return Promise.resolve();
    },
    now: () => new Date('2026-10-24T10:00:00Z'),
  };
  return { deps, calls };
}

function post(body: unknown, secret: string | null = SECRET, method = 'POST'): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (secret !== null) headers.set('x-amrap-push-secret', secret);
  return new Request('http://localhost/send-push', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

Deno.test('only POST is accepted', async () => {
  const { deps, calls } = fakeDeps([]);
  assertEquals((await handle(post(null, SECRET, 'GET'), deps)).status, 405);
  assertEquals(calls.claimed.length, 0);
});

Deno.test('a missing or wrong secret is rejected before anything is claimed', async () => {
  const { deps, calls } = fakeDeps([claimed('n1', 'https://push.test/1')]);
  assertEquals((await handle(post({ ids: ['n1'] }, null), deps)).status, 401);
  assertEquals((await handle(post({ ids: ['n1'] }, 'wrong'), deps)).status, 401);
  assertEquals((await handle(post({ ids: ['n1'] }, `${SECRET}x`), deps)).status, 401);
  assertEquals(calls.claimed.length, 0);
});

Deno.test('without PUSH_SECRET or VAPID secrets nothing is claimed', async () => {
  const noSecret = fakeDeps([claimed('n1', 'https://push.test/1')]);
  noSecret.deps.pushSecret = undefined;
  assertEquals((await handle(post({ ids: ['n1'] }), noSecret.deps)).status, 503);
  assertEquals(noSecret.calls.claimed.length, 0);

  const noVapid = fakeDeps([claimed('n1', 'https://push.test/1')]);
  noVapid.deps.vapidConfigured = false;
  assertEquals((await handle(post({ ids: ['n1'] }), noVapid.deps)).status, 503);
  assertEquals(noVapid.calls.claimed.length, 0);
});

Deno.test('a body without an ids array of strings is rejected', async () => {
  const { deps, calls } = fakeDeps([]);
  for (const body of [{}, { ids: 'n1' }, { ids: [1] }, null]) {
    assertEquals((await handle(post(body), deps)).status, 400);
  }
  const broken = new Request('http://localhost/send-push', {
    method: 'POST',
    headers: { 'x-amrap-push-secret': SECRET },
    body: '{not json',
  });
  assertEquals((await handle(broken, deps)).status, 400);
  assertEquals(calls.claimed.length, 0);
});

Deno.test('every claimed subscription gets its push', async () => {
  const rows = [
    claimed('n1', 'https://push.test/1'),
    claimed('n1', 'https://push.test/2'),
    claimed('n2', 'https://push.test/3'),
  ];
  const { deps, calls } = fakeDeps(rows);
  const response = await handle(post({ ids: ['n1', 'n2'] }), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { claimed: 2, sent: rows.length, failed: 0, removed: 0 });
  assertEquals(calls.sent.sort(), rows.map((r) => r.endpoint).sort());
  assertEquals(calls.removed, []);
});

Deno.test('subscriptions the push service reports gone (404, 410) are deleted, others kept', async () => {
  const rows = [
    claimed('n1', 'https://push.test/gone-404'),
    claimed('n1', 'https://push.test/gone-410'),
    claimed('n1', 'https://push.test/error-500'),
    claimed('n1', 'https://push.test/network'),
    claimed('n1', 'https://push.test/ok'),
  ];
  const { deps, calls } = fakeDeps(rows, {
    'https://push.test/gone-404': { statusCode: 404 },
    'https://push.test/gone-410': { statusCode: 410 },
    'https://push.test/error-500': { statusCode: 500 },
    'https://push.test/network': new TypeError('connection refused'),
  });
  const response = await handle(post({ ids: ['n1'] }), deps);
  assertEquals(await response.json(), { claimed: 1, sent: 1, failed: 2, removed: 2 });
  assertEquals(calls.sent.length, rows.length);
  assertEquals(calls.removed, [['https://push.test/gone-404', 'https://push.test/gone-410']]);
  assertEquals(logged.filter(([message]) => message === 'send-push: push failed').length, 2);
});

Deno.test('a non-https endpoint is never called and counts as failed', async () => {
  const rows = [
    claimed('n1', 'http://push.test/plain'),
    claimed('n1', 'ftp://push.test/odd'),
    claimed('n1', 'https://push.test/ok'),
  ];
  const { deps, calls } = fakeDeps(rows);
  const response = await handle(post({ ids: ['n1'] }), deps);
  assertEquals(await response.json(), { claimed: 1, sent: 1, failed: 2, removed: 0 });
  assertEquals(calls.sent, ['https://push.test/ok']);
  assertEquals(calls.removed, []);
});

Deno.test('ids that are already claimed send nothing', async () => {
  const { deps, calls } = fakeDeps([]);
  const response = await handle(post({ ids: ['n1'] }), deps);
  assertEquals(await response.json(), { claimed: 0, sent: 0, failed: 0, removed: 0 });
  assertEquals(calls.sent, []);
});

Deno.test('an empty id list claims nothing', async () => {
  const { deps, calls } = fakeDeps([]);
  assertEquals((await handle(post({ ids: [] }), deps)).status, 200);
  assertEquals(calls.claimed, []);
});

Deno.test('a failing claim answers 500 and sends nothing', async () => {
  const { deps, calls } = fakeDeps([]);
  deps.claim = () => Promise.reject(new Error('db down'));
  assertEquals((await handle(post({ ids: ['n1'] }), deps)).status, 500);
  assertEquals(calls.sent, []);
});
