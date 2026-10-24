import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, formatAmount, t } from '../../i18n';
import {
  addDays,
  formatLocalDate,
  formatLongDay,
  formatTime,
  localDateOf,
  occurrenceInWeek,
  weekdayHeading,
  weekdayOf,
  weekStart,
  zonedInstant,
  type LocalDate,
} from '../../lib/time';
import { CANCEL_REASON_MAX } from '../../data/appointments';
import { routes } from '../../routes';
import {
  db,
  fakeSupabase,
  holdTable,
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

type View = 'day' | 'week';

function showView(view: View) {
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: view === 'week' && query === '(min-width: 64rem)',
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function dayButtonName(date: LocalDate) {
  const part = (options: Intl.DateTimeFormatOptions) => formatLocalDate(date, options);
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })}`;
}

function dayButton(date: LocalDate) {
  return screen.getByRole('button', { name: dayButtonName(date) });
}

function dayColumnName(date: LocalDate) {
  const dayMonth = formatLocalDate(date, { day: 'numeric', month: 'numeric' });
  return `${weekdayHeading(weekdayOf(date))} ${dayMonth}`;
}

function dayColumn(date: LocalDate) {
  return screen.getByRole('region', { name: dayColumnName(date) });
}

function adHoc(id: string, customerId: string, from: Date, minutes = 60) {
  return {
    id,
    customer_id: customerId,
    slot_template_id: null,
    starts_at: postgrestTime(from),
    ends_at: postgrestTime(new Date(from.getTime() + minutes * 60_000)),
    status: 'booked',
  };
}

function otherLabel(from: Date, minutes: number): string {
  return fill(t.slot.when, {
    day: formatLongDay(from, tz),
    time: fill(t.trainer.timeRange, {
      from: formatTime(from, tz),
      to: formatTime(new Date(from.getTime() + minutes * 60_000), tz),
    }),
  });
}

const nameOf = (id: string) => customers.find((customer) => customer.id === id)!.name;

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

afterEach(() => {
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

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
  beforeEach(() => showView('day'));

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
  beforeEach(() => showView('day'));

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
    const later = { ...todayTemplate, id: 'tpl-later', start_time: '20:00:00' };
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

  it('offers an optional reason that phones do not autofill, as long as the database allows', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    const reason = within(dialog).getByLabelText(t.cancelDialog.reason);
    expect(reason).toHaveAttribute('autocomplete', 'off');
    expect(reason).toHaveAttribute('maxlength', String(CANCEL_REASON_MAX));
    expect(reason).toHaveValue('');
  });

  it('passes the trimmed reason to cancel', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    await userEvent.type(within(dialog).getByLabelText(t.cancelDialog.reason), '  Bolezen  ');
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', {
      p_appointment_id: 'a-ana',
      p_reason: 'Bolezen',
    });
  });

  it('sends no reason when the field holds only spaces', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    await userEvent.type(within(dialog).getByLabelText(t.cancelDialog.reason), '   ');
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

  it('closes the ad-hoc form when the week changes', async () => {
    renderAt('/t/koledar');
    const form = await openAdHoc();
    const next = screen.getByRole('button', { name: t.calendar.nextWeek });
    await userEvent.click(next);
    expect(form).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: t.trainer.adHocFormTitle })).toBeEnabled();
    expect(next).toHaveFocus();
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

describe('trainer calendar day view', () => {
  const monday = weekStart(today);
  const thursday = { ...todayTemplate, id: 'tpl-thu', weekday: 3, start_time: '08:00:00' };
  const thursdayStart = occurrenceInWeek(thursday, monday, tz)!.startsAt;

  beforeEach(() => {
    showView('day');
    db.tables.slot_templates = [todayTemplate, thursday];
  });

  it('shows the seven days of the week as buttons, Monday first, named by their visible text', async () => {
    renderAt('/t/koledar');
    const strip = await screen.findByRole('group', { name: t.trainer.days });
    const buttons = within(strip).getAllByRole('button');
    const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(monday, offset));
    expect(buttons).toHaveLength(days.length);
    days.forEach((date, index) => {
      expect(buttons[index]).toHaveAccessibleName(dayButtonName(date));
      expect(buttons[index]).not.toHaveAttribute('aria-label');
    });
  });

  it('selects today by default when today is in the shown week and marks it as today', async () => {
    renderAt('/t/koledar');
    await screen.findByRole('group', { name: t.trainer.days });
    expect(dayButton(today)).toHaveAttribute('aria-pressed', 'true');
    expect(dayButton(today)).toHaveAttribute('aria-current', 'date');
    expect(dayButton(monday)).toHaveAttribute('aria-pressed', 'false');
    expect(dayButton(monday)).not.toHaveAttribute('aria-current');
  });

  it("shows only the selected day's occurrences", async () => {
    renderAt('/t/koledar');
    expect(await screen.findByRole('listitem', { name: slotLabel(startsAt) })).toBeInTheDocument();
    expect(
      screen.queryByRole('listitem', { name: slotLabel(thursdayStart) }),
    ).not.toBeInTheDocument();
  });

  it('keeps a pressed day in the URL without adding a history entry', async () => {
    const router = renderAt('/t/koledar');
    await screen.findByRole('group', { name: t.trainer.days });
    await userEvent.click(dayButton(addDays(monday, 3)));
    expect(router.state.location.search).toBe(`?dan=${addDays(monday, 3)}`);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(dayButton(addDays(monday, 3))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('listitem', { name: slotLabel(thursdayStart) })).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: slotLabel(startsAt) })).not.toBeInTheDocument();
  });

  it('changes the day in the shown week without reloading it or losing focus', async () => {
    renderAt('/t/koledar');
    await screen.findByRole('group', { name: t.trainer.days });
    const reads = () =>
      fakeSupabase.from.mock.calls.filter(([table]) => table === 'slot_templates').length;
    const before = reads();
    await userEvent.click(dayButton(addDays(monday, 3)));
    expect(screen.queryByText(t.common.loading)).not.toBeInTheDocument();
    expect(dayButton(addDays(monday, 3))).toHaveFocus();
    await userEvent.click(dayButton(addDays(monday, 4)));
    expect(dayButton(addDays(monday, 4))).toHaveFocus();
    expect(reads()).toBe(before);
  });

  it('keeps the week arrows disabled until the first week has loaded', async () => {
    const release = holdTable('slot_templates');
    renderAt('/t/koledar');
    expect(await screen.findByRole('button', { name: t.calendar.nextWeek })).toBeDisabled();
    expect(screen.getByRole('button', { name: t.calendar.previousWeek })).toBeDisabled();
    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t.calendar.nextWeek })).toBeEnabled(),
    );
  });

  it('ignores › past the last week of 2099', async () => {
    const router = renderAt('/t/koledar?dan=2099-12-28');
    await screen.findByRole('group', { name: t.trainer.days });
    await userEvent.click(screen.getByRole('button', { name: t.calendar.nextWeek }));
    expect(router.state.location.search).toBe('?dan=2099-12-28');
  });

  it('keeps the arrows disabled until the first week has loaded, also with a day in the URL', async () => {
    const release = holdTable('slot_templates');
    renderAt(`/t/koledar?dan=${addDays(monday, -7)}`);
    expect(await screen.findByRole('button', { name: t.calendar.nextWeek })).toBeDisabled();
    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t.calendar.nextWeek })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: t.calendar.nextWeek }));
    await waitFor(() => expect(dayButton(today)).toHaveAttribute('aria-pressed', 'true'));
  });

  it('keeps the day strip while the next week loads', async () => {
    renderAt(`/t/koledar?dan=${today}`);
    await screen.findByRole('group', { name: t.trainer.days });
    const release = holdTable('slot_templates');
    await userEvent.click(screen.getByRole('button', { name: t.calendar.nextWeek }));
    expect(screen.getByText(t.common.loading)).toBeInTheDocument();
    expect(dayButton(addDays(monday, 7))).toHaveAttribute('aria-pressed', 'true');
    release();
    await waitFor(() => expect(screen.queryByText(t.common.loading)).not.toBeInTheDocument());
  });

  it('defaults the ad-hoc date to the selected day', async () => {
    const thursday = addDays(monday, 3);
    renderAt(`/t/koledar?dan=${thursday}`);
    const form = await openAdHoc();
    expect(within(form).getByLabelText(t.trainer.date)).toHaveValue(thursday);
  });

  it('opens the day and the week named in the URL', async () => {
    const day = addDays(monday, 10);
    renderAt(`/t/koledar?dan=${day}`);
    await screen.findByRole('group', { name: t.trainer.days });
    expect(dayButton(day)).toHaveAttribute('aria-pressed', 'true');
    expect(dayButton(addDays(monday, 7))).toBeInTheDocument();
    expect(screen.queryByRole('button', { current: 'date' })).not.toBeInTheDocument();
    const nextThursday = occurrenceInWeek(thursday, addDays(monday, 7), tz)!.startsAt;
    expect(screen.getByRole('listitem', { name: slotLabel(nextThursday) })).toBeInTheDocument();
  });

  it('falls back to today for a day in the URL that does not exist', async () => {
    renderAt('/t/koledar?dan=2026-02-30');
    await screen.findByRole('group', { name: t.trainer.days });
    expect(dayButton(today)).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects Monday in another week and today again back in this week', async () => {
    const router = renderAt('/t/koledar');
    await screen.findByRole('group', { name: t.trainer.days });
    await userEvent.click(screen.getByRole('button', { name: t.calendar.nextWeek }));
    expect(await screen.findByRole('button', { pressed: true })).toHaveAccessibleName(
      dayButtonName(addDays(monday, 7)),
    );
    expect(router.state.location.search).toBe(`?dan=${addDays(monday, 7)}`);
    expect(router.state.historyAction).toBe('REPLACE');
    await userEvent.click(screen.getByRole('button', { name: t.calendar.previousWeek }));
    await waitFor(() => expect(dayButton(today)).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(screen.getByRole('button', { name: t.calendar.previousWeek }));
    await waitFor(() =>
      expect(dayButton(addDays(monday, -7))).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('keeps the day when the trainer comes back to the calendar', async () => {
    const router = renderAt('/t/koledar');
    await screen.findByRole('group', { name: t.trainer.days });
    await userEvent.click(dayButton(addDays(monday, 3)));
    await userEvent.click(screen.getByRole('link', { name: t.nav.customers }));
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('group', { name: t.trainer.days })).toBeInTheDocument();
    expect(dayButton(addDays(monday, 3))).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an empty state on a day without occurrences', async () => {
    renderAt('/t/koledar');
    await screen.findByRole('group', { name: t.trainer.days });
    await userEvent.click(dayButton(monday));
    expect(screen.getByText(t.trainer.noSlotsOnDay)).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: /ob/ })).not.toBeInTheDocument();
  });

  it("lists only the selected day's appointments outside the slot grid", async () => {
    db.tables.appointments.push(
      adHoc('a-wed', 'c-bor', zonedInstant(today, '12:00', tz)!),
      adHoc('a-thu', 'c-cvet', zonedInstant(addDays(monday, 3), '12:00', tz)!),
    );
    renderAt('/t/koledar');
    const other = await screen.findByRole('region', { name: t.trainer.otherTitle });
    expect(other).toHaveTextContent(nameOf('c-bor'));
    expect(other).not.toHaveTextContent(nameOf('c-cvet'));
  });

  it('hides the outside-the-grid section on a day without such appointments', async () => {
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(screen.queryByRole('region', { name: t.trainer.otherTitle })).not.toBeInTheDocument();
  });
});

describe('trainer calendar week grid', () => {
  const monday = weekStart(today);
  const early = { ...todayTemplate, id: 'tpl-early', start_time: '07:00:00' };
  const thursday = { ...todayTemplate, id: 'tpl-thu', weekday: 3, start_time: '08:00:00' };

  beforeEach(() => {
    showView('week');
    db.tables.slot_templates = [todayTemplate, thursday, early];
  });

  it('shows seven day columns in order and no day buttons', async () => {
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => dayColumn(addDays(monday, offset)));
    const regions = screen.getAllByRole('region');
    expect(days.map((day) => regions.indexOf(day))).toEqual(
      [...days.map((day) => regions.indexOf(day))].sort((a, b) => a - b),
    );
    expect(screen.queryByRole('group', { name: t.trainer.days })).not.toBeInTheDocument();
  });

  it("puts each occurrence in its day's column in time order", async () => {
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const expected = (date: LocalDate) =>
      db.tables.slot_templates
        .map((template) => occurrenceInWeek(template as typeof todayTemplate, monday, tz)!)
        .filter((occurrence) => occurrence.date === date)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((occurrence) => slotLabel(occurrence.startsAt));
    for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
      const date = addDays(monday, offset);
      const cards = within(dayColumn(date)).queryAllByRole('listitem', { name: /ob/ });
      expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(expected(date));
    }
  });

  it("puts an appointment outside the slot grid into its day's column, tagged, by time", async () => {
    const thursdayDate = addDays(monday, 3);
    const from = zonedInstant(thursdayDate, '06:00', tz)!;
    db.tables.appointments.push(adHoc('a-thu', 'c-cvet', from));
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const column = dayColumn(thursdayDate);
    const card = within(column).getByRole('listitem', { name: otherLabel(from, 60) });
    expect(card).toHaveTextContent(nameOf('c-cvet'));
    expect(card).toHaveTextContent(t.trainer.adHocTag);
    const thursdayStart = occurrenceInWeek(thursday, monday, tz)!.startsAt;
    const slot = within(column).getByRole('listitem', { name: slotLabel(thursdayStart) });
    expect(card.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('region', { name: t.trainer.otherTitle })).not.toBeInTheDocument();
  });

  it("marks today's column", async () => {
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(dayColumn(today)).getByText(t.trainer.todayTag)).toBeInTheDocument();
    expect(within(dayColumn(monday)).queryByText(t.trainer.todayTag)).not.toBeInTheDocument();
  });

  it('shows the week of the day in the URL', async () => {
    renderAt(`/t/koledar?dan=${addDays(monday, 9)}`);
    expect(
      await screen.findByRole('region', { name: dayColumnName(addDays(monday, 7)) }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t.trainer.todayTag)).not.toBeInTheDocument();
  });
});

describe.each<View>(['day', 'week'])('trainer calendar actions in the %s view', (view) => {
  beforeEach(() => showView(view));

  it('adds a customer to an occurrence', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.addCustomer }));
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'c-bor');
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.add }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: 'c-bor',
      p_starts_at: startsAt.toISOString(),
      p_slot_template_id: todayTemplate.id,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(t.trainer.added);
  });

  it('keeps one add control open at a time', async () => {
    const later = { ...todayTemplate, id: 'tpl-later', start_time: '20:00:00' };
    const laterStart = occurrenceInWeek(later, weekStart(today), tz)!.startsAt;
    db.tables.slot_templates = [todayTemplate, later];
    renderAt('/t/koledar');
    const first = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const second = screen.getByRole('listitem', { name: slotLabel(laterStart) });
    await userEvent.click(within(first).getByRole('button', { name: t.trainer.addCustomer }));
    await userEvent.click(within(second).getByRole('button', { name: t.trainer.addCustomer }));
    expect(within(first).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(second).getByRole('combobox')).toHaveFocus();
  });

  it('disables the add button with Polno on a full occurrence', async () => {
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
  });

  it('cancels a booked customer through the cancel dialog', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'a-ana' });
    expect(await screen.findByRole('status')).toHaveTextContent(t.cancelDialog.done);
  });

  it('cancels an appointment outside the slot grid', async () => {
    db.tables.appointments.push(adHoc('a-adhoc', 'c-cvet', zonedInstant(today, '12:00', tz)!));
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const card = screen.getByText(nameOf('c-cvet')).closest('li') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: t.slot.cancel }));
    const dialog = await screen.findByRole('dialog', { name: t.cancelDialog.title });
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'a-adhoc' });
  });
});

describe.each<View>(['day', 'week'])('cancelling a whole occurrence in the %s view', (view) => {
  beforeEach(() => {
    showView(view);
    db.tables.appointments = [
      appointment('a-ana', 'c-ana', 'booked'),
      appointment('a-bor', 'c-bor', 'charged'),
    ];
    db.tables.slot_occupancy = [
      { slot_template_id: todayTemplate.id, starts_at: postgrestTime(startsAt), booked_count: 2 },
    ];
  });

  async function openOccurrenceDialog() {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.cancelOccurrence }));
    return screen.findByRole('dialog', { name: t.occurrenceDialog.title });
  }

  it('offers Odpovej termin on an open occurrence, apart from the customer cancels', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const action = within(row).getByRole('button', { name: t.trainer.cancelOccurrence });
    expect(action).toBeEnabled();
    expect(action).toHaveClass('quiet');
    expect(action).not.toHaveClass('danger', 'secondary');
    expect(within(row).getAllByRole('button', { name: t.slot.cancel })).toHaveLength(2);
  });

  it('offers no Odpovej termin on a closed occurrence', async () => {
    db.tables.blocked_periods = [
      {
        id: 'b-1',
        starts_at: postgrestTime(startsAt),
        ends_at: postgrestTime(new Date(startsAt.getTime() + 3_600_000)),
        reason: null,
      },
    ];
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).getByRole('button', { name: t.calendar.blocked })).toBeDisabled();
    expect(within(row).queryByRole('button', { name: t.trainer.cancelOccurrence })).toBeNull();
  });

  it('names the occurrence and who is booked, the refund, the notice and how to reopen', async () => {
    const dialog = await openOccurrenceDialog();
    expect(dialog).toHaveTextContent(slotLabel(startsAt));
    expect(dialog).toHaveTextContent(fill(t.occurrenceDialog.booked, { count: 2 }));
    const names = within(dialog).getAllByRole('listitem');
    expect(names.map((item) => item.textContent)).toEqual(['Ana', `Bor${t.trainer.chargedTag}`]);
    expect(dialog).toHaveTextContent(t.occurrenceDialog.refund);
    expect(dialog).toHaveTextContent(t.occurrenceDialog.notify);
    expect(dialog).toHaveTextContent(t.occurrenceDialog.reopen);
    expect(within(dialog).getByLabelText(t.cancelDialog.reason)).toHaveAttribute(
      'maxlength',
      String(CANCEL_REASON_MAX),
    );
    expect(within(dialog).getByRole('button', { name: t.occurrenceDialog.confirm })).toHaveClass(
      'danger',
    );
  });

  it('warns that bookings of an overlapping slot stay booked', async () => {
    const overlapping = { ...todayTemplate, id: 'tpl-overlap', start_time: '18:30:00' };
    const overlapStart = occurrenceInWeek(overlapping, weekStart(today), tz)!.startsAt;
    db.tables.slot_templates = [todayTemplate, overlapping];
    db.tables.appointments.push({
      ...appointment('a-cvet', 'c-cvet', 'booked'),
      slot_template_id: overlapping.id,
      starts_at: postgrestTime(overlapStart),
      ends_at: postgrestTime(new Date(overlapStart.getTime() + 3_600_000)),
    });
    const dialog = await openOccurrenceDialog();
    expect(
      await within(dialog).findByText(fill(t.occurrenceDialog.overlapping, { count: 1 })),
    ).toBeVisible();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
  });

  it('does not warn when nothing else overlaps the occurrence', async () => {
    const dialog = await openOccurrenceDialog();
    await waitFor(() => expect(fakeSupabase.from).toHaveBeenLastCalledWith('appointments'));
    expect(dialog).not.toHaveTextContent(
      fill(t.occurrenceDialog.overlapping, { count: 0 }).split('0')[0],
    );
  });

  it('leaves out the refund line when nobody was charged', async () => {
    db.tables.appointments = [appointment('a-ana', 'c-ana', 'booked')];
    const dialog = await openOccurrenceDialog();
    expect(dialog).toHaveTextContent(fill(t.occurrenceDialog.booked, { count: 1 }));
    expect(dialog).not.toHaveTextContent(t.occurrenceDialog.refund);
  });

  it('cancels with the trimmed reason, says how many were told and shows the occurrence as Zaprto', async () => {
    const dialog = await openOccurrenceDialog();
    await userEvent.type(within(dialog).getByLabelText(t.cancelDialog.reason), ' Bolezen ');
    await userEvent.click(within(dialog).getByRole('button', { name: t.occurrenceDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel_occurrence', {
      p_template_id: todayTemplate.id,
      p_starts_at: startsAt.toISOString(),
      p_reason: 'Bolezen',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      fill(t.occurrenceDialog.done, { count: 2 }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await waitFor(() =>
      expect(within(row).getByRole('button', { name: t.calendar.blocked })).toBeDisabled(),
    );
    expect(within(row).queryByRole('button', { name: t.trainer.cancelOccurrence })).toBeNull();
    expect(within(row).queryByRole('button', { name: t.slot.cancel })).toBeNull();
    expect(row).toHaveFocus();
  });

  it('sends no reason when none was typed', async () => {
    const dialog = await openOccurrenceDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: t.occurrenceDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel_occurrence', {
      p_template_id: todayTemplate.id,
      p_starts_at: startsAt.toISOString(),
    });
  });

  it('closes an empty occurrence and says so without a count', async () => {
    db.tables.appointments = [];
    db.tables.slot_occupancy = [];
    const dialog = await openOccurrenceDialog();
    expect(dialog).toHaveTextContent(t.trainer.nobodyBooked);
    expect(within(dialog).queryByRole('listitem')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: t.occurrenceDialog.confirm }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.occurrenceDialog.doneEmpty);
  });

  it('shows the server error in the dialog and disables the confirm button', async () => {
    db.tables.blocked_periods = [];
    const original = fakeSupabase.rpc.getMockImplementation();
    fakeSupabase.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) =>
      name === 'cancel_occurrence'
        ? { data: null, error: { message: 'AMRAP_BLOCKED: already closed' } }
        : original?.(name, args),
    );
    const dialog = await openOccurrenceDialog();
    const confirm = within(dialog).getByRole('button', { name: t.occurrenceDialog.confirm });
    await userEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t.errors.AMRAP_BLOCKED);
    expect(confirm).toBeDisabled();
  });

  it('closes on Escape and puts focus back on Odpovej termin', async () => {
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    const action = within(row).getByRole('button', { name: t.trainer.cancelOccurrence });
    await userEvent.click(action);
    await screen.findByRole('dialog', { name: t.occurrenceDialog.title });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action).toHaveFocus();
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('cancel_occurrence', expect.anything());
  });
});

describe('trainer calendar across the autumn DST change', () => {
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const saturday = addDays(monday, 5);
  const sundayTemplate = { ...todayTemplate, id: 'tpl-sun', weekday: 6, start_time: '10:00:00' };
  const sundayStart = occurrenceInWeek(sundayTemplate, monday, tz)!.startsAt;
  const nightStart = zonedInstant(sunday, '00:30', tz)!;

  beforeEach(() => {
    db.tables.slot_templates = [todayTemplate, sundayTemplate];
    db.tables.appointments.push(adHoc('a-night', 'c-bor', nightStart));
  });

  it('is the week with the change, with the night appointment before UTC midnight', () => {
    expect(sundayStart.toISOString()).toBe(`${sunday}T09:00:00.000Z`);
    expect(nightStart.toISOString()).toBe(`${saturday}T22:30:00.000Z`);
  });

  it('puts both on Sunday in the day view', async () => {
    showView('day');
    renderAt(`/t/koledar?dan=${sunday}`);
    expect(
      await screen.findByRole('listitem', { name: slotLabel(sundayStart) }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: t.trainer.otherTitle })).toHaveTextContent(
      nameOf('c-bor'),
    );
    await userEvent.click(dayButton(saturday));
    expect(screen.getByText(t.trainer.noSlotsOnDay)).toBeInTheDocument();
  });

  it('puts both in the Sunday column of the week grid', async () => {
    showView('week');
    renderAt('/t/koledar');
    await screen.findByRole('listitem', { name: slotLabel(sundayStart) });
    const column = dayColumn(sunday);
    expect(
      within(column).getByRole('listitem', { name: slotLabel(sundayStart) }),
    ).toBeInTheDocument();
    expect(within(column).getByText(nameOf('c-bor'))).toBeInTheDocument();
    expect(within(dayColumn(saturday)).queryByText(nameOf('c-bor'))).not.toBeInTheDocument();
  });
});

describe('trainer calendar when the window crosses 1024 px', () => {
  let wide = false;
  const listeners = new Set<() => void>();

  beforeEach(() => {
    wide = false;
    listeners.clear();
    window.matchMedia = vi.fn(
      (query: string) =>
        ({
          matches: query === '(min-width: 64rem)' && wide,
          addEventListener: (_: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        }) as unknown as MediaQueryList,
    );
  });

  function resize(toWide: boolean) {
    act(() => {
      wide = toWide;
      listeners.forEach((listener) => listener());
    });
  }

  it.each([
    ['day view to week grid', false],
    ['week grid to day view', true],
  ])('closes an open add control when it switches from the %s', async (_, startWide) => {
    wide = startWide;
    renderAt('/t/koledar');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.trainer.addCustomer }));
    expect(within(row).getByRole('combobox')).toHaveFocus();
    resize(!startWide);
    const moved = screen.getByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(moved).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(moved).getByRole('button', { name: t.trainer.addCustomer })).toBeVisible();
  });
});
