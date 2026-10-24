import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test/fakeInstall';
import { applyTheme, readTheme, saveTheme, type Theme } from './theme';

function throwingStorage(): Storage {
  throw new DOMException('storage is disabled', 'SecurityError');
}

function addThemeColorMetas() {
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />`;
}

function themeColors() {
  return [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

describe('the theme preference', () => {
  it('follows the system on a fresh device', () => {
    const storage = memoryStorage();
    expect(readTheme(() => storage)).toBe('system');
  });

  it.each<Theme>(['system', 'light', 'dark'])('remembers %s under amrap.theme', (theme) => {
    const storage = memoryStorage();
    saveTheme(() => storage, theme);
    expect(readTheme(() => storage)).toBe(theme);
    expect(storage.getItem('amrap.theme')).toBe(theme);
  });

  it('follows the system when the stored value is unknown', () => {
    const storage = memoryStorage();
    storage.setItem('amrap.theme', 'sepia');
    expect(readTheme(() => storage)).toBe('system');
  });

  it('follows the system when storage cannot be read', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readTheme(throwingStorage)).toBe('system');
  });

  it('does not throw when storage cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveTheme(throwingStorage, 'dark')).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('applying a theme', () => {
  beforeEach(addThemeColorMetas);

  it.each<[Theme, string]>([
    ['light', '#ffffff'],
    ['dark', '#000000'],
  ])('marks the page %s and gives both theme colours its paper', (theme, paper) => {
    applyTheme(document, theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(themeColors()).toEqual([paper, paper]);
  });

  it('leaves the system theme unmarked, with one theme colour per scheme', () => {
    applyTheme(document, 'dark');
    applyTheme(document, 'system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(themeColors()).toEqual(['#ffffff', '#000000']);
  });
});

describe('the script in index.html', () => {
  const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

  function runWith(storage: Pick<Storage, 'getItem'>) {
    vi.stubGlobal('localStorage', storage);
    (0, eval)(source);
  }

  beforeEach(addThemeColorMetas);
  afterEach(() => vi.unstubAllGlobals());

  it('applies a stored theme before the app starts', () => {
    const storage = memoryStorage();
    storage.setItem('amrap.theme', 'dark');
    runWith(storage);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeColors()).toEqual(['#000000', '#000000']);
  });

  it('leaves the page to the system theme when nothing is stored', () => {
    runWith(memoryStorage());
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(themeColors()).toEqual(['#ffffff', '#000000']);
  });

  it('leaves no global behind', () => {
    const storage = memoryStorage();
    storage.setItem('amrap.theme', 'light');
    runWith(storage);
    expect('theme' in globalThis).toBe(false);
  });

  it('does not throw when storage cannot be read', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => runWith({ getItem: () => throwingStorage().getItem('') })).not.toThrow();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
