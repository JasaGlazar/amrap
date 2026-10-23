import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, t } from '../../i18n';
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
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00', [t.settings.duration]: '0' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.settings.durationInvalid);
    expect(db.tables.slot_templates).toHaveLength(1);
  });

  it('rejects a capacity that is not positive', async () => {
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00', [t.settings.capacity]: '0' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('alert')).toHaveTextContent(t.settings.capacityInvalid);
    expect(db.tables.slot_templates).toHaveLength(1);
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
      capacity: existing.capacity,
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
