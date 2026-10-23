import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { fakePlatform, keysOf } from '../../test/fakePush';
import { db, makeSession, resetFake } from '../../test/fakeSupabase';
import { PushToggle } from './PushToggle';

vi.mock('../../lib/supabase', async () => ({
  supabase: (await import('../../test/fakeSupabase')).fakeSupabase,
}));

const endpoint = 'https://push.test/this-device';

beforeEach(() => resetFake({ session: makeSession('user-a') }));

describe('PushToggle', () => {
  it.each([
    ['an unsupported browser', { environment: { serviceWorker: false } }, t.pushToggle.unsupported],
    [
      'iOS Safari in a tab',
      { environment: { ios: true, standalone: false } },
      t.pushToggle.needsInstall,
    ],
    ['a build without the VAPID key', { environment: { vapidKey: undefined } }, t.pushToggle.noKey],
    [
      'notifications blocked in the browser',
      { permission: 'denied' as const },
      t.pushToggle.blocked,
    ],
  ])('explains %s and offers no button', async (_name, options, text) => {
    const { platform } = fakePlatform(options);
    render(<PushToggle audience="customer" platform={platform} />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('turns notifications on for this device', async () => {
    const { platform } = fakePlatform({ newEndpoint: endpoint });
    render(<PushToggle audience="customer" platform={platform} />);
    expect(await screen.findByText(t.pushToggle.off)).toBeInTheDocument();
    expect(screen.getByText(t.pushToggle.customerHint)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: t.pushToggle.enable }));

    expect(await screen.findByText(t.pushToggle.on)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(t.pushToggle.enabled);
    expect(db.tables.push_subscriptions).toMatchObject([
      { endpoint, user_id: 'user-a', ...keysOf(endpoint) },
    ]);
    expect(screen.getByRole('button', { name: t.pushToggle.disable })).toBeInTheDocument();
  });

  it('turns notifications off for this device', async () => {
    db.tables.push_subscriptions.push({
      id: 'p1',
      user_id: 'user-a',
      endpoint,
      ...keysOf(endpoint),
    });
    const { platform, unsubscribe } = fakePlatform({
      permission: 'granted',
      subscribedEndpoint: endpoint,
    });
    render(<PushToggle audience="trainer" platform={platform} />);
    expect(await screen.findByText(t.pushToggle.on)).toBeInTheDocument();
    expect(screen.getByText(t.pushToggle.trainerHint)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: t.pushToggle.disable }));

    expect(await screen.findByText(t.pushToggle.off)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(t.pushToggle.disabled);
    expect(db.tables.push_subscriptions).toEqual([]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('shows off when the browser is subscribed but the server no longer has the device', async () => {
    const { platform } = fakePlatform({ permission: 'granted', subscribedEndpoint: endpoint });
    render(<PushToggle audience="customer" platform={platform} />);
    expect(await screen.findByText(t.pushToggle.off)).toBeInTheDocument();
  });

  it('shows why turning on failed', async () => {
    const { platform } = fakePlatform({ answer: 'denied' });
    render(<PushToggle audience="customer" platform={platform} />);
    await userEvent.click(await screen.findByRole('button', { name: t.pushToggle.enable }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.pushToggle.denied);
    expect(await screen.findByText(t.pushToggle.blocked)).toBeInTheDocument();
    expect(db.tables.push_subscriptions).toEqual([]);
  });
});
