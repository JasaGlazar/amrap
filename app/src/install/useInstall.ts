import { useContext, useSyncExternalStore } from 'react';
import { installMode, type InstallMode } from './mode';
import { InstallContext } from './platform';

export function useInstall() {
  const { device, store } = useContext(InstallContext);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const mode: InstallMode = installMode({
    ...device(),
    installed: state.installed,
    hasPrompt: state.prompt !== null,
  });
  const cardShown = mode !== 'hidden' && mode !== 'none' && !state.dismissed;
  return { mode, cardShown, install: store.install, dismiss: store.dismiss };
}
