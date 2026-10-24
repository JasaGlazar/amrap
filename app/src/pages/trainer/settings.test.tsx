import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, plural, t } from '../../i18n';
import { weekdayName } from '../../lib/time';
import { routes } from '../../routes';
import { db, makeCustomer, makeSession, resetFake } from '../../test/fakeSupabase';

vi.mock('../../lib/supabase', async () => ({
  supabase: (await import('../../test/fakeSupabase')).fakeSupabase,
}));

const trainer = makeCustomer({ id: 'trainer-1', role: 'trainer', auth_user_id: 'user-t' });
const now = new Date('2026-10-21T10:00:00Z');
const existing = {
  id: 'tpl-1',
  weekday: 0,
  start_time: '07:00:00',
  duration_minutes: 60,
  capacity: 5,
  active: true,
};

function renderSettings() {
  const router = createMemoryRouter(routes, { initialEntries: ['/t/nastavitve'] });
  render(<RouterProvider router={router} />);
}

async function newTemplateForm() {
  renderSettings();
  return screen.findByRole('form', { name: t.settings.newTemplate });
}

async function fillTemplate(form: HTMLElement, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    const input = within(form).getByLabelText(label);
    await userEvent.clear(input);
    await userEvent.type(input, value);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  resetFake({ session: makeSession('user-t'), customer: trainer });
  db.tables.slot_templates = [{ ...existing }];
});

afterEach(() => vi.useRealTimers());

describe('slot templates', () => {
  it('rejects a duration that is not positive', async () => {
    const before = db.tables.slot_templates.length;
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00', [t.settings.duration]: '0' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.settings.durationInvalid);
    expect(db.tables.slot_templates).toHaveLength(before);
  });

  it('rejects a capacity that is not positive', async () => {
    const before = db.tables.slot_templates.length;
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00', [t.settings.capacity]: '0' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.settings.capacityInvalid);
    expect(db.tables.slot_templates).toHaveLength(before);
  });

  it('creates a template', async () => {
    const form = await newTemplateForm();
    await userEvent.selectOptions(within(form).getByLabelText(t.settings.weekday), '2');
    await fillTemplate(form, {
      [t.settings.startTime]: '18:00',
      [t.settings.duration]: '90',
      [t.settings.capacity]: '4',
    });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.tables.slot_templates.at(-1)).toMatchObject({
      weekday: 2,
      start_time: '18:00',
      duration_minutes: 90,
      capacity: 4,
      active: true,
    });
  });

  it('deactivates an existing template instead of deleting it', async () => {
    renderSettings();
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    const line = fill(t.settings.templateLine, {
      weekday: weekdayName(existing.weekday),
      time: existing.start_time.slice(0, 5),
      minutes: existing.duration_minutes,
      places: plural(t.settings.places, existing.capacity),
    });
    const row = within(list).getByText(line).closest('li') as HTMLElement;
    expect(within(row).queryByRole('button', { name: t.settings.delete })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: t.settings.edit }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await userEvent.click(within(form).getByLabelText(t.settings.active));
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await within(list).findByText(t.settings.inactive)).toBeVisible();
    expect(db.tables.slot_templates[0]).toMatchObject({ id: existing.id, active: false });
  });
});

describe('stranded bookings', () => {
  beforeEach(() => {
    db.tables.appointments = [
      {
        id: 'future-1',
        customer_id: 'c-1',
        slot_template_id: existing.id,
        starts_at: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        ends_at: new Date(now.getTime() + 3 * 86_400_000 + 3_600_000).toISOString(),
        status: 'booked',
      },
    ];
  });

  it('warns with the count of future bookings and saves only on the second click', async () => {
    renderSettings();
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: t.settings.edit }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await userEvent.click(within(form).getByLabelText(t.settings.active));
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    const count = db.tables.appointments.filter(
      (row) => row.slot_template_id === existing.id && row.status === 'booked',
    ).length;
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      fill(t.settings.strandedWarning, { count }),
    );
    expect(db.tables.slot_templates[0].active).toBe(true);
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await within(list).findByText(t.settings.inactive)).toBeVisible();
    expect(db.tables.slot_templates[0].active).toBe(false);
  });

  it('shows an error and saves nothing when the count cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderSettings();
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: t.settings.edit }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    db.readErrors.appointments = { message: 'FetchError: network down' };
    await userEvent.click(within(form).getByLabelText(t.settings.active));
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await within(list).findByRole('alert')).toHaveTextContent(t.genericError);
    expect(within(form).getByRole('button', { name: t.settings.save })).toBeEnabled();
    expect(db.tables.slot_templates[0].active).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns when the start time moves too', async () => {
    renderSettings();
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: t.settings.edit }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await fillTemplate(form, { [t.settings.startTime]: '08:00' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      fill(t.settings.strandedWarning, { count: db.tables.appointments.length }),
    );
    expect(db.tables.slot_templates[0].start_time).toBe(existing.start_time);
  });

  it('saves a capacity change without a warning', async () => {
    renderSettings();
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: t.settings.edit }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await fillTemplate(form, { [t.settings.capacity]: String(existing.capacity + 1) });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.tables.slot_templates[0].capacity).toBe(existing.capacity + 1);
  });
});

