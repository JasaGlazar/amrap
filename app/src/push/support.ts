import type { DeviceEnvironment } from '../lib/device';

export type PushSupport = 'supported' | 'needs-install' | 'unsupported' | 'no-key';

export type PushEnvironment = DeviceEnvironment & {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  vapidKey: string | undefined;
};

export function pushSupport(env: PushEnvironment): PushSupport {
  if (env.ios && !env.standalone) return 'needs-install';
  if (!env.serviceWorker || !env.pushManager || !env.notification) return 'unsupported';
  if (!env.vapidKey) return 'no-key';
  return 'supported';
}
