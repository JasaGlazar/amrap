import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test/fakeInstall';
import { isFlagSet, setFlag, type InstallFlag } from './flags';

function throwingStorage(): Storage {
  throw new DOMException('storage is disabled', 'SecurityError');
}

afterEach(() => vi.restoreAllMocks());

describe.each<InstallFlag>(['dismissed', 'installed'])('the %s flag', (flag) => {
  it('is not set on a fresh device', () => {
    const storage = memoryStorage();
    expect(isFlagSet(() => storage, flag)).toBe(false);
  });

  it('is remembered once set, under its own key', () => {
    const storage = memoryStorage();
    setFlag(() => storage, flag);
    expect(isFlagSet(() => storage, flag)).toBe(true);
    expect(storage.getItem(`amrap.install.${flag}`)).toBe('1');
  });

  it('counts as not set when storage cannot be read', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isFlagSet(throwingStorage, flag)).toBe(false);
  });

  it('does not throw when storage cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => setFlag(throwingStorage, flag)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});

it('keeps the two flags apart', () => {
  const storage = memoryStorage();
  setFlag(() => storage, 'dismissed');
  expect(isFlagSet(() => storage, 'installed')).toBe(false);
});
