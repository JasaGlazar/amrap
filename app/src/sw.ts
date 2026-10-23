import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { parsePush } from './push/render';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
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
  const target = new URL(path, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
  event.waitUntil(openApp(url));
});

async function openApp(url: string): Promise<void> {
  const [client] = await self.clients.matchAll({ type: 'window' });
  if (client) {
    try {
      await client.focus();
      await client.navigate(url);
      return;
    } catch {
      // A client that cannot be navigated falls through to a new window.
    }
  }
  await self.clients.openWindow(url);
}
