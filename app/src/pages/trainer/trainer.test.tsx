import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, formatAmount, t } from '../../i18n';
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

async function openAdHoc() {
  await userEvent.click(await screen.findByRole('button', { name: t.trainer.adHocFormTitle }));
  return screen.getByRole('form', { name: t.trainer.adHocFormTitle });
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
    const debtors = customers
      .filter((customer) => balances[customer.id as keyof typeof balances] < 0)
      .sort(
        (a, b) => balances[a.id as keyof typeof balances] - balances[b.id as keyof typeof balances],
      );
    const links = within(strip).getAllByRole('link');
    expect(links.map((link) => link.textContent?.split(' ')[0])).toEqual(
      debtors.map((customer) => customer.name),
    );
    expect(links[0]).toHaveAttribute('href', `/t/stranke/${debtors[0].id}`);
  });

  it('signs a debtor balance with the same minus as the ledger', async () => {
    renderAt('/t');
    const strip = await screen.findByRole('region', { name: t.trainer.debtorsTitle });
    const links = within(strip).getAllByRole('link');
    const debtors = customers.filter(
      (customer) => balances[customer.id as keyof typeof balances] < 0,
    );
    for (const customer of debtors) {
      const balance = balances[customer.id as keyof typeof balances];
      const link = links.find((item) => item.textContent?.startsWith(customer.name));
      expect(link).toHaveTextContent(formatAmount(balance));
    }
  });

  it("shows today's occurrence with its booked customers and remaining capacity", async () => {
    renderAt('/t');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const booked = db.tables.appointments.map((row) => row.customer_id);
    for (const customer of customers.filter((customer) => booked.includes(customer.id))) {
      expect(row).toHaveTextContent(customer.name);
    }
    const count = db.tables.slot_occupancy.reduce((sum, row) => sum + Number(row.booked_count), 0);
    expect(row).toHaveTextContent(
      fill(t.calendar.spots, {
        free: todayTemplate.capacity - count,
        capacity: todayTemplate.capacity,
      }),
    );
  });
});

describe('appointments outside the slot grid', () => {
  const retired = { ...todayTemplate, id: 'tpl-retired', start_time: '09:00:00', active: false };
  const retiredStart = occurrenceInWeek(retired, weekStart(today), tz)!.startsAt;

  beforeEach(() => {
    db.tables.slot_templates = [todayTemplate, retired];
    db.tables.appointments.push({
      id: 'a-orphan',
      customer_id: 'c-bor',
      slot_template_id: retired.id,
      starts_at: postgrestTime(retiredStart),
      ends_at: postgrestTime(new Date(retiredStart.getTime() + retired.duration_minutes * 60_000)),
      status: 'booked',
    });
  });

  function orphanRow(section: HTMLElement) {
    const name = customers.find((customer) => customer.id === 'c-bor')!.name;
    return within(section).getByText(name).closest('li') as HTMLElement;
  }

  it('shows a booking of a deactivated template on Today', async () => {
    renderAt('/t');
    const section = await screen.findByRole('region', { name: t.trainer.otherTitle });
    expect(orphanRow(section)).toHaveTextContent(t.trainer.offGridTag);
  });

  it('lets the trainer cancel it from the calendar', async () => {
    renderAt('/t/koledar');
    const section = await screen.findByRole('region', { name: t.trainer.otherTitle });
    await userEvent.click(within(orphanRow(section)).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'a-orphan' });
  });
});

