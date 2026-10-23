import type { PushEnvironment } from './support';

export type DeviceSubscription = {
  endpoint: string;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
};

export type PushPlatform = {
  environment(): PushEnvironment;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  getSubscription(): Promise<DeviceSubscription | null>;
  subscribe(applicationServerKey: Uint8Array<ArrayBuffer>): Promise<DeviceSubscription>;
};

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  return navigator.serviceWorker.getRegistration();
}

export const browserPlatform: PushPlatform = {
  environment() {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return {
      serviceWorker: 'serviceWorker' in navigator,
      pushManager: 'PushManager' in window,
      notification: 'Notification' in window,
      ios,
      standalone,
      vapidKey: import.meta.env.VITE_VAPID_PUBLIC_KEY || undefined,
    };
  },
  permission() {
    return 'Notification' in window ? Notification.permission : 'denied';
  },
  requestPermission() {
    return Notification.requestPermission();
  },
  async getSubscription() {
    const current = await registration();
    return current ? current.pushManager.getSubscription() : null;
  },
  async subscribe(applicationServerKey) {
    if (!(await registration())) throw new Error('no service worker registration');
    const active = await navigator.serviceWorker.ready;
    return active.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  },
};
