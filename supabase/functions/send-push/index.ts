// @ts-types="npm:@types/web-push@3.6.4"
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { handle } from './handler.ts';
import type { BuiltPush, ClaimedRow } from './types.ts';

const vapid = {
  subject: Deno.env.get('VAPID_SUBJECT') ?? '',
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
};

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function serviceKey(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    const key = (JSON.parse(secretKeys) as Record<string, string>).default;
    if (key) return key;
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

async function claim(ids: string[]): Promise<ClaimedRow[]> {
  const { data, error } = await supabase.rpc('claim_notifications', { p_ids: ids });
  if (error) throw error;
  return (data ?? []) as ClaimedRow[];
}

async function removeSubscriptions(endpoints: string[]): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().in('endpoint', endpoints);
  if (error) throw error;
}

// web-push builds the encrypted request; fetch sends it, so no Node https in the runtime.
async function send(row: ClaimedRow, push: BuiltPush): Promise<void> {
  const details = webpush.generateRequestDetails(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    push.payload,
    { TTL: push.ttl, urgency: push.urgency, topic: push.topic, vapidDetails: vapid },
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(details.headers)) {
    if (name.toLowerCase() !== 'content-length') headers.set(name, String(value));
  }
  const response = await fetch(details.endpoint, {
    method: details.method,
    headers,
    body: details.body ? new Uint8Array(details.body) : null,
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw Object.assign(new Error(`push service responded ${response.status}`), {
      statusCode: response.status,
    });
  }
}

Deno.serve((req) =>
  handle(req, {
    pushSecret: Deno.env.get('PUSH_SECRET'),
    vapidConfigured: Boolean(vapid.subject && vapid.publicKey && vapid.privateKey),
    claim,
    send,
    removeSubscriptions,
    now: () => new Date(),
  })
);
