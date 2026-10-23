import { isFlagSet, setFlag, type StorageAccess } from './flags';

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
    installed: isFlagSet(storage, 'installed'),
    dismissed: isFlagSet(storage, 'dismissed'),
  };
  const listeners = new Set<() => void>();
  let prompting = false;

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
    markInstalled() {
      setFlag(storage, 'installed');
      update({ prompt: null, installed: true });
    },
    dismiss() {
      setFlag(storage, 'dismissed');
      update({ dismissed: true });
    },
    async install() {
      const event = state.prompt;
      if (event === null || prompting) return 'unavailable';
      prompting = true;
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === 'accepted') setFlag(storage, 'installed');
        update(outcome === 'accepted' ? { prompt: null, installed: true } : { prompt: null });
        return outcome;
      } catch (error) {
        console.warn('install prompt failed', error);
        update({ prompt: null });
        return 'unavailable';
      } finally {
        prompting = false;
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
