import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from './i18n';

describe('start without Supabase configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders the startup error with the missing variable instead of a blank page', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const container = document.body.appendChild(document.createElement('div'));
    const { start } = await import('./start');
    await start(container);
    expect(await screen.findByRole('heading', { name: t.startupError.title })).toBeVisible();
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeVisible();
  });
});
