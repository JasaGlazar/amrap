import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorMessages, fill, formatAmount, formatBalance, formatTimeUntil, t } from '../../i18n';
import {
  cutoffOf,
  formatDate,
  formatDay,
  formatLongDay,
  formatTime,
  occurrenceInWeek,
  timeUntil,
  weekStart,
  localDateOf,
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

const me = makeCustomer({ id: 'customer-1', role: 'customer', auth_user_id: 'user-c' });
const now = new Date('2026-10-21T10:00:00Z');
const tz = 'Europe/Ljubljana';
const monday = weekStart(localDateOf(now, tz));

type Template = {
  id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  active: boolean;
};

function template(id: string, weekday: number, start: string, capacity: number, minutes = 60) {
  return {
    id,
    weekday,
    start_time: start,
    duration_minutes: minutes,
    capacity,
    active: true,
  };
}

function startOf(row: Template, weekOffsetDays = 0): Date {
  const start = new Date(`${monday}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + weekOffsetDays);
  const occurrence = occurrenceInWeek(row, start.toISOString().slice(0, 10), tz);
  if (occurrence === null) throw new Error('fixture occurrence does not exist');
  return occurrence.startsAt;
}

function slotLabel(startsAt: Date): string {
  return fill(t.slot.when, { day: formatLongDay(startsAt, tz), time: formatTime(startsAt, tz) });
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  resetFake({ session: makeSession('user-c'), customer: me });
});

afterEach(() => vi.useRealTimers());

describe('calendar', () => {
  const free = template('t-free', 3, '18:00:00', 5);
  const empty = template('t-empty', 6, '10:00:00', 4);
  const full = template('t-full', 4, '07:00:00', 2);
  const past = template('t-past', 0, '07:00:00', 5);
  const blocked = template('t-blocked', 5, '09:00:00', 5, 90);

  beforeEach(() => {
    db.tables.slot_templates = [free, empty, full, past, blocked];
    db.tables.slot_occupancy = [
      { slot_template_id: free.id, starts_at: postgrestTime(startOf(free)), booked_count: 2 },
      { slot_template_id: full.id, starts_at: startOf(full).toISOString(), booked_count: 2 },
    ];
    const blockStart = new Date(startOf(blocked).getTime() + 60 * 60_000);
    db.tables.blocked_periods = [
      {
        starts_at: blockStart.toISOString(),
        ends_at: new Date(blockStart.getTime() + 3 * 3_600_000).toISOString(),
        reason: 'closed',
      },
    ];
  });

  function slotRow(row: Template) {
    return screen.findByRole('listitem', { name: slotLabel(startOf(row)) });
  }

  function remaining(row: Template): string {
    const booked = db.tables.slot_occupancy
      .filter((occupancy) => occupancy.slot_template_id === row.id)
      .reduce((sum, occupancy) => sum + Number(occupancy.booked_count), 0);
    return fill(t.calendar.spots, { free: row.capacity - booked, capacity: row.capacity });
  }

  it('shows remaining capacity from slot_occupancy, full capacity when nobody booked', async () => {
    renderAt('/c/koledar');
    for (const row of [free, empty, full]) {
      expect(await slotRow(row)).toHaveTextContent(remaining(row));
    }
  });

  it('enables booking only for a free, future, unblocked slot', async () => {
    renderAt('/c/koledar');
    const button = async (row: Template) => within(await slotRow(row)).getByRole('button');
    expect(await button(free)).toBeEnabled();
    expect(await button(empty)).toBeEnabled();
    expect(await button(full)).toBeDisabled();
    expect(await button(full)).toHaveTextContent(t.calendar.full);
    expect(await button(past)).toBeDisabled();
    expect(await button(blocked)).toBeDisabled();
    expect(await slotRow(blocked)).toHaveTextContent(t.calendar.blocked);
  });

  it('books a slot with its exact start and marks it as mine', async () => {
    renderAt('/c/koledar');
    await userEvent.click(
      within(await slotRow(free)).getByRole('button', { name: t.calendar.book }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(t.calendar.booked);
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: me.id,
      p_starts_at: startOf(free).toISOString(),
      p_slot_template_id: free.id,
    });
    const row = await slotRow(free);
    await waitFor(() => expect(row).toHaveTextContent(t.calendar.mine));
    expect(within(row).getByRole('button', { name: t.slot.cancel })).toBeEnabled();
  });

  it('shows the server error when booking is rejected', async () => {
    renderAt('/c/koledar');
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_CAPACITY_FULL: slot is full (5 of 5)' },
    });
    await userEvent.click(
      within(await slotRow(free)).getByRole('button', { name: t.calendar.book }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessages.AMRAP_CAPACITY_FULL);
  });

  it('disables an occurrence late on Sunday that runs into a block after the week ends', async () => {
    const lateSunday = template('t-late', 6, '23:00:00', 5, 120);
    db.tables.slot_templates = [lateSunday];
    const blockStart = new Date(startOf(lateSunday).getTime() + 90 * 60_000);
    db.tables.blocked_periods = [
      {
        starts_at: blockStart.toISOString(),
        ends_at: new Date(blockStart.getTime() + 3_600_000).toISOString(),
        reason: 'after the week',
      },
    ];
    renderAt('/c/koledar');
    expect(within(await slotRow(lateSunday)).getByRole('button')).toBeDisabled();
  });

  it('moves to the next week and back', async () => {
    renderAt('/c/koledar');
    await slotRow(free);
    expect(screen.getByRole('button', { name: t.calendar.previousWeek })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: t.calendar.nextWeek }));
    const nextWeek = startOf(free, 7);
    expect(await screen.findByRole('listitem', { name: slotLabel(nextWeek) })).toHaveTextContent(
      fill(t.calendar.spots, { free: free.capacity, capacity: free.capacity }),
    );
    await userEvent.click(screen.getByRole('button', { name: t.calendar.previousWeek }));
    expect(await slotRow(free)).toBeInTheDocument();
  });
});

describe('cancel dialog', () => {
  const lateCancelHours = 5;
  const startsAt = new Date('2026-10-23T16:00:00Z');
  const cutoff = cutoffOf(startsAt, lateCancelHours);

  beforeEach(() => {
    db.settings.late_cancel_hours = lateCancelHours;
    db.tables.appointments = [
      {
        id: 'a1',
        customer_id: me.id,
        slot_template_id: null,
        starts_at: postgrestTime(startsAt),
        ends_at: postgrestTime(new Date(startsAt.getTime() + 3_600_000)),
        status: 'booked',
      },
    ];
  });

  async function openDialog() {
    renderAt('/c');
    const row = await screen.findByRole('listitem', { name: slotLabel(startsAt) });
    await userEvent.click(within(row).getByRole('button', { name: t.slot.cancel }));
    return screen.findByRole('dialog', { name: t.cancelDialog.title });
  }

  it('shows the cutoff and says the cancel is free one minute before it', async () => {
    vi.setSystemTime(new Date(cutoff.getTime() - 60_000));
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(
      fill(t.cancelDialog.cutoff, { day: formatDay(cutoff, tz), time: formatTime(cutoff, tz) }),
    );
    expect(dialog).toHaveTextContent(t.cancelDialog.free);
    expect(dialog).not.toHaveTextContent(t.cancelDialog.late);
  });

  it('says the cancel is charged one minute after the cutoff', async () => {
    vi.setSystemTime(new Date(cutoff.getTime() + 60_000));
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(t.cancelDialog.late);
    expect(dialog).not.toHaveTextContent(t.cancelDialog.free);
  });

  it('cancels, says so and removes the appointment from the upcoming list', async () => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'a1' });
    expect(await screen.findByRole('status')).toHaveTextContent(t.cancelDialog.done);
    expect(await screen.findByText(t.customer.noUpcoming)).toBeInTheDocument();
  });

  it('switches to the late copy instead of cancelling when the cutoff passed while open', async () => {
    vi.setSystemTime(new Date(cutoff.getTime() - 60_000));
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(t.cancelDialog.free);
    vi.setSystemTime(new Date(cutoff.getTime() + 60_000));
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(dialog).toHaveTextContent(t.cancelDialog.late);
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('cancel', expect.anything());
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('cancel', { p_appointment_id: 'a1' });
  });

  it('takes focus when it opens and closes on Escape', async () => {
    const dialog = await openDialog();
    expect(dialog).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('cancel', expect.anything());
  });

  it.each([
    ['Escape', () => userEvent.keyboard('{Escape}')],
    ['Nazaj', () => userEvent.click(screen.getByRole('button', { name: t.cancelDialog.back }))],
  ])('gives focus back to the button that opened it after %s', async (_name, close) => {
    await openDialog();
    await close();
    const row = screen.getByRole('listitem', { name: slotLabel(startsAt) });
    expect(within(row).getByRole('button', { name: t.slot.cancel })).toHaveFocus();
  });

  it('brings Tab back into the dialog after its focused button was disabled', async () => {
    const dialog = await openDialog();
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_NOT_CANCELLABLE: already charged' },
    });
    const confirm = within(dialog).getByRole('button', { name: t.cancelDialog.confirm });
    await userEvent.click(confirm);
    await within(dialog).findByRole('alert');
    expect(confirm).toBeDisabled();
    const outside = screen.getByRole('link', { name: t.common.signOut });
    outside.focus();
    expect(dialog).not.toContainElement(document.activeElement as HTMLElement);

    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: t.cancelDialog.back })).toHaveFocus();
    outside.focus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: t.cancelDialog.back })).toHaveFocus();
  });

  it('stops the page behind it from scrolling while it is open and restores it after', async () => {
    document.documentElement.style.overflow = 'scroll';
    await openDialog();
    expect(document.documentElement.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.documentElement.style.overflow).toBe('scroll');
    document.documentElement.style.overflow = '';
  });

  it('sends Tab to the first button and Shift+Tab to the last when focus is outside', async () => {
    const dialog = await openDialog();
    const confirm = within(dialog).getByRole('button', { name: t.cancelDialog.confirm });
    const back = within(dialog).getByRole('button', { name: t.cancelDialog.back });
    const outside = screen.getByRole('link', { name: t.common.signOut });

    outside.focus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    outside.focus();
    await userEvent.tab({ shift: true });
    expect(back).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const dialog = await openDialog();
    const confirm = within(dialog).getByRole('button', { name: t.cancelDialog.confirm });
    const back = within(dialog).getByRole('button', { name: t.cancelDialog.back });

    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(back).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(back).toHaveFocus();
  });

  it('shows the server error when the appointment changed meanwhile', async () => {
    const dialog = await openDialog();
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_NOT_CANCELLABLE: already charged' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancelDialog.confirm }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      errorMessages.AMRAP_NOT_CANCELLABLE,
    );
  });
});

describe('home', () => {
  it('marks a negative balance in red with the debt label', async () => {
    db.balance = -2;
    renderAt('/c');
    expect(await screen.findByText(formatBalance(db.balance))).toHaveClass('negative');
    expect(screen.getByText(t.customer.debt)).toBeInTheDocument();
  });

  it('does not show the debt label for a positive balance', async () => {
    db.balance = 3;
    renderAt('/c');
    expect(await screen.findByText(formatBalance(db.balance))).not.toHaveClass('negative');
    expect(screen.queryByText(t.customer.debt)).not.toBeInTheDocument();
  });

  it('shows the next appointment with the time left and lists the upcoming ones', async () => {
    const starts = ['2026-10-26T06:00:00Z', '2026-10-22T16:00:00Z'].map((iso) => new Date(iso));
    db.tables.appointments = starts.map((startsAt, index) => ({
      id: `a${index}`,
      customer_id: me.id,
      slot_template_id: null,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      status: 'booked',
    }));
    const soonest = new Date(Math.min(...starts.map((date) => date.getTime())));
    renderAt('/c');
    const next = await screen.findByRole('region', { name: t.customer.nextLabel });
    expect(next).toHaveTextContent(slotLabel(soonest));
    expect(next).toHaveTextContent(formatTimeUntil(timeUntil(soonest, now)));
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    const expected = [...starts].sort((a, b) => a.getTime() - b.getTime()).map(slotLabel);
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(expected);
  });
});

describe('history', () => {
  const rows = [
    { id: 'h1', starts_at: '2026-10-12T06:00:00Z', status: 'charged' },
    { id: 'h2', starts_at: '2026-10-19T06:00:00Z', status: 'cancelled_late' },
    { id: 'h3', starts_at: '2026-10-28T06:00:00Z', status: 'cancelled' },
    { id: 'h4', starts_at: '2026-10-28T16:00:00Z', status: 'booked' },
  ];
  const ledger = [
    { id: 'l1', amount: 8, type: 'topup', note: 'Gotovina', created_at: '2026-10-01T08:00:00Z' },
    { id: 'l2', amount: -1, type: 'session', note: null, created_at: '2026-10-12T06:00:00Z' },
    { id: 'l3', amount: -1, type: 'late_cancel', note: null, created_at: '2026-10-19T03:00:00Z' },
  ];

  beforeEach(() => {
    db.tables.appointments = rows.map((row) => ({
      ...row,
      customer_id: me.id,
      slot_template_id: null,
      ends_at: row.starts_at,
    }));
    db.tables.credit_transactions = ledger.map((row) => ({ ...row, customer_id: me.id }));
  });

  it('lists past and cancelled appointments newest first with their status', async () => {
    renderAt('/c/zgodovina');
    const section = await screen.findByRole('region', { name: t.history.appointmentsTitle });
    const items = await within(section).findAllByRole('listitem');
    const expected = rows
      .filter((row) => row.status !== 'booked' || Date.parse(row.starts_at) <= now.getTime())
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
    expect(items).toHaveLength(expected.length);
    expected.forEach((row, index) => {
      const startsAt = new Date(row.starts_at);
      expect(items[index]).toHaveTextContent(
        fill(t.slot.when, { day: formatDate(startsAt, tz), time: formatTime(startsAt, tz) }),
      );
      expect(items[index]).toHaveTextContent(
        t.appointmentStatus[row.status as keyof typeof t.appointmentStatus],
      );
    });
  });

  it('lists the ledger newest first with type, signed amount and note', async () => {
    renderAt('/c/zgodovina');
    const section = await screen.findByRole('region', { name: t.history.ledgerTitle });
    const items = await within(section).findAllByRole('listitem');
    const expected = [...ledger].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    expect(items).toHaveLength(expected.length);
    expected.forEach((row, index) => {
      expect(items[index]).toHaveTextContent(
        t.transactionType[row.type as keyof typeof t.transactionType],
      );
      expect(items[index]).toHaveTextContent(formatAmount(row.amount));
      if (row.note !== null) expect(items[index]).toHaveTextContent(row.note);
    });
  });
});
