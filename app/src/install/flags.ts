export type StorageAccess = () => Storage;

export type InstallFlag = 'dismissed' | 'installed';

const keyOf = (flag: InstallFlag) => `amrap.install.${flag}`;

export function isFlagSet(storage: StorageAccess, flag: InstallFlag): boolean {
  try {
    return storage().getItem(keyOf(flag)) === '1';
  } catch (error) {
    console.warn(`install ${flag} flag could not be read`, error);
    return false;
  }
}

export function setFlag(storage: StorageAccess, flag: InstallFlag): void {
  try {
    storage().setItem(keyOf(flag), '1');
  } catch (error) {
    console.warn(`install ${flag} flag could not be saved`, error);
  }
}
