import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, t } from '../../i18n';
import { weekdayName } from '../../lib/time';
import { routes } from '../../routes';
import { RECENT_DAYS } from './CustomerDetail';
import { db, fakeSupabase, makeCustomer, makeSession, resetFake } from '../../test/fakeSupabase';

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
  it('lists customers by name with invite status and balance, negative in red', async () => {
    renderAt('/t/stranke');
    const list = await screen.findByRole('region', { name: t.customers.listTitle });
    const items = within(list).getAllByRole('listitem');
    const expected = [ana, bor, cvet];
    expect(items.map((item) => within(item).getByRole('link').textContent)).toEqual(
      expected.map((row) => row.name),
    );
    expect(items[0]).toHaveTextContent(t.customers.inviteStatus.linked);
    expect(items[1]).toHaveTextContent(t.customers.inviteStatus.pending);
    expect(items[2]).toHaveTextContent(t.customers.inviteStatus.none);
    const borBalance = db.tables.customer_balances.find((row) => row.customer_id === bor.id);
    expect(within(items[1]).getByText(String(borBalance?.balance))).toHaveClass('negative');
  });

  it('creates a customer and opens the detail page', async () => {
    const router = renderAt('/t/stranke');
    const form = await screen.findByRole('form', { name: t.customers.newTitle });
    await userEvent.type(within(form).getByLabelText(t.customers.name), 'Dora');
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    const created = db.tables.customers.find((row) => row.name === 'Dora');
    expect(created).toMatchObject({ phone: null, email: null });
    expect(await screen.findByRole('heading', { name: 'Dora' })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/t/stranke/${created?.id}`);
  });

  it('requires a name', async () => {
    renderAt('/t/stranke');
    const form = await screen.findByRole('form', { name: t.customers.newTitle });
    await userEvent.click(within(form).getByRole('button', { name: t.customers.create }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.customers.nameRequired);
  });
});

describe('customer detail', () => {
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

  it('lists recently charged appointments and offers a refunding cancel', async () => {
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
    await userEvent.click(within(recent).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    expect(dialog).toHaveTextContent(t.cancelDialog.refund);
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'recent' });
  });

  it('adds a recurring rule and activates it', async () => {
    renderAt(`/t/stranke/${ana.id}`);
    const rules = await screen.findByRole('region', { name: t.customerDetail.rulesTitle });
    await userEvent.selectOptions(
      within(rules).getByLabelText(t.customerDetail.addRuleLabel),
      template.id,
    );
    await userEvent.click(within(rules).getByRole('button', { name: t.customerDetail.addRule }));
    const rule = db.tables.recurring_rules.find((row) => row.customer_id === ana.id);
    expect(rule).toMatchObject({ slot_template_id: template.id, active: true });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('activate_rule', { p_rule_id: rule?.id });
    expect(await within(rules).findByRole('listitem')).toHaveTextContent(
      fill(t.customerDetail.ruleLabel, {
        weekday: weekdayName(template.weekday),
        time: template.start_time.slice(0, 5),
      }),
    );
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
    const addable = within(rules).getByLabelText(t.customerDetail.addRuleLabel);
    expect(within(addable).getAllByRole('option')).toHaveLength(1);
  });
});