describe('trainer calendar', () => {
  function holdBook() {
    let release = () => {};
    const original = fakeSupabase.rpc.getMockImplementation();
    fakeSupabase.rpc.mockImplementationOnce(
      (name: string, args: Record<string, unknown>) =>
        new Promise((resolve) => {
          release = () => resolve(original?.(name, args));
        }),
    );
    return () => release();
  }

  it('keeps Prekliči disabled while an ad-hoc appointment is being booked', async () => {
    renderAt('/t/koledar');
    const form = await openAdHoc();
    await userEvent.selectOptions(within(form).getByLabelText(t.trainer.customer), 'c-cvet');
    await userEvent.type(within(form).getByLabelText(t.trainer.start), '16:00');
    await userEvent.type(within(form).getByLabelText(t.trainer.end), '17:00');
    const release = holdBook();
    await userEvent.click(within(form).getByRole('button', { name: t.trainer.adHocSubmit }));
    expect(within(form).getByRole('button', { name: t.common.cancel })).toBeDisabled();
    release();
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

  it('keeps Prekliči disabled while a customer is being added to an occurrence', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.addCustomer }));
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'c-bor');
    const release = holdBook();
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.add }));
    expect(within(row).getByRole('button', { name: t.common.cancel })).toBeDisabled();
    release();
    await waitFor(() => expect(within(row).queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('shows one Dodaj stranko button per occurrence and no customer select', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row).getAllByRole('button', { name: t.trainer.addCustomer })).toHaveLength(1);
  });

  it('books the chosen customer into an occurrence and closes the add control', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.addCustomer }));
    const select = within(row).getByRole('combobox', {
      name: fill(t.trainer.addTo, { when: slotLabel(startsAt) }),
    });
    expect(select).toHaveFocus();
    expect(within(select).queryByRole('option', { name: 'Ana' })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'c-bor');
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.add }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: 'c-bor',
      p_starts_at: startsAt.toISOString(),
      p_slot_template_id: todayTemplate.id,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(t.trainer.added);
    await waitFor(() => expect(within(row).queryByRole('combobox')).not.toBeInTheDocument());
    expect(within(row).getByRole('button', { name: t.trainer.addCustomer })).toHaveFocus();
  });

  it('closes the add control on Prekliči and puts focus back on Dodaj stranko', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.addCustomer }));
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'c-bor');
    await userEvent.click(within(row).getByRole('button', { name: t.common.cancel }));
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    const button = within(row).getByRole('button', { name: t.trainer.addCustomer });
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(within(row).getByRole('combobox')).toHaveValue('');
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('book', expect.anything());
  });

  it('keeps one add control open at a time', async () => {
    const later = { ...todayTemplate, id: 'tpl-later', weekday: 3, start_time: '08:00:00' };
    const laterStart = occurrenceInWeek(later, weekStart(today), tz)!.startsAt;
    db.tables.slot_templates = [todayTemplate, later];
    renderAt('/t/koledar');
    const first = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const second = screen.getByRole('listitem', { name: slotLabel(laterStart) });
    await userEvent.click(within(first).getByRole('button', { name: t.trainer.addCustomer }));
    await userEvent.click(within(second).getByRole('button', { name: t.trainer.addCustomer }));
    expect(within(first).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(first).getByRole('button', { name: t.trainer.addCustomer })).toBeVisible();
    expect(within(second).getByRole('combobox')).toHaveFocus();
  });

  it('disables the add button with Polno when the occurrence is full', async () => {
    db.tables.slot_occupancy = [
      {
        slot_template_id: todayTemplate.id,
        starts_at: postgrestTime(startsAt),
        booked_count: todayTemplate.capacity,
      },
    ];
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).getByRole('button', { name: t.calendar.full })).toBeDisabled();
    expect(
      within(row).queryByRole('button', { name: t.trainer.addCustomer }),
    ).not.toBeInTheDocument();
  });

  it('closes the add control when the occurrence fills up before the booking lands', async () => {
    fakeSupabase.rpc.mockImplementationOnce(async () => {
      db.tables.slot_occupancy = [
        {
          slot_template_id: todayTemplate.id,
          starts_at: postgrestTime(startsAt),
          booked_count: todayTemplate.capacity,
        },
      ];
      return { data: null, error: { message: 'AMRAP_CAPACITY_FULL: no places left' } };
    });
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.addCustomer }));
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'c-bor');
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.add }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.AMRAP_CAPACITY_FULL);
    expect(await within(row).findByRole('button', { name: t.calendar.full })).toBeDisabled();
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it('disables the add button when every customer is already booked there', async () => {
    db.tables.slot_templates = [{ ...todayTemplate, capacity: customers.length + 1 }];
    db.tables.appointments = customers.map((customer) =>
      appointment(`a-${customer.id}`, customer.id, 'booked'),
    );
    db.tables.slot_occupancy = [
      {
        slot_template_id: todayTemplate.id,
        starts_at: postgrestTime(startsAt),
        booked_count: customers.length,
      },
    ];
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).getByRole('button', { name: t.trainer.noneToAdd })).toBeDisabled();
  });

  it('disables the add button while there are no customers at all', async () => {
    db.tables.customers = [];
    db.tables.appointments = [];
    db.tables.slot_occupancy = [];
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).getByRole('button', { name: t.trainer.noneToAdd })).toBeDisabled();
  });

  it('disables the add button with Zaprto when the occurrence is blocked', async () => {
    db.tables.blocked_periods = [
      {
        id: 'b-1',
        starts_at: postgrestTime(new Date(startsAt.getTime() - 3_600_000)),
        ends_at: postgrestTime(new Date(startsAt.getTime() + 3_600_000)),
        reason: null,
      },
    ];
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).getByRole('button', { name: t.calendar.blocked })).toBeDisabled();
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

  it('shows Nov termin po dogovoru as a button until it is pressed', async () => {
    renderAt('/t/koledar');
    const button = await screen.findByRole('button', { name: t.trainer.adHocFormTitle });
    expect(screen.queryByRole('form', { name: t.trainer.adHocFormTitle })).not.toBeInTheDocument();
    await userEvent.click(button);
    const form = screen.getByRole('form', { name: t.trainer.adHocFormTitle });
    expect(within(form).getByLabelText(t.trainer.customer)).toHaveFocus();
  });

  it('drops the ad-hoc input on Prekliči and puts focus back on the button', async () => {
    renderAt('/t/koledar');
    const form = await openAdHoc();
    await userEvent.type(within(form).getByLabelText(t.trainer.start), '16:00');
    await userEvent.click(within(form).getByRole('button', { name: t.common.cancel }));
    expect(form).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: t.trainer.adHocFormTitle });
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(screen.getByLabelText(t.trainer.start)).toHaveValue('');
  });

  it('creates an ad-hoc appointment in the gym timezone', async () => {
    renderAt('/t/koledar');
    const form = await openAdHoc();
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
    expect(await screen.findByRole('status')).toHaveTextContent(t.trainer.added);
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: t.trainer.adHocFormTitle })).toHaveFocus();
  });

  it('rejects an ad-hoc appointment that ends before it starts', async () => {
    renderAt('/t/koledar');
    const form = await openAdHoc();
    await userEvent.selectOptions(within(form).getByLabelText(t.trainer.customer), 'c-cvet');
    await userEvent.type(within(form).getByLabelText(t.trainer.start), '17:00');
    await userEvent.type(within(form).getByLabelText(t.trainer.end), '16:00');
    await userEvent.click(within(form).getByRole('button', { name: t.trainer.adHocSubmit }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.trainer.invalidRange);
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('book', expect.anything());
  });
});
