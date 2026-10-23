import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { parsePush } from './push/render';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

precacheAndRoute(self.__WB_MANIFEST);
void self.skipWaiting();
clientsClaim();

self.addEventListener('push', (event) => {
  const notification = parsePush(event.data?.text());
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      icon: '/icon-192.png',
      data: { url: notification.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data as { url?: string } | null)?.url ?? '/';
  event.waitUntil(openApp(new URL(path, self.location.origin).href));
});

async function openApp(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    try {
      const focused = await client.focus();
      await focused.navigate(url);
      return;
    } catch {
      continue;
    }
  }
  await self.clients.openWindow(url);
}
