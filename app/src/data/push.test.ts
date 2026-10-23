import { beforeEach, describe, expect, it } from 'vitest';
import { db, fakeSupabase, makeSession, resetFake } from '../test/fakeSupabase';
import type { Client } from './client';
import { deletePushSubscription, hasPushSubscription } from './push';

const client = fakeSupabase as unknown as Client;
const endpoint = 'https://push.test/shared-device';

beforeEach(() => {
  resetFake({ session: makeSession('user-trainer') });
  db.tables.push_subscriptions.push({
    id: 'p1',
    user_id: 'user-ana',
    endpoint,
    p256dh: 'k',
    auth: 'a',
  });
});

describe('push subscription rows', () => {
  it('does not count another user row with the same endpoint as this user subscription', async () => {
    expect(await hasPushSubscription(client, endpoint, 'user-trainer')).toBe(false);
    expect(await hasPushSubscription(client, endpoint, 'user-ana')).toBe(true);
  });

  it('never deletes another user row', async () => {
    expect(await deletePushSubscription(client, endpoint, 'user-trainer')).toEqual({
      ok: true,
      data: null,
    });
    expect(db.tables.push_subscriptions).toHaveLength(1);
    await deletePushSubscription(client, endpoint, 'user-ana');
    expect(db.tables.push_subscriptions).toEqual([]);
  });
});
