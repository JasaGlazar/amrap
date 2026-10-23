import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { routes } from '../routes';
import { fakePlatform, keysOf } from '../test/fakePush';
import { db, fakeSupabase, makeCustomer, makeSession, resetFake } from '../test/fakeSupabase';

const endpoint = 'https://push.test/this-device';
const device = vi.hoisted(() => ({ current: null as ReturnType<typeof fakePlatform> | null }));

vi.mock('../lib/supabase', async () => ({
  supabase: (await import('../test/fakeSupabase')).fakeSupabase,
}));
vi.mock('./browser', () => ({
  get browserPlatform() {
    return device.current!.platform;
  },
}));

const customer = makeCustomer({ id: 'customer-1', auth_user_id: 'user-c' });

beforeEach(() => {
  resetFake({ session: makeSession('user-c'), customer });
  db.tables.push_subscriptions.push({ id: 'p1', user_id: 'user-c', endpoint, ...keysOf(endpoint) });
});

describe('signing out', () => {
  it('removes this device subscription before signing out', async () => {
    device.current = fakePlatform({ permission: 'granted', subscribedEndpoint: endpoint });
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/logout'] })} />);
    expect(await screen.findByRole('heading', { name: t.login.title })).toBeInTheDocument();
    expect(db.tables.push_subscriptions).toEqual([]);
    expect(device.current.unsubscribe).toHaveBeenCalledOnce();
    expect(fakeSupabase.auth.signOut).toHaveBeenCalledOnce();
  });

  it('still signs out when removing the subscription fails', async () => {
    device.current = fakePlatform({ permission: 'granted', subscribedEndpoint: endpoint });
    device.current.platform.getSubscription.mockRejectedValueOnce(new Error('sw gone'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/logout'] })} />);
    expect(await screen.findByRole('heading', { name: t.login.title })).toBeInTheDocument();
    expect(fakeSupabase.auth.signOut).toHaveBeenCalledOnce();
  });
});
