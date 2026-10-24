import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, formatAmount, formatBalance, t } from '../../i18n';
import { formatLongDay, formatTime, weekdayName } from '../../lib/time';
import { routes } from '../../routes';
import { PAGE_SIZE } from '../../data/page';
import { RECENT_DAYS } from './CustomerDetail';
import {
  db,
  fakeSupabase,
  holdTable,
  makeCustomer,
  makeSession,
  resetFake,
} from '../../test/fakeSupabase';
import {
  expectEveryPage,
  expectLoadingThenRows,
  expectRetryAfterFailure,
  PAGED_TOTAL,
} from '../../test/paging';

vi.mock('../../lib/supabase', async () => ({
  supabase: (await import('../../test/fakeSupabase')).fakeSupabase,
}));

const trainer = makeCustomer({ id: 'trainer-1', role: 'trainer', auth_user_id: 'user-t' });
const later = new Date(Date.now() + 86_400_000).toISOString();
const ana = makeCustomer({ id: 'c-ana', name: 'Ana', auth_user_id: 'u-ana' });
const bor = makeCustomer({
  id: 'c-bor',
  name: 'Bor',
  auth_user_id: null,
  invite_token: 'pending-token',
  invite_expires_at: later,
});
const cvet = makeCustomer({ id: 'c-cvet', name: 'Cvetka', auth_user_id: null });
const template = {
  id: 'tpl-mon',
  weekday: 0,
  start_time: '07:00:00',
  duration_minutes: 60,
  capacity: 5,
  active: true,
};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function openNewCustomer() {
  await userEvent.click(await screen.findByRole('button', { name: t.customers.newTitle }));
  return screen.getByRole('form', { name: t.customers.newTitle });
}

beforeEach(() => {
  resetFake({ session: makeSession('user-t'), customer: trainer });
  db.tables.customers = [cvet, ana, bor];
  db.tables.customer_balances = [
    { customer_id: ana.id, balance: 4 },
    { customer_id: bor.id, balance: -2 },
    { customer_id: cvet.id, balance: 0 },
  ];
  db.tables.slot_templates = [template];
});

