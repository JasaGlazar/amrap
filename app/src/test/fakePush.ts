import { vi } from 'vitest';
import type { DeviceSubscription, PushPlatform } from '../push/browser';
import type { PushEnvironment } from '../push/support';

export const supportedEnvironment: PushEnvironment = {
  serviceWorker: true,
  pushManager: true,
  notification: true,
  ios: false,
  standalone: false,
  vapidKey:
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
};

export function keysOf(endpoint: string) {
  return { p256dh: `p256dh-of-${endpoint}`, auth: `auth-of-${endpoint}` };
}

export function fakePlatform(options: {
  environment?: Partial<PushEnvironment>;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  subscribedEndpoint?: string;
  newEndpoint?: string;
  subscribeError?: Error;
}) {
  const state: { permission: NotificationPermission; subscription: DeviceSubscription | null } = {
    permission: options.permission ?? 'default',
    subscription: null,
  };
  const unsubscribe = vi.fn(async () => {
    state.subscription = null;
    return true;
  });
  const device = (endpoint: string): DeviceSubscription => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: keysOf(endpoint) }),
    unsubscribe,
  });
  if (options.subscribedEndpoint) state.subscription = device(options.subscribedEndpoint);

  const platform = {
    environment: () => ({ ...supportedEnvironment, ...options.environment }),
    permission: () => state.permission,
    requestPermission: vi.fn(async () => {
      state.permission = options.answer ?? 'granted';
      return state.permission;
    }),
    getSubscription: vi.fn(async () => state.subscription),
    subscribe: vi.fn<PushPlatform['subscribe']>(async () => {
      if (options.subscribeError) throw options.subscribeError;
      state.subscription ??= device(options.newEndpoint ?? 'https://push.test/device');
      return state.subscription;
    }),
  } satisfies PushPlatform;
  return { platform, state, unsubscribe };
}
