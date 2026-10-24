import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBalance, t } from './i18n';
import { InstallContext } from './install/platform';
import { routes } from './routes';
import { fakeInstallPlatform } from './test/fakeInstall';
import {
  authError,
  db,
  emitAuth,
  fakeSupabase,
  makeCustomer,
  makeSession,
  resetFake,
  selects,
} from './test/fakeSupabase';

vi.mock('./lib/supabase', async () => ({
  supabase: (await import('./test/fakeSupabase')).fakeSupabase,
}));

const trainer = makeCustomer({ id: 'trainer-1', role: 'trainer', auth_user_id: 'user-t' });
const customer = makeCustomer({ id: 'customer-1', role: 'customer', auth_user_id: 'user-c' });

function renderAt(path: string, install = fakeInstallPlatform().platform) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <InstallContext.Provider value={install}>
      <RouterProvider router={router} />
    </InstallContext.Provider>,
  );
  return router;
}

function signedInAs(row: typeof trainer) {
  resetFake({ session: makeSession(row.auth_user_id!), customer: row });
}

beforeEach(() => resetFake());

describe('unauthenticated visitor', () => {
  it.each(['/', '/c', '/t', '/t/nastavitve'])('is sent from %s to /login', async (path) => {
    const router = renderAt(path);
    await screen.findByRole('heading', { name: t.login.title });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('can open the invite page without signing in', async () => {
    const router = renderAt('/invite/abc');
    await screen.findByRole('heading', { name: t.invite.title });
    expect(router.state.location.pathname).toBe('/invite/abc');
  });

  it.each([
    ['/login', t.login.title, t.login.submit],
    ['/invite/abc', t.invite.title, t.invite.submit],
  ])('does not repeat the heading of %s on its submit button', async (path, title, submit) => {
    renderAt(path);
    const heading = await screen.findByRole('heading', { name: title });
    const button = screen.getByRole('button', { name: submit });
    expect(button.textContent).not.toBe(heading.textContent);
  });
});

describe('role gating', () => {
  it('sends a trainer from / to /t', async () => {
    signedInAs(trainer);
    const router = renderAt('/');
    await screen.findByRole('heading', { name: t.trainer.todayTitle });
    expect(router.state.location.pathname).toBe('/t');
  });

  it('sends a customer from / to /c', async () => {
    signedInAs(customer);
    const router = renderAt('/');
    await screen.findByRole('heading', { name: t.nav.home });
    expect(router.state.location.pathname).toBe('/c');
  });

  it('sends a customer away from /t to /c', async () => {
    signedInAs(customer);
    const router = renderAt('/t/stranke');
    await screen.findByRole('heading', { name: t.nav.home });
    expect(router.state.location.pathname).toBe('/c');
  });

  it('sends a trainer away from /c to /t', async () => {
    signedInAs(trainer);
    const router = renderAt('/c/zgodovina');
    await screen.findByRole('heading', { name: t.trainer.todayTitle });
    expect(router.state.location.pathname).toBe('/t');
  });

  it('sends a signed-in user away from /login', async () => {
    signedInAs(customer);
    const router = renderAt('/login');
    await screen.findByRole('heading', { name: t.nav.home });
    expect(router.state.location.pathname).toBe('/c');
  });

  it('does not redirect to /login while the session is still loading', async () => {
    signedInAs(customer);
    const router = renderAt('/c');
    expect(screen.getByText(t.common.loading)).toBeInTheDocument();
    await screen.findByRole('heading', { name: t.nav.home });
    expect(router.state.location.pathname).toBe('/c');
  });

  it('looks up the customers row of the signed-in user', async () => {
    signedInAs(customer);
    renderAt('/c');
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.from).toHaveBeenCalledWith('customers');
  });
});

describe('signed-in user without a customers row', () => {
  beforeEach(() => resetFake({ session: makeSession('user-x') }));

  it.each(['/', '/c', '/t'])('sees the not-linked page at %s', async (path) => {
    const router = renderAt(path);
    await screen.findByRole('heading', { name: t.notLinked.title });
    expect(router.state.location.pathname).toBe(path);
  });

  it('can sign out from the not-linked page', async () => {
    const router = renderAt('/');
    await userEvent.click(await screen.findByRole('link', { name: t.common.signOut }));
    await screen.findByRole('heading', { name: t.login.title });
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('failed customers lookup', () => {
  beforeEach(() => {
    signedInAs(customer);
    db.customersError = { message: 'FetchError: network down' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the error page, not the not-linked page', async () => {
    const router = renderAt('/c');
    await screen.findByRole('heading', { name: t.lookupFailed.title });
    expect(screen.queryByRole('heading', { name: t.notLinked.title })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/c');
  });

  it('retries the lookup and enters the app once it succeeds', async () => {
    renderAt('/c');
    await userEvent.click(await screen.findByRole('button', { name: t.lookupFailed.retry }));
    db.customersError = null;
    await userEvent.click(await screen.findByRole('button', { name: t.lookupFailed.retry }));
    expect(await screen.findByRole('heading', { name: t.nav.home })).toBeVisible();
  });

  it('can sign out', async () => {
    const router = renderAt('/c');
    await userEvent.click(await screen.findByRole('link', { name: t.common.signOut }));
    await screen.findByRole('heading', { name: t.login.title });
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('shells', () => {
  it('shows the trainer navigation', async () => {
    signedInAs(trainer);
    renderAt('/t');
    const nav = await screen.findByRole('navigation', { name: t.nav.trainerLabel });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual([t.nav.today, t.nav.calendar, t.nav.customers, t.nav.settings]);
  });

  it('shows the customer navigation', async () => {
    signedInAs(customer);
    renderAt('/c');
    const nav = await screen.findByRole('navigation', { name: t.nav.customerLabel });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual([t.nav.home, t.nav.calendar, t.nav.history]);
  });

  it('shows the install card in the trainer shell too', async () => {
    signedInAs(trainer);
    renderAt('/t', fakeInstallPlatform({ device: { ios: true } }).platform);
    const card = await screen.findByRole('complementary', { name: t.install.title });
    expect(within(card).getByText(t.install.iosShare)).toBeInTheDocument();
    expect(within(card).getByText(t.install.iosWhyTrainer)).toBeInTheDocument();
  });

  it('keeps the install card on every customer page until it is dismissed', async () => {
    signedInAs(customer);
    renderAt('/c', fakeInstallPlatform({ device: { ios: true } }).platform);
    await screen.findByRole('complementary', { name: t.install.title });
    await userEvent.click(screen.getByRole('link', { name: t.nav.history }));
    await screen.findByRole('heading', { name: t.customer.historyTitle });
    expect(screen.getByRole('complementary', { name: t.install.title })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: t.install.notNow }));

    expect(screen.queryByRole('complementary', { name: t.install.title })).not.toBeInTheDocument();
  });

  it('navigates between customer pages', async () => {
    signedInAs(customer);
    const router = renderAt('/c');
    await userEvent.click(await screen.findByRole('link', { name: t.nav.history }));
    expect(await screen.findByRole('heading', { name: t.customer.historyTitle })).toBeVisible();
    expect(router.state.location.pathname).toBe('/c/zgodovina');
  });

  it('signs out from the customer shell through /logout', async () => {
    signedInAs(customer);
    const router = renderAt('/c');
    await userEvent.click(await screen.findByRole('link', { name: t.common.signOut }));
    await screen.findByRole('heading', { name: t.login.title });
    expect(fakeSupabase.auth.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows the balance from customer_balances and no upcoming appointments', async () => {
    signedInAs(customer);
    db.balance = 6;
    renderAt('/c');
    expect(await screen.findByText(String(db.balance))).toBeInTheDocument();
    expect(screen.getByText(t.customer.noUpcoming)).toBeInTheDocument();
  });

  it('marks a negative balance', async () => {
    signedInAs(customer);
    db.balance = -2;
    renderAt('/c');
    expect(await screen.findByText(formatBalance(db.balance))).toHaveClass('negative');
  });
});

describe('keep-alive', () => {
  const settingsReads = () =>
    selects.filter(({ table, columns }) => table === 'settings' && columns === 'id').length;

  it('reads settings once after sign-in, not again on token refresh', async () => {
    signedInAs(customer);
    renderAt('/c');
    await screen.findByRole('heading', { name: t.nav.home });
    emitAuth('TOKEN_REFRESHED', makeSession('user-c'));
    await userEvent.click(screen.getByRole('link', { name: t.nav.history }));
    await waitFor(() => expect(settingsReads()).toBe(1));
  });

  it('does not read settings while signed out', async () => {
    renderAt('/login');
    await screen.findByRole('heading', { name: t.login.title });
    expect(settingsReads()).toBe(0);
  });

  it('still shows the app when the keep-alive read fails', async () => {
    signedInAs(customer);
    db.settingsError = { message: 'paused' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt('/c');
    await screen.findByRole('navigation', { name: t.nav.customerLabel });
    await waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});

describe('login', () => {
  it('signs in and lands on the role home', async () => {
    db.customer = trainer;
    fakeSupabase.auth.signInWithPassword.mockImplementation(async () => {
      emitAuth('SIGNED_IN', makeSession('user-t'));
      return { data: {}, error: null };
    });
    const router = renderAt('/login');
    await userEvent.type(await screen.findByLabelText(t.login.email), 'trainer@amrap.local');
    await userEvent.type(screen.getByLabelText(t.login.password), 'password');
    await userEvent.click(screen.getByRole('button', { name: t.login.submit }));
    await screen.findByRole('heading', { name: t.trainer.todayTitle });
    expect(fakeSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'trainer@amrap.local',
      password: 'password',
    });
    expect(router.state.location.pathname).toBe('/t');
  });

  it('shows a Slovenian message for wrong credentials and stays on /login', async () => {
    fakeSupabase.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('invalid_credentials', 'Invalid login credentials'),
    });
    const router = renderAt('/login');
    await userEvent.type(await screen.findByLabelText(t.login.email), 'a@b.c');
    await userEvent.type(screen.getByLabelText(t.login.password), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: t.login.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.authErrors.invalid_credentials);
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('logout', () => {
  it('signs out and redirects to /login', async () => {
    signedInAs(customer);
    const router = renderAt('/logout');
    await screen.findByRole('heading', { name: t.login.title });
    expect(fakeSupabase.auth.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('logout failure', () => {
  it('stays on the page, shows the error and logs it', async () => {
    signedInAs(customer);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeSupabase.auth.signOut.mockResolvedValue({ error: authError('unexpected_failure', 'boom') });
    const router = renderAt('/logout');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.genericError);
    expect(router.state.location.pathname).toBe('/logout');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('invite flow', () => {
  async function fillAndSubmit(password: string, confirm: string) {
    await userEvent.type(await screen.findByLabelText(t.invite.email), 'new@amrap.local');
    await userEvent.type(screen.getByLabelText(t.invite.password), password);
    await userEvent.type(screen.getByLabelText(t.invite.confirmPassword), confirm);
    await userEvent.click(screen.getByRole('button', { name: t.invite.submit }));
  }

  function signUpCreatesSession() {
    fakeSupabase.auth.signUp.mockImplementation(async () => {
      const session = makeSession('user-c');
      emitAuth('SIGNED_IN', session);
      return { data: { session }, error: null };
    });
  }

  it('signs up, accepts the invite with the URL token and lands on the customer home', async () => {
    signUpCreatesSession();
    fakeSupabase.rpc.mockImplementation(async () => {
      db.customer = customer;
      return { data: customer.id, error: null };
    });
    const router = renderAt('/invite/tok-123');
    await fillAndSubmit('secret1', 'secret1');
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@amrap.local',
      password: 'secret1',
    });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('accept_invite', { p_token: 'tok-123' });
    expect(router.state.location.pathname).toBe('/c');
  });

  it('offers to install the app on the first screen after accepting the invite', async () => {
    signUpCreatesSession();
    fakeSupabase.rpc.mockImplementation(async () => {
      db.customer = customer;
      return { data: customer.id, error: null };
    });
    const install = fakeInstallPlatform({ device: { android: true } });
    install.firePrompt();
    renderAt('/invite/tok-123', install.platform);
    expect(screen.queryByRole('complementary', { name: t.install.title })).not.toBeInTheDocument();

    await fillAndSubmit('secret1', 'secret1');

    const card = await screen.findByRole('complementary', { name: t.install.title });
    expect(within(card).getByRole('button', { name: t.install.install })).toBeInTheDocument();
  });

  it('shows the Slovenian message for a rejected invite and does not enter the app', async () => {
    signUpCreatesSession();
    fakeSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'AMRAP_INVITE_INVALID: unknown token' },
    });
    const router = renderAt('/invite/bad');
    await fillAndSubmit('secret1', 'secret1');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.AMRAP_INVITE_INVALID);
    expect(router.state.location.pathname).toBe('/invite/bad');
  });

  it('rejects mismatching passwords without calling Supabase', async () => {
    renderAt('/invite/tok');
    await fillAndSubmit('secret1', 'secret2');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.invite.passwordMismatch);
    expect(fakeSupabase.auth.signUp).not.toHaveBeenCalled();
  });

  it('rejects a too short password without calling Supabase', async () => {
    renderAt('/invite/tok');
    await fillAndSubmit('abc', 'abc');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.invite.passwordTooShort);
    expect(fakeSupabase.auth.signUp).not.toHaveBeenCalled();
  });

  it('shows the sign-up error when the existing account does not accept the password', async () => {
    fakeSupabase.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: authError('user_already_exists', 'User already registered'),
    });
    fakeSupabase.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('invalid_credentials', 'Invalid login credentials'),
    });
    renderAt('/invite/tok');
    await fillAndSubmit('secret1', 'secret1');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.authErrors.user_already_exists);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('shows other sign-up errors without trying to sign in', async () => {
    fakeSupabase.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: authError('weak_password', 'Password is too weak'),
    });
    renderAt('/invite/tok');
    await fillAndSubmit('secret1', 'secret1');
    expect(await screen.findByRole('alert')).toHaveTextContent(t.authErrors.weak_password);
    expect(fakeSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('continues as the existing unlinked account and accepts the invite', async () => {
    fakeSupabase.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: authError('user_already_exists', 'User already registered'),
    });
    fakeSupabase.auth.signInWithPassword.mockImplementation(async () => {
      emitAuth('SIGNED_IN', makeSession('user-c'));
      return { data: {}, error: null };
    });
    fakeSupabase.rpc.mockImplementation(async () => {
      db.customer = customer;
      return { data: customer.id, error: null };
    });
    const router = renderAt('/invite/tok-2');
    await fillAndSubmit('secret1', 'secret1');
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('accept_invite', { p_token: 'tok-2' });
    expect(router.state.location.pathname).toBe('/c');
  });

  it('shows the sign-in error when the existing account cannot be signed in for another reason', async () => {
    fakeSupabase.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: authError('user_already_exists', 'User already registered'),
    });
    fakeSupabase.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('over_request_rate_limit', 'Too many requests'),
    });
    renderAt('/invite/tok');
    await fillAndSubmit('secret1', 'secret1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t.authErrors.over_request_rate_limit,
    );
  });
});
