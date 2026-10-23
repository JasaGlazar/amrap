import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform } from './browser';

const key = new Uint8Array(new ArrayBuffer(65));

function registration(subscribe: () => Promise<unknown>) {
  return { pushManager: { subscribe: vi.fn(subscribe), getSubscription: vi.fn(async () => null) } };
}

function stubServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
}

afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe('browserPlatform.subscribe', () => {
  it('waits for the active worker instead of subscribing on a still-installing registration', async () => {
    const installing = registration(() => Promise.reject(new Error('no active worker')));
    const active = registration(async () => ({ endpoint: 'https://push.test/active' }));
    stubServiceWorker({
      getRegistration: vi.fn(async () => installing),
      ready: Promise.resolve(active),
    });
    await expect(browserPlatform.subscribe(key)).resolves.toEqual({
      endpoint: 'https://push.test/active',
    });
    expect(active.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    expect(installing.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('gives up when no worker becomes active within a few seconds', async () => {
    vi.useFakeTimers();
    try {
      const installing = registration(() => Promise.reject(new Error('no active worker')));
      stubServiceWorker({
        getRegistration: vi.fn(async () => installing),
        ready: new Promise(() => {}),
      });
      const subscribing = browserPlatform.subscribe(key);
      const settled = expect(subscribing).rejects.toThrow('service worker did not become active');
      await vi.advanceTimersByTimeAsync(5000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails without a registration rather than waiting forever', async () => {
    stubServiceWorker({
      getRegistration: vi.fn(async () => undefined),
      ready: new Promise(() => {}),
    });
    await expect(browserPlatform.subscribe(key)).rejects.toThrow('no service worker registration');
  });
});
