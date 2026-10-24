import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { AccountMenu } from './AccountMenu';

function renderMenu() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            <AccountMenu />
            <p>{t.common.loading}</p>
          </>
        ),
      },
      { path: '/logout', element: <p>{t.logoutFailed.title}</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const menuButton = () => screen.getByRole('button', { name: t.account.menu });
const appearance = () => screen.queryByRole('group', { name: t.account.appearance });

describe('AccountMenu', () => {
  it('starts closed', () => {
    renderMenu();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(appearance()).not.toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])('opens with %s and focuses the chosen theme', async (key) => {
    renderMenu();
    menuButton().focus();
    await userEvent.keyboard(key);
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    expect(appearance()).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: t.account.theme.system })).toBeChecked();
    expect(screen.getByRole('radio', { name: t.account.theme.system })).toHaveFocus();
  });

  it('applies and remembers the chosen theme', async () => {
    renderMenu();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('radio', { name: t.account.theme.dark }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('amrap.theme')).toBe('dark');
  });

  it('shows the remembered theme the next time', async () => {
    localStorage.setItem('amrap.theme', 'light');
    renderMenu();
    await userEvent.click(menuButton());
    expect(screen.getByRole('radio', { name: t.account.theme.light })).toBeChecked();
  });

  it('goes back to the system theme', async () => {
    localStorage.setItem('amrap.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
    renderMenu();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('radio', { name: t.account.theme.system }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem('amrap.theme')).toBe('system');
  });

  it('closes with Escape and returns focus to its button', async () => {
    renderMenu();
    await userEvent.click(menuButton());
    await userEvent.keyboard('{Escape}');
    expect(appearance()).not.toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton()).toHaveFocus();
  });

  it('closes on a click outside it', async () => {
    renderMenu();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByText(t.common.loading));
    expect(appearance()).not.toBeInTheDocument();
  });

  it('closes when its button is pressed again', async () => {
    renderMenu();
    await userEvent.click(menuButton());
    await userEvent.click(menuButton());
    expect(appearance()).not.toBeInTheDocument();
  });

  it('closes when focus moves out of it', async () => {
    renderMenu();
    await userEvent.click(menuButton());
    await userEvent.tab();
    await userEvent.tab();
    expect(appearance()).not.toBeInTheDocument();
  });

  it('signs out through /logout', async () => {
    const router = renderMenu();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('link', { name: t.common.signOut }));
    expect(router.state.location.pathname).toBe('/logout');
  });
});
