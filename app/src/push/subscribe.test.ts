import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../data/client';
import { t } from '../i18n';
import { fakePlatform, keysOf, supportedEnvironment } from '../test/fakePush';
import { db, fakeSupabase, makeSession, resetFake } from '../test/fakeSupabase';
import { base64UrlToBytes, disablePush, enablePush } from './subscribe';

const client = fakeSupabase as unknown as Client;
const vapidKey = supportedEnvironment.vapidKey!;

beforeEach(() => {
  resetFake({ session: makeSession('user-a') });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('enablePush', () => {
  it('asks for permission, subscribes with the VAPID key and saves the keys', async () => {
    const { platform } = fakePlatform({ newEndpoint: 'https://push.test/a' });
    expect(await enablePush(client, platform, vapidKey)).toEqual({ ok: true, data: null });
    expect(platform.requestPermission).toHaveBeenCalledOnce();
    expect(platform.subscribe).toHaveBeenCalledWith(base64UrlToBytes(vapidKey));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('save_push_subscription', {
      p_endpoint: 'https://push.test/a',
      p_p256dh: keysOf('https://push.test/a').p256dh,
      p_auth: keysOf('https://push.test/a').auth,
    });
    expect(db.tables.push_subscriptions.map((row) => row.user_id)).toEqual(['user-a']);
  });

  it('does not ask again when permission is already granted', async () => {
    const { platform } = fakePlatform({ permission: 'granted' });
    await enablePush(client, platform, vapidKey);
    expect(platform.requestPermission).not.toHaveBeenCalled();
  });

  it('stops when the user refuses permission', async () => {
    const { platform } = fakePlatform({ answer: 'denied' });
    expect(await enablePush(client, platform, vapidKey)).toEqual({
      ok: false,
      message: t.pushToggle.denied,
    });
    expect(platform.subscribe).not.toHaveBeenCalled();
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('replaces a subscription made with an older VAPID key and retries once', async () => {
    const keyChanged = Object.assign(new Error('different applicationServerKey'), {
      name: 'InvalidStateError',
    });
    const { platform, unsubscribe } = fakePlatform({
      permission: 'granted',
      subscribedEndpoint: 'https://push.test/old-key',
      newEndpoint: 'https://push.test/new-key',
      subscribeFailures: [keyChanged],
    });
    expect(await enablePush(client, platform, vapidKey)).toEqual({ ok: true, data: null });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(platform.subscribe).toHaveBeenCalledTimes(2);
    expect(db.tables.push_subscriptions.map((row) => row.endpoint)).toEqual([
      'https://push.test/new-key',
    ]);
  });

  it('reports a failed browser subscription without retrying', async () => {
    const { platform } = fakePlatform({ subscribeError: new Error('push service down') });
    expect(await enablePush(client, platform, vapidKey)).toEqual({
      ok: false,
      message: t.pushToggle.failed,
    });
    expect(platform.subscribe).toHaveBeenCalledOnce();
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('shows the server error when saving fails', async () => {
    const { platform } = fakePlatform({});
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_FORBIDDEN: x' },
    });
    expect(await enablePush(client, platform, vapidKey)).toEqual({
      ok: false,
      message: t.errors.AMRAP_FORBIDDEN,
    });
  });
});

describe('disablePush', () => {
  it('deletes this device row and unsubscribes the browser', async () => {
    const endpoint = 'https://push.test/a';
    db.tables.push_subscriptions.push(
      { id: 'p1', user_id: 'user-a', endpoint, ...keysOf(endpoint) },
      { id: 'p2', user_id: 'user-a', endpoint: 'https://push.test/other', ...keysOf('x') },
    );
    const { platform, unsubscribe } = fakePlatform({
      permission: 'granted',
      subscribedEndpoint: endpoint,
    });
    expect(await disablePush(client, platform)).toEqual({ ok: true, data: null });
    expect(db.tables.push_subscriptions.map((row) => row.endpoint)).toEqual([
      'https://push.test/other',
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does nothing without a browser subscription', async () => {
    const { platform } = fakePlatform({});
    expect(await disablePush(client, platform)).toEqual({ ok: true, data: null });
    expect(fakeSupabase.from).not.toHaveBeenCalled();
  });
});

describe('base64UrlToBytes', () => {
  it('decodes an unpadded base64url VAPID key to its 65 bytes', () => {
    const bytes = base64UrlToBytes(vapidKey);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
