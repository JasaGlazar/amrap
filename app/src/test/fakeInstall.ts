import { vi, type Mock } from 'vitest';
import { createInstallStore, type InstallPromptEvent } from '../install/capture';
import type { InstallPlatform } from '../install/platform';
import type { DeviceEnvironment } from '../lib/device';

export function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

export type FakePromptEvent = InstallPromptEvent & { prompt: Mock<() => Promise<void>> };

export function fakePromptEvent(outcome: 'accepted' | 'dismissed'): FakePromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  return Object.assign(event, {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
}

export const desktopTab: DeviceEnvironment = { ios: false, android: false, standalone: false };

export function fakeInstallPlatform(
  options: { device?: Partial<DeviceEnvironment>; dismissed?: boolean } = {},
) {
  const storage = memoryStorage();
  const store = createInstallStore(() => storage);
  if (options.dismissed) store.dismiss();
  const platform: InstallPlatform = {
    device: () => ({ ...desktopTab, ...options.device }),
    store,
  };
  function firePrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
    const event = fakePromptEvent(outcome);
    store.capture(event);
    return event;
  }
  return { platform, store, storage, firePrompt };
}
