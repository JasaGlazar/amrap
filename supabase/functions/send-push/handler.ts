import { buildPush } from './payload.ts';
import type { BuiltPush, ClaimedRow } from './types.ts';

export interface Deps {
  pushSecret: string | undefined;
  vapidConfigured: boolean;
  claim(ids: string[]): Promise<ClaimedRow[]>;
  send(row: ClaimedRow, push: BuiltPush): Promise<void>;
  removeSubscriptions(endpoints: string[]): Promise<void>;
  now(): Date;
}

export interface Summary {
  claimed: number;
  sent: number;
  failed: number;
  removed: number;
}

const GONE = new Set([404, 410]);

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!deps.pushSecret) {
    console.error('send-push: PUSH_SECRET is not set');
    return json({ error: 'not configured' }, 503);
  }
  if (!sameSecret(req.headers.get('x-amrap-push-secret') ?? '', deps.pushSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!deps.vapidConfigured) {
    console.error('send-push: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT is not set');
    return json({ error: 'not configured' }, 503);
  }

  const ids = await readIds(req);
  if (!ids) return json({ error: 'body must be {"ids": [uuid, ...]}' }, 400);
  if (ids.length === 0) return json(summary(0, 0, 0, 0));

  let rows: ClaimedRow[];
  try {
    rows = await deps.claim(ids);
  } catch (error) {
    console.error('send-push: claim_notifications failed', error);
    return json({ error: 'claim failed' }, 500);
  }

  const unsafe = rows.filter((row) => !row.endpoint.startsWith('https://'));
  for (const row of unsafe) {
    console.error('send-push: skipped a non-https endpoint', row.notification_id, row.endpoint);
  }
  rows = rows.filter((row) => row.endpoint.startsWith('https://'));

  const now = deps.now();
  const results = await Promise.allSettled(rows.map((row) => deps.send(row, buildPush(row, now))));
  const gone: string[] = [];
  let sent = 0;
  let failed = unsafe.length;
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      sent += 1;
    } else if (GONE.has(statusOf(result.reason))) {
      gone.push(rows[i].endpoint);
    } else {
      failed += 1;
      console.error('send-push: push failed', rows[i].notification_id, result.reason);
    }
  });

  let removed = 0;
  if (gone.length > 0) {
    try {
      await deps.removeSubscriptions(gone);
      removed = gone.length;
    } catch (error) {
      console.error('send-push: deleting expired subscriptions failed', error);
    }
  }

  const claimed = new Set([...rows, ...unsafe].map((row) => row.notification_id)).size;
  return json(summary(claimed, sent, failed + gone.length - removed, removed));
}

async function readIds(req: Request): Promise<string[] | null> {
  try {
    const body = await req.json();
    const ids = body?.ids;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
    return ids;
  } catch {
    return null;
  }
}

function statusOf(reason: unknown): number {
  const status = (reason as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : 0;
}

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function summary(claimed: number, sent: number, failed: number, removed: number): Summary {
  return { claimed, sent, failed, removed };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
