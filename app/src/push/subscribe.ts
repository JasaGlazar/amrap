import type { ActionResult, Client } from '../data/client';
import { deletePushSubscription, savePushSubscription } from '../data/push';
import { t } from '../i18n';
import type { DeviceSubscription, PushPlatform } from './browser';

export async function enablePush(
  client: Client,
  platform: PushPlatform,
  vapidKey: string,
): Promise<ActionResult<null>> {
  const permission =
    platform.permission() === 'granted' ? 'granted' : await platform.requestPermission();
  if (permission !== 'granted') return { ok: false, message: t.pushToggle.denied };

  let keys: { endpoint: string; p256dh: string; auth: string };
  try {
    const subscription = await subscribeReplacingStale(platform, base64UrlToBytes(vapidKey));
    const json = subscription.toJSON();
    keys = {
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    };
  } catch (error) {
    console.warn('push subscribe failed', error);
    return { ok: false, message: t.pushToggle.failed };
  }
  return savePushSubscription(client, keys);
}

async function subscribeReplacingStale(
  platform: PushPlatform,
  key: Uint8Array<ArrayBuffer>,
): Promise<DeviceSubscription> {
  try {
    return await platform.subscribe(key);
  } catch (error) {
    // A subscription made with a previous VAPID key blocks a new one until it is removed.
    if ((error as { name?: unknown } | null)?.name !== 'InvalidStateError') throw error;
    const stale = await platform.getSubscription();
    if (stale === null) throw error;
    await stale.unsubscribe();
    return platform.subscribe(key);
  }
}

export async function disablePush(
  client: Client,
  platform: PushPlatform,
  userId: string,
): Promise<ActionResult<null>> {
  const subscription = await platform.getSubscription();
  if (subscription === null) return { ok: true, data: null };
  const deleted = await deletePushSubscription(client, subscription.endpoint, userId);
  await subscription.unsubscribe();
  return deleted;
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
