import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { routes } from '../routes';
import {
  authError,
  db,
  emitAuth,
  fakeSupabase,
  makeCustomer,
  makeSession,
  resetFake,
} from '../test/fakeSupabase';

vi.mock('../lib/supabase', async () => ({
  supabase: (await import('../test/fakeSupabase')).fakeSupabase,
}));

const CODE = 'gym-code-2026';
const PATH = `/registracija?koda=${CODE}`;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

type Fields = { name: string; phone: string; email: string; password: string; confirm: string };

const valid: Fields = {
  name: 'Nova Stranka',
  phone: '040123456',
  email: 'nova@amrap.local',
  password: 'secret1',
  confirm: 'secret1',
};

async function fillFull(fields: Partial<Fields> = {}) {
  const all = { ...valid, ...fields };
  await userEvent.type(await screen.findByLabelText(t.register.name), all.name);
  await userEvent.type(screen.getByLabelText(t.register.phone), all.phone);
  await userEvent.type(screen.getByLabelText(t.register.email), all.email);
  await userEvent.type(screen.getByLabelText(t.register.password), all.password);
  await userEvent.type(screen.getByLabelText(t.register.confirmPassword), all.confirm);
  await userEvent.click(screen.getByRole('button', { name: t.register.submit }));
}

function signUpCreatesSession() {
  fakeSupabase.auth.signUp.mockImplementation(async () => {
    const session = makeSession('user-new');
    emitAuth('SIGNED_IN', session);
    return { data: { session }, error: null };
  });
}

function accountExists() {
  fakeSupabase.auth.signUp.mockResolvedValue({
    data: { session: null },
    error: authError('user_already_exists', 'User already registered'),
  });
}

function registerCalls() {
  return fakeSupabase.rpc.mock.calls.filter(([name]) => name === 'register_customer');
}

beforeEach(() => {
  resetFake();
  db.registrationCode = CODE;
});

describe('registration without a code', () => {
  it('tells the person to scan the QR code and shows no form', async () => {
    const router = renderAt('/registracija');
    expect(await screen.findByText(t.register.noCode)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/registracija');
  });

  it('shows no form to a signed-in person without a record either', async () => {
    resetFake({ session: makeSession('user-new') });
    renderAt('/registracija');
    expect(await screen.findByText(t.register.noCode)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('registration while signed out', () => {
  it('asks for name, phone, email, password and the password again, all required', async () => {
    renderAt(PATH);
    await screen.findByRole('heading', { name: t.register.title });
    expect(screen.getByText(t.register.intro)).toBeInTheDocument();
    const labels = [
      t.register.name,
      t.register.phone,
      t.register.email,
      t.register.password,
      t.register.confirmPassword,
    ];
    for (const label of labels) expect(screen.getByLabelText(label)).toBeRequired();
  });

  it('gives the phone field the phone keyboard and both fields autofill hints', async () => {
    renderAt(PATH);
    const phone = await screen.findByLabelText(t.register.phone);
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(screen.getByLabelText(t.register.name)).toHaveAttribute('autocomplete', 'name');
  });

  it.each([
    ['a password under 6 characters', { password: 'abc12', confirm: 'abc12' }, 'passwordTooShort'],
    ['passwords that differ', { confirm: 'secret2' }, 'passwordMismatch'],
    ['a name under 2 characters', { name: 'A' }, 'nameLength'],
    ['a name of only spaces', { name: '    ' }, 'nameLength'],
    ['a name over 80 characters', { name: 'A'.repeat(81) }, 'nameLength'],
    ['a name under 2 characters once trimmed', { name: '  A  ' }, 'nameLength'],
    ['a phone under 6 characters', { phone: '12345' }, 'phoneLength'],
    ['a phone of only spaces', { phone: '        ' }, 'phoneLength'],
    ['a phone under 6 characters once trimmed', { phone: '  12345  ' }, 'phoneLength'],
    ['a phone over 30 characters', { phone: '1'.repeat(31) }, 'phoneLength'],
  ] as const)('refuses %s without a request', async (_case, fields, key) => {
    renderAt(PATH);
    await fillFull(fields);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.register[key]);
    expect(fakeSupabase.auth.signUp).not.toHaveBeenCalled();
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('accepts a name of 80 and a phone of 30 characters', async () => {
    signUpCreatesSession();
    renderAt(PATH);
    await fillFull({ name: 'A'.repeat(80), phone: '1'.repeat(30) });
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('register_customer', {
      p_name: 'A'.repeat(80),
      p_phone: '1'.repeat(30),
      p_code: CODE,
    });
  });

  it('checks the upper bounds on the trimmed name and phone', async () => {
    signUpCreatesSession();
    renderAt(PATH);
    await fillFull({ name: `  ${'A'.repeat(80)}  `, phone: `  ${'1'.repeat(30)}  ` });
    await screen.findByRole('heading', { name: t.nav.home });
    expect(registerCalls()).toEqual([
      ['register_customer', { p_name: 'A'.repeat(80), p_phone: '1'.repeat(30), p_code: CODE }],
    ]);
  });

  it('signs up, registers with the trimmed fields and the code, and lands on the customer home', async () => {
    signUpCreatesSession();
    const router = renderAt(PATH);
    await fillFull({ name: '  Nova Stranka  ', phone: ' 040 123 456 ' });
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.auth.signUp).toHaveBeenCalledWith({
      email: valid.email,
      password: valid.password,
    });
    expect(registerCalls()).toEqual([
      ['register_customer', { p_name: 'Nova Stranka', p_phone: '040 123 456', p_code: CODE }],
    ]);
    expect(router.state.location.pathname).toBe('/c');
  });

  it('shows the no-session copy when sign-up returns no session', async () => {
    fakeSupabase.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    renderAt(PATH);
    await fillFull();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.register.noSession);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('signs in to an existing account with the right password and registers it', async () => {
    accountExists();
    fakeSupabase.auth.signInWithPassword.mockImplementation(async () => {
      emitAuth('SIGNED_IN', makeSession('user-new'));
      return { data: {}, error: null };
    });
    const router = renderAt(PATH);
    await fillFull();
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: valid.email,
      password: valid.password,
    });
    expect(registerCalls()).toHaveLength(1);
    expect(router.state.location.pathname).toBe('/c');
  });

  it('sends the owner of an existing account to sign in when the password is wrong', async () => {
    accountExists();
    fakeSupabase.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('invalid_credentials', 'Invalid login credentials'),
    });
    const router = renderAt(PATH);
    await fillFull();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.register.accountExists);
    expect(screen.getByRole('link', { name: t.register.signIn })).toHaveAttribute('href', '/login');
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/registracija');
  });

  it('shows another sign-in error as it is', async () => {
    accountExists();
    fakeSupabase.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: authError('over_request_rate_limit', 'Too many requests'),
    });
    renderAt(PATH);
    await fillFull();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t.authErrors.over_request_rate_limit,
    );
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('shows other sign-up errors without trying to sign in', async () => {
    fakeSupabase.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: authError('weak_password', 'Password is too weak'),
    });
    renderAt(PATH);
    await fillFull();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.authErrors.weak_password);
    expect(fakeSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows the closed copy for a refused code and stays on the page', async () => {
    signUpCreatesSession();
    db.registrationCode = 'a-newer-code';
    const router = renderAt(PATH);
    await fillFull();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.AMRAP_REGISTRATION_CLOSED);
    expect(router.state.location.pathname).toBe('/registracija');
    expect(screen.queryByLabelText(t.register.email)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t.register.password)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.register.finish }));
    await vi.waitFor(() => expect(registerCalls()).toHaveLength(2));
    expect(fakeSupabase.auth.signUp).toHaveBeenCalledTimes(1);
  });

  it('sends the owner of an account that already has a record to their home', async () => {
    accountExists();
    fakeSupabase.auth.signInWithPassword.mockImplementation(async () => {
      db.customer = makeCustomer({ id: 'customer-1', auth_user_id: 'user-c' });
      emitAuth('SIGNED_IN', makeSession('user-c'));
      return { data: {}, error: null };
    });
    const router = renderAt(PATH);
    await fillFull();
    await screen.findByRole('heading', { name: t.nav.home });
    expect(router.state.location.pathname).toBe('/c');
  });
});

