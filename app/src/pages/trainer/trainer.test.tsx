import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, t } from '../../i18n';
import {
  addDays,
  formatLongDay,
  formatTime,
  localDateOf,
  occurrenceInWeek,
  weekStart,
} from '../../lib/time';
import { routes } from '../../routes';
import {
  db,
  fakeSupabase,
  makeCustomer,
  makeSession,
  postgrestTime,
  resetFake,
} from '../../test/fakeSupabase';

vi.mock('../../lib/supabase', async () => ({
  supabase: (await import('../../test/fakeSupabase')).fakeSupabase,
}));

const trainer = makeCustomer({ id: 'trainer-1', role: 'trainer', auth_user_id: 'user-t' });
const now = new Date('2026-10-21T10:00:00Z');
const tz = 'Europe/Ljubljana';
const today = localDateOf(now, tz);
const todayTemplate = {
  id: 'tpl-today',
  weekday: 2,
  start_time: '18:00:00',
  duration_minutes: 60,
  capacity: 3,
  active: true,
};
const startsAt = occurrenceInWeek(todayTemplate, weekStart(today), tz)!.startsAt;
const customers = [
  makeCustomer({ id: 'c-ana', name: 'Ana', auth_user_id: 'u-ana' }),
  makeCustomer({ id: 'c-bor', name: 'Bor', auth_user_id: null }),
  makeCustomer({ id: 'c-cvet', name: 'Cvetka', auth_user_id: null }),
];
const balances = { 'c-ana': -3, 'c-bor': 4, 'c-cvet': -1 };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function appointment(id: string, customerId: string, status: string) {
  return {
    id,
    customer_id: customerId,
    slot_template_id: todayTemplate.id,
    starts_at: postgrestTime(startsAt),
    ends_at: postgrestTime(new Date(startsAt.getTime() + 3_600_000)),
    status,
  };
}

function slotLabel(instant: Date): string {
  return fill(t.slot.when, { day: formatLongDay(instant, tz), time: formatTime(instant, tz) });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  resetFake({ session: makeSession('user-t'), customer: trainer });
  db.tables.customers = customers;
  db.tables.customer_balances = Object.entries(balances).map(([id, balance]) => ({
    customer_id: id,
    balance,
  }));
  db.tables.slot_templates = [todayTemplate];
  db.tables.appointments = [appointment('a-ana', 'c-ana', 'booked')];
  db.tables.slot_occupancy = [
    { slot_template_id: todayTemplate.id, starts_at: postgrestTime(startsAt), booked_count: 1 },
  ];
});

afterEach(() => vi.useRealTimers());

describe('today', () => {
  it('lists the customers with a negative balance, most negative first', async () => {
    renderAt('/t');
    const strip = await screen.findByRole('region', { name: t.trainer.debtorsTitle });
    const expected = customers
      .filter((customer) => balances[customer.id as keyof typeof balances] < 0)
      .sort(
        (a, b) => balances[a.id as keyof typeof balances] - balances[b.id as keyof typeof balances],
      )
      .map((customer) => customer.name);
    const links = within(strip).getAllByRole('link');
    expect(links.map((link) => link.textContent?.split(' ')[0])).toEqual(expected);
    expect(links[0]).toHaveAttribute('href', `/t/stranke/${customers[0].id}`);
  });

  it("shows today's occurrence with its booked customers and remaining capacity", async () => {
    renderAt('/t');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(row).toHaveTextContent('Ana');
    expect(row).toHaveTextContent(
      fill(t.calendar.spots, {
        free: todayTemplate.capacity - 1,
        capacity: todayTemplate.capacity,
      }),
    );
  });
});

describe('trainer calendar', () => {
  it('books the chosen customer into an occurrence', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const select = within(row).getByRole('combobox');
    expect(within(select).queryByRole('option', { name: 'Ana' })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'c-bor');
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.add }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: 'c-bor',
      p_starts_at: startsAt.toISOString(),
      p_slot_template_id: todayTemplate.id,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(t.trainer.added);
  });

  it('warns that cancelling a charged appointment refunds the credit', async () => {
    db.tables.appointments = [appointment('a-ana', 'c-ana', 'charged')];
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    expect(dialog).toHaveTextContent(t.cancelDialog.refund);
    expect(dialog).toHaveTextContent('Ana');
    expect(dialog).not.toHaveTextContent(t.cancelDialog.late);
  });

  it('says a booked appointment is cancelled without charge', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    expect(dialog).toHaveTextContent(t.cancelDialog.noCharge);
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'a-ana' });
  });

  it('creates an ad-hoc appointment in the gym timezone', async () => {
    renderAt('/t/koledar');
    const form = await screen.findByRole('form', { name: t.trainer.adHocFormTitle });
    const date = addDays(weekStart(today), 3);
    await userEvent.selectOptions(within(form).getByLabelText(t.trainer.customer), 'c-cvet');
    await userEvent.clear(within(form).getByLabelText(t.trainer.date));
    await userEvent.type(within(form).getByLabelText(t.trainer.date), date);
    await userEvent.type(within(form).getByLabelText(t.trainer.start), '16:00');
    await userEvent.type(within(form).getByLabelText(t.trainer.end), '17:30');
    await userEvent.click(within(form).getByRole('button', { name: t.trainer.adHocSubmit }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: 'c-cvet',
      p_starts_at: new Date(`${date}T14:00:00Z`).toISOString(),
      p_ends_at: new Date(`${date}T15:30:00Z`).toISOString(),
    });
  });

  it('rejects an ad-hoc appointment that ends before it starts', async () => {
    renderAt('/t/koledar');
    const form = await screen.findByRole('form', { name: t.trainer.adHocFormTitle });
    await userEvent.selectOptions(within(form).getByLabelText(t.trainer.customer), 'c-cvet');
    await userEvent.type(within(form).getByLabelText(t.trainer.start), '17:00');
    await userEvent.type(within(form).getByLabelText(t.trainer.end), '16:00');
    await userEvent.click(within(form).getByRole('button', { name: t.trainer.adHocSubmit }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.trainer.invalidRange);
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('book', expect.anything());
  });
});
