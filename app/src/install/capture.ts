import { dismissInstall, isInstallDismissed, type StorageAccess } from './dismissed';

// Chromium only; not in lib.dom.
export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type InstallState = {
  prompt: InstallPromptEvent | null;
  installed: boolean;
  dismissed: boolean;
};

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable';

export type InstallStore = {
  getState(): InstallState;
  subscribe(listener: () => void): () => void;
  capture(event: InstallPromptEvent): void;
  markInstalled(): void;
  dismiss(): void;
  install(): Promise<InstallResult>;
};

export function createInstallStore(storage: StorageAccess): InstallStore {
  let state: InstallState = {
    prompt: null,
    installed: false,
    dismissed: isInstallDismissed(storage),
  };
  const listeners = new Set<() => void>();

  function update(change: Partial<InstallState>) {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    capture: (event) => update({ prompt: event }),
    markInstalled: () => update({ prompt: null, installed: true }),
    dismiss() {
      dismissInstall(storage);
      update({ dismissed: true });
    },
    async install() {
      const event = state.prompt;
      if (event === null) return 'unavailable';
      update({ prompt: null });
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === 'accepted') update({ installed: true });
        return outcome;
      } catch (error) {
        console.warn('install prompt failed', error);
        return 'unavailable';
      }
    },
  };
}

export function listenForInstallPrompt(target: EventTarget, store: InstallStore): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    store.capture(event as InstallPromptEvent);
  });
  target.addEventListener('appinstalled', () => store.markInstalled());
}