describe('registration when the customer lookup fails', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('shows the lookup-failed page and no form', async () => {
    resetFake({ session: makeSession('user-new') });
    db.customersError = { message: 'FetchError: network down' };
    const router = renderAt(PATH);
    await screen.findByRole('heading', { name: t.lookupFailed.title });
    expect(screen.queryByLabelText(t.register.name)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/registracija');
  });
});

describe('registration while signed in', () => {
  it('finishes the registration of an account without a record with name and phone only', async () => {
    resetFake({ session: makeSession('user-new') });
    db.registrationCode = CODE;
    const router = renderAt(PATH);
    await userEvent.type(await screen.findByLabelText(t.register.name), ' Nova ');
    await userEvent.type(screen.getByLabelText(t.register.phone), '040123456');
    expect(screen.queryByLabelText(t.register.email)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t.register.password)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t.register.confirmPassword)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.register.finish }));
    await screen.findByRole('heading', { name: t.nav.home });
    expect(fakeSupabase.auth.signUp).not.toHaveBeenCalled();
    expect(registerCalls()).toEqual([
      ['register_customer', { p_name: 'Nova', p_phone: '040123456', p_code: CODE }],
    ]);
    expect(router.state.location.pathname).toBe('/c');
  });

  it('checks name and phone before the request', async () => {
    resetFake({ session: makeSession('user-new') });
    renderAt(PATH);
    await userEvent.type(await screen.findByLabelText(t.register.name), 'Nova');
    await userEvent.type(screen.getByLabelText(t.register.phone), '123');
    await userEvent.click(screen.getByRole('button', { name: t.register.finish }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.register.phoneLength);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('sends a person who already has a record to their home', async () => {
    const customer = makeCustomer({ id: 'customer-1', auth_user_id: 'user-c' });
    resetFake({ session: makeSession('user-c'), customer });
    const router = renderAt(PATH);
    await screen.findByRole('heading', { name: t.nav.home });
    expect(router.state.location.pathname).toBe('/c');
  });
});
