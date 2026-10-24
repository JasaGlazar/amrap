import type { StorageAccess } from '../install/flags';

export type Theme = 'system' | 'light' | 'dark';

export const themes: readonly Theme[] = ['system', 'light', 'dark'];

const key = 'amrap.theme';

const paper = { light: '#ffffff', dark: '#000000' } as const;

const isTheme = (value: string | null): value is Theme => themes.some((theme) => theme === value);

export function readTheme(storage: StorageAccess): Theme {
  try {
    const value = storage().getItem(key);
    return isTheme(value) ? value : 'system';
  } catch (error) {
    console.warn('theme preference could not be read', error);
    return 'system';
  }
}

export function saveTheme(storage: StorageAccess, theme: Theme): void {
  try {
    storage().setItem(key, theme);
  } catch (error) {
    console.warn('theme preference could not be saved', error);
  }
}

export function applyTheme(document: Document, theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme =
      theme === 'system'
        ? meta.getAttribute('media')?.includes('dark')
          ? 'dark'
          : 'light'
        : theme;
    meta.setAttribute('content', paper[scheme]);
  }
}
