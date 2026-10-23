import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test/fakeInstall';
import { dismissInstall, isInstallDismissed } from './dismissed';

function throwingStorage(): Storage {
  throw new DOMException('storage is disabled', 'SecurityError');
}

afterEach(() => vi.restoreAllMocks());

describe('install dismissal', () => {
  it('is not dismissed on a fresh device', () => {
    const storage = memoryStorage();
    expect(isInstallDismissed(() => storage)).toBe(false);
  });

  it('is remembered once dismissed', () => {
    const storage = memoryStorage();
    dismissInstall(() => storage);
    expect(isInstallDismissed(() => storage)).toBe(true);
  });

  it('counts as not dismissed when storage cannot be read', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isInstallDismissed(throwingStorage)).toBe(false);
  });

  it('does not throw when storage cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => dismissInstall(throwingStorage)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});