describe('customer list', () => {
  it('keeps Prekliči disabled while the new customer is being saved', async () => {
    renderAt('/t/stranke');
    const form = await openNewCustomer();
    await userEvent.type(within(form).getByLabelText(t.customers.name), 'Dora');
    const release = holdTable('customers');
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    expect(within(form).getByRole('button', { name: t.common.cancel })).toBeDisabled();
    release();
    expect(await screen.findByRole('heading', { name: 'Dora' })).toBeVisible();
  });

  it('lists customers by name with invite status and balance, negative in red', async () => {
    renderAt('/t/stranke');
    const list = await screen.findByRole('region', { name: t.customers.listTitle });
    const items = within(list).getAllByRole('listitem');
    const expected = [ana, bor, cvet];
    expect(items.map((item) => within(item).getByRole('link').textContent)).toEqual(
      expected.map((row) => row.name),
    );
    expect(items[1]).toHaveTextContent(t.customers.inviteStatus.pending);
    expect(items[2]).toHaveTextContent(t.customers.inviteStatus.none);
    const borBalance = db.tables.customer_balances.find((row) => row.customer_id === bor.id);
    expect(within(items[1]).getByText(formatBalance(Number(borBalance?.balance)))).toHaveClass(
      'negative',
    );
  });

  it('shows no status tag for a linked customer, the normal end state', async () => {
    renderAt('/t/stranke');
    const list = await screen.findByRole('region', { name: t.customers.listTitle });
    const linked = within(list).getByRole('link', { name: ana.name }).closest('li');
    expect(linked).not.toBeNull();
    expect(linked).not.toHaveTextContent(t.customers.inviteStatus.linked);
  });

  it('marks only negative balances, leaving zero and positive in plain ink', async () => {
    renderAt('/t/stranke');
    const list = await screen.findByRole('region', { name: t.customers.listTitle });
    for (const row of db.tables.customer_balances) {
      const balance = Number(row.balance);
      const name = db.tables.customers.find((customer) => customer.id === row.customer_id)?.name;
      if (typeof name !== 'string') throw new Error(`no customer ${String(row.customer_id)}`);
      const item = within(list).getByRole('link', { name }).closest('li') as HTMLElement;
      const amount = within(item).getByText(formatBalance(balance));
      expect(amount).not.toHaveClass('positive');
      expect(amount.classList.contains('negative')).toBe(balance < 0);
    }
  });

  it('shows Nova stranka as a button in the page header until it is pressed', async () => {
    renderAt('/t/stranke');
    const button = await screen.findByRole('button', { name: t.customers.newTitle });
    expect(screen.queryByRole('form', { name: t.customers.newTitle })).not.toBeInTheDocument();
    expect(button.parentElement).toContainElement(
      screen.getByRole('heading', { level: 1, name: t.trainer.customersTitle }),
    );
    await userEvent.click(button);
    const form = screen.getByRole('form', { name: t.customers.newTitle });
    expect(within(form).getByLabelText(t.customers.name)).toHaveFocus();
  });

  it('drops the input on Prekliči and puts focus back on Nova stranka', async () => {
    renderAt('/t/stranke');
    const form = await openNewCustomer();
    await userEvent.type(within(form).getByLabelText(t.customers.name), 'Dora');
    await userEvent.click(within(form).getByRole('button', { name: t.common.cancel }));
    expect(form).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: t.customers.newTitle });
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(screen.getByLabelText(t.customers.name)).toHaveValue('');
    expect(db.tables.customers.some((row) => row.name === 'Dora')).toBe(false);
  });

  it('creates a customer and opens the detail page', async () => {
    const router = renderAt('/t/stranke');
    const form = await openNewCustomer();
    await userEvent.type(within(form).getByLabelText(t.customers.name), 'Dora');
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    const created = db.tables.customers.find((row) => row.name === 'Dora');
    expect(created).toMatchObject({ phone: null, email: null });
    expect(await screen.findByRole('heading', { name: 'Dora' })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/t/stranke/${created?.id}`);
  });

  async function createWithStart(name: string, starting: string) {
    const router = renderAt('/t/stranke');
    const form = await openNewCustomer();
    await userEvent.type(within(form).getByLabelText(t.customers.name), name);
    if (starting !== '') {
      await userEvent.type(within(form).getByLabelText(t.customers.startingBalance), starting);
    }
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    return { router, form };
  }

  const ledgerOf = (name: string) => {
    const created = db.tables.customers.find((row) => row.name === name);
    return db.tables.credit_transactions.filter((row) => row.customer_id === created?.id);
  };

  it.each([
    ['a positive starting balance as a top-up', '8', 'topup', 8],
    ['a negative starting balance as an adjustment', '-3', 'adjustment', -3],
  ])('records %s with the starting note', async (_name, starting, type, amount) => {
    await createWithStart('Dora', starting);
    expect(await screen.findByRole('heading', { name: 'Dora' })).toBeVisible();
    expect(ledgerOf('Dora')).toEqual([
      expect.objectContaining({ type, amount, note: t.customerDetail.startingNote }),
    ]);
  });

  it.each([
    ['empty', ''],
    ['zero', '0'],
  ])('records nothing for a starting balance that is %s', async (_name, starting) => {
    await createWithStart('Dora', starting);
    expect(await screen.findByRole('heading', { name: 'Dora' })).toBeVisible();
    expect(ledgerOf('Dora')).toEqual([]);
  });

  it('labels the starting balance without a reference to the paper sheet', async () => {
    renderAt('/t/stranke');
    const form = await openNewCustomer();
    const starting = within(form).getByLabelText(t.customers.startingBalance);
    expect(t.customers.startingBalance).not.toMatch(/papir/i);
    expect(starting).toHaveAccessibleDescription(t.customers.startingHint);
  });

  it('rejects a starting balance that is not a whole number and creates nobody', async () => {
    const { form } = await createWithStart('Dora', '2.5');
    expect(within(form).getByRole('alert')).toHaveTextContent(t.customers.startingInvalid);
    expect(db.tables.customers.some((row) => row.name === 'Dora')).toBe(false);
  });

  it('rejects a starting balance the browser could not read as a number', async () => {
    renderAt('/t/stranke');
    const form = await openNewCustomer();
    await userEvent.type(within(form).getByLabelText(t.customers.name), 'Dora');
    const starting = within(form).getByLabelText(t.customers.startingBalance);
    Object.defineProperty(starting, 'validity', { value: { badInput: true }, configurable: true });
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.customers.startingInvalid);
    expect(db.tables.customers.some((row) => row.name === 'Dora')).toBe(false);
  });

  it('opens the new customer once and explains a failed starting balance there', async () => {
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_FORBIDDEN: not a trainer' },
    });
    const { router } = await createWithStart('Dora', '8');
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    expect(within(credits).getByRole('alert')).toHaveTextContent(
      fill(t.customerDetail.startingFailed, { error: t.errors.AMRAP_FORBIDDEN }),
    );
    expect(within(credits).getByLabelText(t.customerDetail.amount)).toHaveValue(8);
    expect(within(credits).getByLabelText(t.customerDetail.note)).toHaveValue(
      t.customerDetail.startingNote,
    );
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(db.tables.customers.filter((row) => row.name === 'Dora')).toHaveLength(1);
    expect(ledgerOf('Dora')).toEqual([]);
  });

  it('requires a name', async () => {
    renderAt('/t/stranke');
    const form = await openNewCustomer();
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.customers.nameRequired);
  });
});

describe('customer detail', () => {
  it('keeps Prekliči disabled while the details are being saved', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const section = await screen.findByRole('region', { name: t.customerDetail.detailsTitle });
    await userEvent.click(
      within(section).getByRole('button', { name: t.customerDetail.editDetails }),
    );
    const form = within(section).getByRole('form', { name: t.customerDetail.editDetails });
    const release = holdTable('customers');
    await userEvent.click(within(form).getByRole('button', { name: t.customerDetail.save }));
    expect(within(form).getByRole('button', { name: t.common.cancel })).toBeDisabled();
    release();
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

  it('keeps Prekliči disabled while a recurring rule is being added', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const rules = await screen.findByRole('region', { name: t.customerDetail.rulesTitle });
    await userEvent.click(within(rules).getByRole('button', { name: t.customerDetail.addRule }));
    const form = within(rules).getByRole('form', { name: t.customerDetail.addRuleLabel });
    await userEvent.selectOptions(
      within(form).getByLabelText(t.customerDetail.ruleTemplate),
      template.id,
    );
    const release = holdTable('recurring_rules');
    await userEvent.click(within(form).getByRole('button', { name: t.customerDetail.addRule }));
    expect(within(form).getByRole('button', { name: t.common.cancel })).toBeDisabled();
    release();
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

  beforeEach(() => {
    db.tables.credit_transactions = [
      {
        id: 'tx-ana',
        customer_id: ana.id,
        amount: 4,
        type: 'topup',
        note: null,
        created_at: new Date().toISOString(),
      },
    ];
  });

  it('keeps added credits green in the ledger', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const ledger = await screen.findByRole('region', { name: t.customerDetail.ledgerTitle });
    const topUp = db.tables.credit_transactions.find((row) => row.customer_id === ana.id);
    expect(within(ledger).getByText(formatAmount(Number(topUp?.amount)))).toHaveClass('positive');
  });

  it('tops up with the amount and note', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    await userEvent.type(within(credits).getByLabelText(t.customerDetail.amount), '10');
    await userEvent.type(within(credits).getByLabelText(t.customerDetail.note), 'Gotovina');
    await userEvent.click(within(credits).getByRole('button', { name: t.customerDetail.topUp }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('top_up', {
      p_customer_id: ana.id,
      p_amount: 10,
      p_note: 'Gotovina',
    });
    expect(await within(credits).findByRole('status')).toHaveTextContent(
      t.customerDetail.creditsSaved,
    );
  });

  it('adjusts by a negative amount but rejects a negative top-up', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    await userEvent.type(within(credits).getByLabelText(t.customerDetail.amount), '-1');
    await userEvent.click(within(credits).getByRole('button', { name: t.customerDetail.topUp }));
    expect(within(credits).getByRole('alert')).toHaveTextContent(t.customerDetail.topUpInvalid);
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('top_up', expect.anything());
    await userEvent.click(within(credits).getByRole('button', { name: t.customerDetail.adjust }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('adjust', {
      p_customer_id: ana.id,
      p_amount: -1,
      p_note: undefined,
    });
  });

  it('suggests the starting note while the customer has no credits yet', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    expect(within(credits).getByLabelText(t.customerDetail.note)).toHaveValue(
      t.customerDetail.startingNote,
    );
  });

  it('leaves the note empty once the customer has credits', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    expect(within(credits).getByLabelText(t.customerDetail.note)).toHaveValue('');
  });

  it('asks phones for a keyboard with a minus sign in the amount field', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    const amount = within(credits).getByLabelText(t.customerDetail.amount);
    expect(amount).toHaveAttribute('type', 'number');
    expect(amount).not.toHaveAttribute('inputmode', 'numeric');
  });

  it('keeps the browser from autofilling the trainer’s own details into a customer', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: t.customerDetail.editDetails }),
    );
    const details = screen.getByRole('form', { name: t.customerDetail.editDetails });
    for (const label of [t.customers.name, t.customers.phone, t.customers.email]) {
      expect(within(details).getByLabelText(label)).toHaveAttribute('autocomplete', 'off');
    }
    const credits = screen.getByRole('region', { name: t.customerDetail.creditsTitle });
    expect(within(credits).getByLabelText(t.customerDetail.note)).toHaveAttribute(
      'autocomplete',
      'off',
    );
  });

  it('creates an invite and shows the full link', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const invite = await screen.findByRole('region', { name: t.customerDetail.inviteTitle });
    await userEvent.click(
      within(invite).getByRole('button', { name: t.customerDetail.createInvite }),
    );
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('create_invite', { p_customer_id: cvet.id });
    const token = db.tables.customers.find((row) => row.id === cvet.id)?.invite_token;
    expect(await within(invite).findByLabelText(t.customerDetail.inviteLink)).toHaveValue(
      `${window.location.origin}/invite/${token}`,
    );
    expect(within(invite).getByRole('button', { name: t.customerDetail.copy })).toBeVisible();
  });

  it('says so when the link cannot be copied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt(`/t/stranke/${bor.id}`);
    const invite = await screen.findByRole('region', { name: t.customerDetail.inviteTitle });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await userEvent.click(within(invite).getByRole('button', { name: t.customerDetail.copy }));
    expect(await within(invite).findByRole('alert')).toHaveTextContent(t.customerDetail.copyFailed);
    warn.mockRestore();
  });

  it('shows a pending invite link and offers a new one', async () => {
    renderAt(`/t/stranke/${bor.id}`);
    const invite = await screen.findByRole('region', { name: t.customerDetail.inviteTitle });
    expect(within(invite).getByLabelText(t.customerDetail.inviteLink)).toHaveValue(
      `${window.location.origin}/invite/${bor.invite_token}`,
    );
    expect(within(invite).getByRole('button', { name: t.customerDetail.newInvite })).toBeVisible();
  });

  it('points a linked customer to the re-link steps instead of inviting', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const invite = await screen.findByRole('region', { name: t.customerDetail.inviteTitle });
    expect(invite).toHaveTextContent(t.customerDetail.relinkHint);
    expect(within(invite).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists recently charged appointments with a refund action, not a plain cancel', async () => {
    const day = 86_400_000;
    const charged = (id: string, daysAgo: number) => {
      const startsAt = new Date(Date.now() - daysAgo * day).toISOString();
      return {
        id,
        customer_id: ana.id,
        slot_template_id: template.id,
        starts_at: startsAt,
        ends_at: startsAt,
        status: 'charged',
      };
    };
    const ages = { recent: 3, old: RECENT_DAYS + 10 };
    db.tables.appointments = Object.entries(ages).map(([id, daysAgo]) => charged(id, daysAgo));
    renderAt(`/t/stranke/${ana.id}`);
    const recent = await screen.findByRole('region', {
      name: fill(t.customerDetail.recentTitle, { days: RECENT_DAYS }),
    });
    expect(within(recent).getAllByRole('listitem')).toHaveLength(
      Object.values(ages).filter((daysAgo) => daysAgo < RECENT_DAYS).length,
    );
    expect(within(recent).queryByRole('button', { name: t.slot.cancel })).toBeNull();
    await userEvent.click(within(recent).getByRole('button', { name: t.customerDetail.refund }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    expect(dialog).toHaveTextContent(t.cancelDialog.refund);
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'recent' });
  });

  it('lays out the page in the order the trainer uses it', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    await screen.findByRole('heading', { level: 1, name: ana.name });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      t.customerDetail.creditsTitle,
      t.customerDetail.upcomingTitle,
      t.customerDetail.rulesTitle,
      fill(t.customerDetail.recentTitle, { days: RECENT_DAYS }),
      t.customerDetail.ledgerTitle,
      t.customerDetail.inviteTitle,
      t.customerDetail.detailsTitle,
    ]);
  });

  it('puts the credits form next to the balance', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const credits = await screen.findByRole('region', { name: t.customerDetail.creditsTitle });
    const balance = screen.getByRole('region', { name: t.customer.balanceLabel });
    expect(balance.parentElement).toBe(credits.parentElement);
    expect(balance.parentElement).toHaveClass('summary');
  });

  it('shows the details as text until Uredi podatke is pressed', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const section = await screen.findByRole('region', { name: t.customerDetail.detailsTitle });
    expect(within(section).queryByRole('form')).not.toBeInTheDocument();
    expect(within(section).getAllByText(t.customerDetail.notGiven)).toHaveLength(
      [cvet.phone, cvet.email].filter((value) => value === null).length,
    );
    await userEvent.click(
      within(section).getByRole('button', { name: t.customerDetail.editDetails }),
    );
    const form = within(section).getByRole('form', { name: t.customerDetail.editDetails });
    expect(within(form).getByLabelText(t.customers.name)).toHaveFocus();
    expect(within(form).getByLabelText(t.customers.name)).toHaveValue(cvet.name);
  });

  it('drops edited details on Prekliči and puts focus back on Uredi podatke', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const section = await screen.findByRole('region', { name: t.customerDetail.detailsTitle });
    await userEvent.click(
      within(section).getByRole('button', { name: t.customerDetail.editDetails }),
    );
    const form = within(section).getByRole('form', { name: t.customerDetail.editDetails });
    await userEvent.type(within(form).getByLabelText(t.customers.phone), '041 000 000');
    await userEvent.click(within(form).getByRole('button', { name: t.common.cancel }));
    expect(form).not.toBeInTheDocument();
    const button = within(section).getByRole('button', { name: t.customerDetail.editDetails });
    expect(button).toHaveFocus();
    expect(db.tables.customers.find((row) => row.id === cvet.id)?.phone).toBeNull();
    await userEvent.click(button);
    expect(within(section).getByLabelText(t.customers.phone)).toHaveValue('');
  });

  it('saves the details, closes the form and shows the new phone', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const section = await screen.findByRole('region', { name: t.customerDetail.detailsTitle });
    await userEvent.click(
      within(section).getByRole('button', { name: t.customerDetail.editDetails }),
    );
    const form = within(section).getByRole('form', { name: t.customerDetail.editDetails });
    await userEvent.type(within(form).getByLabelText(t.customers.phone), '041 000 000');
    await userEvent.click(within(form).getByRole('button', { name: t.customerDetail.save }));
    expect(await within(section).findByRole('status')).toHaveTextContent(t.customerDetail.saved);
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(within(section).getByText('041 000 000')).toBeVisible();
    expect(
      within(section).getByRole('button', { name: t.customerDetail.editDetails }),
    ).toHaveFocus();
  });

  it('drops the saved line when the details form opens again', async () => {
    renderAt(`/t/stranke/${cvet.id}`);
    const section = await screen.findByRole('region', { name: t.customerDetail.detailsTitle });
    await userEvent.click(
      within(section).getByRole('button', { name: t.customerDetail.editDetails }),
    );
    await userEvent.click(within(section).getByRole('button', { name: t.customerDetail.save }));
    await within(section).findByRole('status');
    await userEvent.click(
      await within(section).findByRole('button', { name: t.customerDetail.editDetails }),
    );
    expect(within(section).queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows Dodaj stalni termin as a button until it is pressed, and drops the choice on Prekliči', async () => {
    const before = db.tables.recurring_rules.length;
    renderAt(`/t/stranke/${ana.id}`);
    const rules = await screen.findByRole('region', { name: t.customerDetail.rulesTitle });
    expect(within(rules).queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.click(within(rules).getByRole('button', { name: t.customerDetail.addRule }));
    const select = within(rules).getByLabelText(t.customerDetail.ruleTemplate);
    expect(select).toHaveFocus();
    await userEvent.selectOptions(select, template.id);
    await userEvent.click(within(rules).getByRole('button', { name: t.common.cancel }));
    const button = within(rules).getByRole('button', { name: t.customerDetail.addRule });
    expect(button).toHaveFocus();
    expect(db.tables.recurring_rules).toHaveLength(before);
    await userEvent.click(button);
    expect(within(rules).getByLabelText(t.customerDetail.ruleTemplate)).toHaveValue('');
  });

  it('adds a recurring rule and activates it', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const rules = await screen.findByRole('region', { name: t.customerDetail.rulesTitle });
    await userEvent.click(within(rules).getByRole('button', { name: t.customerDetail.addRule }));
    const form = within(rules).getByRole('form', { name: t.customerDetail.addRuleLabel });
    await userEvent.selectOptions(
      within(form).getByLabelText(t.customerDetail.ruleTemplate),
      template.id,
    );
    await userEvent.click(within(form).getByRole('button', { name: t.customerDetail.addRule }));
    const rule = db.tables.recurring_rules.find((row) => row.customer_id === ana.id);
    expect(rule).toMatchObject({ slot_template_id: template.id, active: true });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('activate_rule', { p_rule_id: rule?.id });
    expect(await within(rules).findByRole('listitem')).toHaveTextContent(
      fill(t.customerDetail.ruleLabel, {
        weekday: weekdayName(template.weekday),
        time: template.start_time.slice(0, 5),
      }),
    );
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(within(rules).getByRole('button', { name: t.customerDetail.addRule })).toHaveFocus();
  });

  it('stops an active rule through deactivate_rule and reports the cancelled count', async () => {
    db.tables.recurring_rules = [
      { id: 'r1', customer_id: ana.id, slot_template_id: template.id, active: true },
    ];
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    db.tables.appointments = [
      {
        id: 'inst-1',
        customer_id: ana.id,
        slot_template_id: template.id,
        rule_id: 'r1',
        starts_at: future,
        ends_at: future,
        status: 'booked',
      },
    ];
    renderAt(`/t/stranke/${ana.id}`);
    const rules = await screen.findByRole('region', { name: t.customerDetail.rulesTitle });
    const cancelled = db.tables.appointments.filter(
      (row) => row.rule_id === 'r1' && row.status === 'booked',
    ).length;
    await userEvent.click(within(rules).getByRole('button', { name: t.customerDetail.stopRule }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('deactivate_rule', { p_rule_id: 'r1' });
    expect(await within(rules).findByRole('status')).toHaveTextContent(
      fill(t.customerDetail.ruleStopped, { count: cancelled }),
    );
    expect(within(rules).getByRole('button', { name: t.customerDetail.restartRule })).toBeVisible();
    await userEvent.click(within(rules).getByRole('button', { name: t.customerDetail.addRule }));
    const addable = within(rules).getByLabelText(t.customerDetail.ruleTemplate);
    expect(within(addable).getAllByRole('option')).toHaveLength(1);
  });
});

describe('customer detail history pages', () => {
  const hour = 3_600_000;
  const tz = 'Europe/Ljubljana';
  const starts = Array.from(
    { length: PAGED_TOTAL },
    (_, index) => new Date(Date.now() - (index + 1) * 12 * hour - index * 60_000),
  );
  const recentLabels = starts.map((startsAt) =>
    fill(t.slot.when, { day: formatLongDay(startsAt, tz), time: formatTime(startsAt, tz) }),
  );
  const notes = starts.map((_, index) => `Vnos ${String(index).padStart(2, '0')}`);

  beforeEach(() => {
    db.tables.appointments = starts.map((startsAt, index) => ({
      id: `a-${index}`,
      customer_id: ana.id,
      slot_template_id: template.id,
      starts_at: startsAt.toISOString(),
      ends_at: startsAt.toISOString(),
      status: 'charged',
    }));
    db.tables.credit_transactions = starts.map((createdAt, index) => ({
      id: `t-${index}`,
      customer_id: ana.id,
      amount: -1,
      type: 'adjustment',
      note: notes[index],
      created_at: createdAt.toISOString(),
    }));
  });

  const lists = [
    {
      region: fill(t.customerDetail.recentTitle, { days: RECENT_DAYS }),
      table: 'appointments',
      expected: recentLabels,
    },
    { region: t.customerDetail.ledgerTitle, table: 'credit_transactions', expected: notes },
  ];

  it('has every fixture inside the recent window', () => {
    expect(Date.now() - starts[starts.length - 1].getTime()).toBeLessThan(RECENT_DAYS * 24 * hour);
  });

  it.each(lists)('shows $region a page at a time, newest first', async ({ region, expected }) => {
    renderAt(`/t/stranke/${ana.id}`);
    await expectEveryPage(await screen.findByRole('region', { name: region }), expected);
  });

  it.each(lists)('marks Pokaži več as loading in $region', async ({ region, table, expected }) => {
    renderAt(`/t/stranke/${ana.id}`);
    const section = await screen.findByRole('region', { name: region });
    await expectLoadingThenRows(section, table, expected);
  });

  it.each(lists)(
    'keeps the rows of $region when a page fails, and retries',
    async ({ region, table, expected }) => {
      renderAt(`/t/stranke/${ana.id}`);
      const section = await screen.findByRole('region', { name: region });
      await expectRetryAfterFailure(section, table, expected);
    },
  );

  it('starts the lists again from the newest after a refund reloads the page', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const region = lists[0].region;
    const section = await screen.findByRole('region', { name: region });
    await userEvent.click(within(section).getByRole('button', { name: t.common.showMore }));
    await waitFor(() =>
      expect(within(section).getAllByRole('listitem')).toHaveLength(PAGE_SIZE * 2),
    );
    await userEvent.click(
      within(section).getAllByRole('button', { name: t.customerDetail.refund })[0],
    );
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    const reloaded = await screen.findByRole('region', { name: region });
    await waitFor(() =>
      expect(within(reloaded).getAllByRole('listitem')[0]).toHaveTextContent(recentLabels[1]),
    );
    expect(within(reloaded).getAllByRole('listitem')).toHaveLength(PAGE_SIZE);
  });
});