describe('cutoff', () => {
  it('saves the late-cancel hours', async () => {
    renderSettings();
    const form = await screen.findByRole('form', { name: t.settings.cutoffTitle });
    const input = within(form).getByLabelText(t.settings.cutoffHours);
    expect(input).toHaveValue(db.settings.late_cancel_hours);
    await userEvent.clear(input);
    await userEvent.type(input, '12');
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await within(form).findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.settings.late_cancel_hours).toBe(12);
  });

  it('rejects a negative value', async () => {
    renderSettings();
    const form = await screen.findByRole('form', { name: t.settings.cutoffTitle });
    const before = db.settings.late_cancel_hours;
    const input = within(form).getByLabelText(t.settings.cutoffHours);
    await userEvent.clear(input);
    await userEvent.type(input, '-1');
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.settings.cutoffInvalid);
    expect(db.settings.late_cancel_hours).toBe(before);
  });
});

describe('blocked periods', () => {
  it('keeps the browser from autofilling the reason', async () => {
    renderSettings();
    const form = await screen.findByRole('form', { name: t.settings.newBlocked });
    expect(within(form).getByLabelText(t.settings.reason)).toHaveAttribute('autocomplete', 'off');
  });

  it('creates a period from local date and time in the gym timezone', async () => {
    renderSettings();
    const form = await screen.findByRole('form', { name: t.settings.newBlocked });
    await fillTemplate(form, {
      [t.settings.fromDate]: '2026-12-24',
      [t.settings.fromTime]: '00:00',
      [t.settings.toDate]: '2026-12-27',
      [t.settings.toTime]: '00:00',
      [t.settings.reason]: 'Prazniki',
    });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByText('Prazniki')).toBeVisible();
    expect(db.tables.blocked_periods[0]).toMatchObject({
      starts_at: '2026-12-23T23:00:00.000Z',
      ends_at: '2026-12-26T23:00:00.000Z',
      reason: 'Prazniki',
    });
  });

  describe('bookings inside a new period', () => {
    const period = {
      [t.settings.fromDate]: '2026-12-24',
      [t.settings.fromTime]: '00:00',
      [t.settings.toDate]: '2026-12-27',
      [t.settings.toTime]: '00:00',
    };
    const appointment = (id: string, startsAt: string, status: string) => ({
      id,
      customer_id: 'c-1',
      slot_template_id: null,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
      status,
    });

    beforeEach(() => {
      db.tables.appointments = [
        appointment('inside-booked', '2026-12-24T08:00:00.000Z', 'booked'),
        appointment('inside-charged', '2026-12-26T09:00:00.000Z', 'charged'),
        appointment('inside-cancelled', '2026-12-25T09:00:00.000Z', 'cancelled'),
        appointment('ends-at-start', '2026-12-23T22:00:00.000Z', 'booked'),
        appointment('after', '2026-12-27T08:00:00.000Z', 'booked'),
      ];
    });

    it('warns with the number of live bookings it does not cancel and saves on a second Shrani', async () => {
      const live = db.tables.appointments.filter(
        (row) => row.id === 'inside-booked' || row.id === 'inside-charged',
      ).length;
      renderSettings();
      const form = await screen.findByRole('form', { name: t.settings.newBlocked });
      await fillTemplate(form, period);
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));

      const section = screen.getByRole('region', { name: t.settings.blockedTitle });
      expect(await within(section).findByRole('alert')).toHaveTextContent(
        fill(t.settings.blockedOverlapWarning, { count: live }),
      );
      expect(db.tables.blocked_periods).toHaveLength(0);

      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      expect(await within(section).findByRole('status')).toHaveTextContent(t.settings.saved);
      expect(db.tables.blocked_periods).toHaveLength(1);
    });

    it('saves at once when no live booking overlaps', async () => {
      db.tables.appointments = db.tables.appointments.filter(
        (row) => !String(row.id).startsWith('inside-') || row.status === 'cancelled',
      );
      renderSettings();
      const form = await screen.findByRole('form', { name: t.settings.newBlocked });
      await fillTemplate(form, period);
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const section = screen.getByRole('region', { name: t.settings.blockedTitle });
      expect(await within(section).findByRole('status')).toHaveTextContent(t.settings.saved);
      expect(db.tables.blocked_periods).toHaveLength(1);
    });
  });

  it('rejects an end before the start', async () => {
    renderSettings();
    const form = await screen.findByRole('form', { name: t.settings.newBlocked });
    await fillTemplate(form, {
      [t.settings.fromTime]: '12:00',
      [t.settings.toTime]: '10:00',
    });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.trainer.invalidRange);
    expect(db.tables.blocked_periods).toHaveLength(0);
  });

  it('deletes a period', async () => {
    db.tables.blocked_periods = [
      {
        id: 'b1',
        starts_at: '2026-11-01T08:00:00+00:00',
        ends_at: '2026-11-01T12:00:00+00:00',
        reason: 'Servis',
      },
    ];
    renderSettings();
    const row = (await screen.findByText('Servis')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: t.settings.delete }));
    expect(await screen.findByText(t.settings.noBlocked)).toBeVisible();
    expect(db.tables.blocked_periods).toHaveLength(0);
  });
});
