const DISMISSED_KEY = 'amrap.install.dismissed';

export type StorageAccess = () => Storage;

export function isInstallDismissed(storage: StorageAccess): boolean {
  try {
    return storage().getItem(DISMISSED_KEY) === '1';
  } catch (error) {
    console.warn('install dismissal could not be read', error);
    return false;
  }
}

export function dismissInstall(storage: StorageAccess): void {
  try {
    storage().setItem(DISMISSED_KEY, '1');
  } catch (error) {
    console.warn('install dismissal could not be saved', error);
  }
}
