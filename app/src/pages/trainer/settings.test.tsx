import { render, screen, waitFor, within } from '@testing-library/react';
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

function renderSettings(tab: 'urnik' | 'odpoved' | 'zaprto') {
  const router = createMemoryRouter(routes, { initialEntries: [`/t/nastavitve/${tab}`] });
  render(<RouterProvider router={router} />);
}

async function openForm(tab: 'urnik' | 'zaprto', button: string) {
  renderSettings(tab);
  await userEvent.click(await screen.findByRole('button', { name: button }));
  return screen.getByRole('form', { name: button });
}

const newTemplateForm = () => openForm('urnik', t.settings.newTemplate);
const newBlockedForm = () => openForm('zaprto', t.settings.newBlocked);

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
  it('shows Nov termin as a button until it is pressed, then the form with focus in it', async () => {
    renderSettings('urnik');
    const button = await screen.findByRole('button', { name: t.settings.newTemplate });
    expect(screen.queryByRole('form', { name: t.settings.newTemplate })).not.toBeInTheDocument();
    await userEvent.click(button);
    const form = screen.getByRole('form', { name: t.settings.newTemplate });
    expect(within(form).getByLabelText(t.settings.weekday)).toHaveFocus();
    expect(screen.queryByRole('button', { name: t.settings.newTemplate })).not.toBeInTheDocument();
  });

  it('drops the input on Prekliči and puts focus back on the button', async () => {
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.cancelEdit }));
    expect(form).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: t.settings.newTemplate });
    expect(button).toHaveFocus();
    await userEvent.click(button);
    const again = screen.getByRole('form', { name: t.settings.newTemplate });
    expect(within(again).getByLabelText(t.settings.startTime)).toHaveValue('');
  });

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
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: t.settings.newTemplate })).toHaveFocus();
    expect(db.tables.slot_templates.at(-1)).toMatchObject({
      weekday: 2,
      start_time: '18:00',
      duration_minutes: 90,
      capacity: 4,
      active: true,
    });
  });

  it('deactivates an existing template instead of deleting it', async () => {
    renderSettings('urnik');
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
    renderSettings('urnik');
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
    renderSettings('urnik');
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
    renderSettings('urnik');
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
    renderSettings('urnik');
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
    renderSettings('odpoved');
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
    renderSettings('odpoved');
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
  it('shows Novo zaprto obdobje as a button until it is pressed, then the form with focus in it', async () => {
    renderSettings('zaprto');
    const button = await screen.findByRole('button', { name: t.settings.newBlocked });
    expect(screen.queryByRole('form', { name: t.settings.newBlocked })).not.toBeInTheDocument();
    await userEvent.click(button);
    const form = screen.getByRole('form', { name: t.settings.newBlocked });
    expect(within(form).getByLabelText(t.settings.fromDate)).toHaveFocus();
  });

  it('drops the input on Prekliči and puts focus back on the button', async () => {
    const form = await newBlockedForm();
    await fillTemplate(form, { [t.settings.reason]: 'Prazniki' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.cancelEdit }));
    expect(form).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: t.settings.newBlocked });
    expect(button).toHaveFocus();
    await userEvent.click(button);
    const again = screen.getByRole('form', { name: t.settings.newBlocked });
    expect(within(again).getByLabelText(t.settings.reason)).toHaveValue('');
  });

  it('keeps the browser from autofilling the reason', async () => {
    const form = await newBlockedForm();
    expect(within(form).getByLabelText(t.settings.reason)).toHaveAttribute('autocomplete', 'off');
  });

  it('creates a period from local date and time in the gym timezone', async () => {
    const form = await newBlockedForm();
    await fillTemplate(form, {
      [t.settings.fromDate]: '2026-12-24',
      [t.settings.fromTime]: '00:00',
      [t.settings.toDate]: '2026-12-27',
      [t.settings.toTime]: '00:00',
      [t.settings.reason]: 'Prazniki',
    });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByText('Prazniki')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(t.settings.saved);
    await waitFor(() => expect(form).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: t.settings.newBlocked })).toHaveFocus();
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
      const form = await newBlockedForm();
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

    it('shows an error and saves nothing when the bookings cannot be counted', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const form = await newBlockedForm();
      await fillTemplate(form, period);
      db.readErrors.appointments = { message: 'FetchError: network down' };
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const section = screen.getByRole('region', { name: t.settings.blockedTitle });
      expect(await within(section).findByRole('alert')).toHaveTextContent(t.genericError);
      expect(within(form).getByRole('button', { name: t.settings.save })).toBeEnabled();
      expect(db.tables.blocked_periods).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('counts again and warns again when the range changed after the warning', async () => {
      const form = await newBlockedForm();
      await fillTemplate(form, period);
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const section = screen.getByRole('region', { name: t.settings.blockedTitle });
      await within(section).findByRole('alert');

      await fillTemplate(form, { [t.settings.toDate]: '2026-12-25' });
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const stillInside = db.tables.appointments.filter((row) => row.id === 'inside-booked').length;
      expect(await within(section).findByRole('alert')).toHaveTextContent(
        fill(t.settings.blockedOverlapWarning, { count: stillInside }),
      );
      expect(db.tables.blocked_periods).toHaveLength(0);
    });

    it('does not count sessions that have already ended', async () => {
      db.tables.appointments = [
        appointment('held', '2026-10-20T08:00:00.000Z', 'charged'),
        appointment('ahead', '2026-10-22T08:00:00.000Z', 'booked'),
      ];
      const notEnded = db.tables.appointments.filter(
        (row) => new Date(String(row.ends_at)) > now,
      ).length;
      const form = await newBlockedForm();
      await fillTemplate(form, {
        [t.settings.fromDate]: '2026-10-20',
        [t.settings.fromTime]: '00:00',
        [t.settings.toDate]: '2026-10-23',
        [t.settings.toTime]: '00:00',
      });
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const section = screen.getByRole('region', { name: t.settings.blockedTitle });
      expect(await within(section).findByRole('alert')).toHaveTextContent(
        fill(t.settings.blockedOverlapWarning, { count: notEnded }),
      );
    });

    it('drops the warning when an edit is cancelled, and warns again on the next save', async () => {
      db.tables.blocked_periods = [
        {
          id: 'b-xmas',
          starts_at: '2026-12-23T23:00:00.000Z',
          ends_at: '2026-12-26T23:00:00.000Z',
          reason: 'Prazniki',
        },
      ];
      renderSettings('zaprto');
      const section = await screen.findByRole('region', { name: t.settings.blockedTitle });
      const edit = async () => {
        const row = (await within(section).findByText('Prazniki')).closest('li') as HTMLElement;
        await userEvent.click(within(row).getByRole('button', { name: t.settings.edit }));
        return screen.findByRole('form', { name: t.settings.editBlocked });
      };

      let form = await edit();
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      await within(section).findByRole('alert');
      await userEvent.click(within(form).getByRole('button', { name: t.settings.cancelEdit }));
      expect(within(section).queryByRole('alert')).not.toBeInTheDocument();

      form = await edit();
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const live = db.tables.appointments.filter(
        (row) => row.id === 'inside-booked' || row.id === 'inside-charged',
      ).length;
      expect(await within(section).findByRole('alert')).toHaveTextContent(
        fill(t.settings.blockedOverlapWarning, { count: live }),
      );
      expect(screen.getByRole('form', { name: t.settings.editBlocked })).toBeInTheDocument();
    });

    it('saves at once when no live booking overlaps', async () => {
      db.tables.appointments = db.tables.appointments.filter(
        (row) => !String(row.id).startsWith('inside-') || row.status === 'cancelled',
      );
      const form = await newBlockedForm();
      await fillTemplate(form, period);
      await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
      const section = screen.getByRole('region', { name: t.settings.blockedTitle });
      expect(await within(section).findByRole('status')).toHaveTextContent(t.settings.saved);
      expect(db.tables.blocked_periods).toHaveLength(1);
    });
  });

  it('rejects an end before the start', async () => {
    const form = await newBlockedForm();
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
    renderSettings('zaprto');
    const row = (await screen.findByText('Servis')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: t.settings.delete }));
    expect(await screen.findByText(t.settings.noBlocked)).toBeVisible();
    expect(db.tables.blocked_periods).toHaveLength(0);
  });
});

describe('empty sections', () => {
  it.each([
    ['urnik', t.settings.templatesTitle, t.settings.noTemplates],
    ['zaprto', t.settings.blockedTitle, t.settings.noBlocked],
  ] as const)('shows the empty line on %s instead of an empty list', async (tab, name, empty) => {
    db.tables.slot_templates = [];
    db.tables.blocked_periods = [];
    renderSettings(tab);
    const section = await screen.findByRole('region', { name });
    expect(within(section).getByText(empty)).toBeVisible();
    expect(within(section).queryByRole('list')).toBeNull();
  });
});
