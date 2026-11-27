import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill, plural, t } from '../../i18n';
import { weekdayHeading, weekdayName } from '../../lib/time';
import { routes } from '../../routes';
import {
  db,
  fakeSupabase,
  holdTable,
  makeCustomer,
  makeSession,
  resetFake,
} from '../../test/fakeSupabase';

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

function renderSettings(tab: 'urnik' | 'odpoved' | 'zaprto' | 'registracija') {
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

type Template = typeof existing;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function overlapsInTable(template: Template) {
  const start = minutes(template.start_time);
  const end = start + template.duration_minutes;
  return (
    template.active &&
    (db.tables.slot_templates as Template[]).some(
      (other) =>
        other.id !== template.id &&
        other.active &&
        other.weekday === template.weekday &&
        minutes(other.start_time) < end &&
        start < minutes(other.start_time) + other.duration_minutes,
    )
  );
}

function blockName(template: Template) {
  const marks = [
    ...(template.active ? [] : [t.settings.inactive]),
    ...(overlapsInTable(template) ? [t.settings.overlapping] : []),
  ];
  return fill(t.settings.blockLabel, {
    day: weekdayHeading(template.weekday),
    time: template.start_time.slice(0, 5),
    minutes: template.duration_minutes,
    places: plural(t.settings.places, template.capacity),
    marks: marks.map((mark) => `, ${mark}`).join(''),
  });
}

function overlapWarning(others: Template[], alone = true) {
  const slots = new Intl.ListFormat('sl', { type: 'conjunction' }).format(
    others.map((other) =>
      fill(t.settings.overlapSlot, {
        weekday: weekdayName(other.weekday),
        time: other.start_time.slice(0, 5),
        minutes: other.duration_minutes,
      }),
    ),
  );
  const form = others.length === 1 ? 'single' : others.length === 2 ? 'pair' : 'several';
  const text = fill(t.settings.overlapWarning[form], { slots });
  return alone ? `${text} ${t.settings.confirmAgain}` : text;
}

function wideScreen() {
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: query === '(min-width: 48rem)',
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  resetFake({ session: makeSession('user-t'), customer: trainer });
  db.tables.slot_templates = [{ ...existing }];
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('slot templates', () => {
  it('keeps Prekliči disabled while a new template is being saved', async () => {
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00' });
    const release = holdTable('slot_templates');
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('button', { name: t.settings.cancelEdit })).toBeDisabled();
    release();
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

  it('shows Nov termin as a button until it is pressed, then the form with focus in it', async () => {
    renderSettings('urnik');
    const button = await screen.findByRole('button', { name: t.settings.newTemplate });
    expect(screen.queryByRole('form', { name: t.settings.newTemplate })).not.toBeInTheDocument();
    await userEvent.click(button);
    const form = screen.getByRole('form', { name: t.settings.newTemplate });
    expect(within(form).getByLabelText(t.settings.weekday)).toHaveFocus();
    expect(screen.queryByRole('button', { name: t.settings.newTemplate })).not.toBeInTheDocument();
  });

  it('clears the last notice when a new template is cancelled, like a new blocked period', async () => {
    let form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '18:00' });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    await userEvent.click(await screen.findByRole('button', { name: t.settings.newTemplate }));
    form = screen.getByRole('form', { name: t.settings.newTemplate });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.cancelEdit }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    const row = within(list)
      .getByRole('button', { name: blockName(existing) })
      .closest('li');
    if (row === null) throw new Error('no row for the template');
    expect(within(row).queryByRole('button', { name: t.settings.delete })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: blockName(existing) }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await userEvent.click(within(form).getByLabelText(t.settings.active));
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await within(list).findByText(t.settings.inactive)).toBeVisible();
    expect(db.tables.slot_templates[0]).toMatchObject({ id: existing.id, active: false });
  });
});

describe('day groups below 768 px', () => {
  const week: Template[] = [
    { ...existing, id: 'tpl-wed', weekday: 2, start_time: '18:00:00', duration_minutes: 90 },
    { ...existing, id: 'tpl-sun', weekday: 6, start_time: '10:00:00', active: false },
    { ...existing, id: 'tpl-mon-17', weekday: 0, start_time: '17:00:00', capacity: 1 },
    { ...existing },
  ];

  beforeEach(() => {
    db.tables.slot_templates = week.map((template) => ({ ...template }));
  });

  it('groups templates under capitalised day headings in order, leaving out empty days', async () => {
    renderSettings('urnik');
    const section = await screen.findByRole('region', { name: t.settings.templatesTitle });
    const days = [...new Set(week.map((template) => template.weekday))].sort((a, b) => a - b);
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(days.map(weekdayHeading));
  });

  it('lists a day by start time with duration and places, and edits in place', async () => {
    renderSettings('urnik');
    const monday = await screen.findByRole('region', { name: weekdayHeading(0) });
    const rows = within(monday).getAllByRole('listitem');
    const mondays = week
      .filter((template) => template.weekday === 0)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    expect(rows).toHaveLength(mondays.length);
    mondays.forEach((template, index) => {
      expect(rows[index]).toHaveTextContent(template.start_time.slice(0, 5));
      expect(rows[index]).toHaveTextContent(
        fill(t.settings.slotDetails, {
          minutes: template.duration_minutes,
          places: plural(t.settings.places, template.capacity),
        }),
      );
      expect(
        within(rows[index]).getByRole('button', { name: blockName(template) }),
      ).toHaveTextContent(t.settings.edit);
    });
    await userEvent.click(within(rows[0]).getByRole('button', { name: blockName(mondays[0]) }));
    expect(within(monday).getByRole('form', { name: t.settings.editTemplate })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves focus into the form on Uredi and back to Uredi on Prekliči or save', async () => {
    renderSettings('urnik');
    const monday = await screen.findByRole('region', { name: weekdayHeading(0) });
    const target = week.find((template) => template.id === existing.id) as Template;
    await userEvent.click(within(monday).getByRole('button', { name: blockName(target) }));
    let form = within(monday).getByRole('form', { name: t.settings.editTemplate });
    expect(within(form).getByLabelText(t.settings.weekday)).toHaveFocus();
    await userEvent.click(within(form).getByRole('button', { name: t.settings.cancelEdit }));
    expect(within(monday).getByRole('button', { name: blockName(target) })).toHaveFocus();
    await userEvent.click(within(monday).getByRole('button', { name: blockName(target) }));
    form = within(monday).getByRole('form', { name: t.settings.editTemplate });
    await fillTemplate(form, { [t.settings.capacity]: String(target.capacity + 1) });
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    const saved = { ...target, capacity: target.capacity + 1 };
    await waitFor(() =>
      expect(within(monday).getByRole('button', { name: blockName(saved) })).toHaveFocus(),
    );
  });

  it('marks an inactive template next to its text', async () => {
    renderSettings('urnik');
    const sunday = await screen.findByRole('region', { name: weekdayHeading(6) });
    expect(within(sunday).getByRole('listitem')).toHaveTextContent(t.settings.inactive);
  });
});

describe('week grid from 768 px', () => {
  const week: Template[] = [
    { ...existing },
    { ...existing, id: 'tpl-mon-730', start_time: '07:30:00', capacity: 4 },
    {
      ...existing,
      id: 'tpl-wed',
      weekday: 2,
      start_time: '18:00:00',
      duration_minutes: 90,
      capacity: 1,
    },
    { ...existing, id: 'tpl-sun', weekday: 6, start_time: '10:00:00', capacity: 2, active: false },
  ];

  beforeEach(() => {
    wideScreen();
    db.tables.slot_templates = week.map((template) => ({ ...template }));
  });

  it('shows seven day columns with capitalised headings in order', async () => {
    renderSettings('urnik');
    const section = await screen.findByRole('region', { name: t.settings.templatesTitle });
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([0, 1, 2, 3, 4, 5, 6].map(weekdayHeading));
  });

  it('places each template in its weekday column with its time range and places', async () => {
    renderSettings('urnik');
    await screen.findByRole('region', { name: t.settings.templatesTitle });
    for (const template of week) {
      const column = screen.getByRole('region', { name: weekdayHeading(template.weekday) });
      const block = within(column).getByRole('button', { name: blockName(template) });
      const start = template.start_time.slice(0, 5);
      const endMinutes =
        Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + template.duration_minutes;
      const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      expect(block).toHaveTextContent(fill(t.settings.timeRange, { start, end }));
      expect(block).toHaveTextContent(plural(t.settings.places, template.capacity));
    }
  });

  it('explains the dashed edge only when some slots overlap', async () => {
    db.tables.slot_templates = week
      .filter((template) => template.id !== 'tpl-mon-730')
      .map((template) => ({ ...template }));
    renderSettings('urnik');
    await screen.findByRole('region', { name: t.settings.templatesTitle });
    expect(screen.queryByText(t.settings.overlapLegend)).not.toBeInTheDocument();
  });

  it('mutes an inactive template and tags it', async () => {
    renderSettings('urnik');
    const sunday = await screen.findByRole('region', { name: weekdayHeading(6) });
    const inactive = week.find((template) => !template.active) as Template;
    const block = within(sunday).getByRole('button', { name: blockName(inactive) });
    expect(block).toHaveClass('inactive');
    expect(block).toHaveTextContent(t.settings.inactive);
    expect(screen.getByText(t.settings.inactiveLegend)).toBeVisible();
  });

  it('sizes the day columns for the most slots side by side on any day', async () => {
    renderSettings('urnik');
    const monday = await screen.findByRole('region', { name: weekdayHeading(0) });
    const sideBySide = (template: Template) =>
      week.filter(
        (other) =>
          other.weekday === template.weekday &&
          minutes(other.start_time) < minutes(template.start_time) + template.duration_minutes &&
          minutes(template.start_time) < minutes(other.start_time) + other.duration_minutes,
      ).length;
    const mostSideBySide = Math.max(...week.map(sideBySide));
    const grid = monday.parentElement as HTMLElement;
    expect(grid.style.getPropertyValue('--max-lanes')).toBe(String(mostSideBySide));
  });

  it('returns focus to the block when the browser did not focus it on click', async () => {
    renderSettings('urnik');
    const block = await screen.findByRole('button', { name: blockName(existing) });
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => block.click());
    const dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    await userEvent.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(block).toHaveFocus();
  });

  it("drops a failed save's error from the page when the dialog is cancelled", async () => {
    renderSettings('urnik');
    await userEvent.click(await screen.findByRole('button', { name: blockName(existing) }));
    const dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    db.writeErrors.slot_templates = { message: 'FetchError: network down' };
    await fillTemplate(dialog, { [t.settings.capacity]: String(existing.capacity + 1) });
    await userEvent.click(within(dialog).getByRole('button', { name: t.settings.save }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t.genericError);
    await userEvent.click(within(dialog).getByRole('button', { name: t.settings.cancelEdit }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the edit form for a block in a dialog, focus in its first field', async () => {
    renderSettings('urnik');
    const target = week.find((template) => template.id === 'tpl-wed') as Template;
    const block = await screen.findByRole('button', { name: blockName(target) });
    await userEvent.click(block);
    const dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    expect(within(dialog).getByLabelText(t.settings.weekday)).toHaveFocus();
    expect(within(dialog).getByLabelText(t.settings.weekday)).toHaveValue(String(target.weekday));
    expect(within(dialog).getByLabelText(t.settings.startTime)).toHaveValue('18:00');
    expect(within(dialog).getByLabelText(t.settings.duration)).toHaveValue(target.duration_minutes);
  });

  it('closes the dialog on Prekliči or Escape and returns focus to the block', async () => {
    renderSettings('urnik');
    const block = await screen.findByRole('button', { name: blockName(existing) });
    await userEvent.click(block);
    let dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    await userEvent.click(within(dialog).getByRole('button', { name: t.settings.cancelEdit }));
    expect(dialog).not.toBeInTheDocument();
    expect(block).toHaveFocus();
    await userEvent.click(block);
    dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    await userEvent.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(block).toHaveFocus();
  });

  it('saves from the dialog, closes it and shows the notice', async () => {
    renderSettings('urnik');
    await userEvent.click(await screen.findByRole('button', { name: blockName(existing) }));
    const dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    await fillTemplate(dialog, { [t.settings.capacity]: String(existing.capacity + 2) });
    await userEvent.click(within(dialog).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const saved = { ...existing, capacity: existing.capacity + 2 };
    await waitFor(() =>
      expect(screen.getByRole('button', { name: blockName(saved) })).toHaveFocus(),
    );
    expect(db.tables.slot_templates[0]).toMatchObject({
      id: existing.id,
      capacity: saved.capacity,
    });
  });

  it('puts focus on the block in its new column after a save moves it to another day', async () => {
    renderSettings('urnik');
    await userEvent.click(await screen.findByRole('button', { name: blockName(existing) }));
    const dialog = screen.getByRole('dialog', { name: t.settings.editTemplate });
    await userEvent.selectOptions(within(dialog).getByLabelText(t.settings.weekday), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: t.settings.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    const moved = { ...existing, weekday: 4 };
    const friday = screen.getByRole('region', { name: weekdayHeading(4) });
    await waitFor(() =>
      expect(within(friday).getByRole('button', { name: blockName(moved) })).toHaveFocus(),
    );
  });

  it('keeps Nov termin as the section action', async () => {
    renderSettings('urnik');
    const section = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(section).getByRole('button', { name: t.settings.newTemplate }));
    expect(within(section).getByRole('form', { name: t.settings.newTemplate })).toBeVisible();
  });
});

describe('overlapping slots', () => {
  const save = (form: HTMLElement) =>
    userEvent.click(within(form).getByRole('button', { name: t.settings.save }));

  it('warns about a new slot that overlaps, naming the other, and saves on the second Shrani', async () => {
    const before = db.tables.slot_templates.length;
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '07:30' });
    await save(form);
    expect(within(form).getByRole('alert')).toHaveTextContent(overlapWarning([existing]));
    expect(db.tables.slot_templates).toHaveLength(before);
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.tables.slot_templates).toHaveLength(before + 1);
  });

  it('names both slots when it overlaps two', async () => {
    const second = { ...existing, id: 'tpl-2', start_time: '07:30:00' };
    db.tables.slot_templates.push({ ...second });
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '07:15' });
    await save(form);
    expect(within(form).getByRole('alert')).toHaveTextContent(overlapWarning([existing, second]));
  });

  it('checks changed values again before saving', async () => {
    const before = db.tables.slot_templates.length;
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '07:30' });
    await save(form);
    await fillTemplate(form, { [t.settings.startTime]: '07:45' });
    await save(form);
    expect(within(form).getByRole('alert')).toHaveTextContent(overlapWarning([existing]));
    expect(db.tables.slot_templates).toHaveLength(before);
  });

  it('saves touching ranges without a warning', async () => {
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '08:00' });
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
  });

  it('saves an inactive slot over an active one without a warning', async () => {
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '07:30' });
    await userEvent.click(within(form).getByLabelText(t.settings.active));
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
  });

  it('ignores an inactive slot when saving an active one over it', async () => {
    db.tables.slot_templates = [{ ...existing, active: false }];
    const form = await newTemplateForm();
    await fillTemplate(form, { [t.settings.startTime]: '07:30' });
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
  });

  it('does not count a slot being edited as overlapping itself', async () => {
    const stopped = { ...existing, active: false };
    db.tables.slot_templates = [{ ...stopped }];
    renderSettings('urnik');
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: blockName(stopped) }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await userEvent.click(within(form).getByLabelText(t.settings.active));
    await fillTemplate(form, { [t.settings.startTime]: '07:30' });
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.tables.slot_templates[0]).toMatchObject({ start_time: '07:30', active: true });
  });

  it('does not warn again about an overlap the slot already had', async () => {
    const second = { ...existing, id: 'tpl-2', start_time: '07:30:00' };
    db.tables.slot_templates.push({ ...second });
    renderSettings('urnik');
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await fillTemplate(form, { [t.settings.capacity]: String(existing.capacity + 1) });
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.tables.slot_templates[0].capacity).toBe(existing.capacity + 1);
  });

  it('warns when an edit reaches a slot it did not overlap before', async () => {
    const second = { ...existing, id: 'tpl-2', start_time: '07:30:00' };
    const third = { ...existing, id: 'tpl-3', start_time: '08:30:00' };
    db.tables.slot_templates.push({ ...second }, { ...third });
    renderSettings('urnik');
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await fillTemplate(form, { [t.settings.duration]: '120' });
    await save(form);
    expect(within(form).getByRole('alert')).toHaveTextContent(overlapWarning([third]));
  });

  it('shows the overlap and the stranded bookings together and saves on one more Shrani', async () => {
    const other = { ...existing, id: 'tpl-other', weekday: 1 };
    db.tables.slot_templates.push({ ...other });
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
    renderSettings('urnik');
    const list = await screen.findByRole('region', { name: t.settings.templatesTitle });
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
    const form = await screen.findByRole('form', { name: t.settings.editTemplate });
    await userEvent.selectOptions(within(form).getByLabelText(t.settings.weekday), '1');
    await save(form);
    const alerts = await within(form).findAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      overlapWarning([other], false),
      fill(t.settings.strandedWarning, { count: db.tables.appointments.length }),
    ]);
    await save(form);
    expect(await screen.findByRole('status')).toHaveTextContent(t.settings.saved);
    expect(db.tables.slot_templates[0].weekday).toBe(1);
  });

  describe('marks', () => {
    const week: Template[] = [
      { ...existing },
      { ...existing, id: 'tpl-707', start_time: '07:07:00' },
      { ...existing, id: 'tpl-807', start_time: '08:07:00' },
      { ...existing, id: 'tpl-off', start_time: '07:30:00', active: false },
      { ...existing, id: 'tpl-tue', weekday: 1 },
    ];
    const marked = () => week.filter(overlapsInTable).map((template) => template.id);

    beforeEach(() => {
      db.tables.slot_templates = week.map((template) => ({ ...template }));
    });

    it('marks overlapping blocks in the week grid, in text and in their names', async () => {
      wideScreen();
      renderSettings('urnik');
      await screen.findByRole('region', { name: t.settings.templatesTitle });
      expect(marked().length).toBeGreaterThan(0);
      expect(screen.getByText(t.settings.overlapLegend)).toBeVisible();
      for (const template of week) {
        const block = screen.getByRole('button', { name: blockName(template) });
        const overlapping = marked().includes(template.id);
        expect(block.classList.contains('overlap')).toBe(overlapping);
        expect(block.textContent?.includes(t.settings.overlapping)).toBe(overlapping);
      }
    });

    it('marks overlapping rows in the day groups', async () => {
      renderSettings('urnik');
      await screen.findByRole('region', { name: t.settings.templatesTitle });
      for (const template of week) {
        const row = screen.getByRole('button', { name: blockName(template) }).closest('li');
        expect(row?.textContent?.includes(t.settings.overlapping)).toBe(
          marked().includes(template.id),
        );
      }
    });
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
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
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
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
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
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
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
    await userEvent.click(within(list).getByRole('button', { name: blockName(existing) }));
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

describe('registration', () => {
  const r = t.settings.registration;
  const linkOf = (code: string) => `${window.location.origin}/registracija?koda=${code}`;
  const codeCalls = () =>
    fakeSupabase.rpc.mock.calls.filter(([name]) => name === 'set_registration_code');
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    vi.restoreAllMocks();
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  async function section() {
    renderSettings('registracija');
    return screen.findByRole('region', { name: r.title });
  }

  it('says registration is closed and offers to open it', async () => {
    const tab = await section();
    expect(within(tab).getByText(r.closed)).toBeVisible();
    expect(within(tab).getByRole('button', { name: r.openAction })).toBeVisible();
    expect(within(tab).queryByLabelText(r.link)).toBeNull();
  });

  it('opens registration with a new random URL-safe code of at least 16 characters', async () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const tab = await section();
    await userEvent.click(within(tab).getByRole('button', { name: r.openAction }));
    expect(random).toHaveBeenCalled();
    expect(codeCalls()).toHaveLength(1);
    const code = String(codeCalls()[0][1].p_code);
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(await within(tab).findByLabelText(r.link)).toHaveValue(linkOf(code));
  });

  it('shows the full link, a copy button, Nova koda and Zapri registracijo while open', async () => {
    db.registrationCode = 'open-code-1234567890';
    const tab = await section();
    expect(within(tab).getByText(r.open)).toBeVisible();
    expect(within(tab).getByLabelText(r.link)).toHaveValue(linkOf(db.registrationCode));
    for (const name of [r.copy, r.newCode, r.close]) {
      expect(within(tab).getByRole('button', { name })).toBeVisible();
    }
  });

  it('shows the link in a wrapping text box, not a one-line input', async () => {
    db.registrationCode = 'open-code-1234567890';
    const tab = await section();
    const field = within(tab).getByLabelText(r.link);
    expect(field).toBeInstanceOf(HTMLTextAreaElement);
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveValue(linkOf(db.registrationCode));
  });

  it('copies the link', async () => {
    db.registrationCode = 'open-code-1234567890';
    const tab = await section();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(within(tab).getByRole('button', { name: r.copy }));
    expect(writeText).toHaveBeenCalledWith(linkOf(db.registrationCode));
    expect(await within(tab).findByRole('status')).toHaveTextContent(r.copied);
  });

  it('says so when the link cannot be copied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.registrationCode = 'open-code-1234567890';
    const tab = await section();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await userEvent.click(within(tab).getByRole('button', { name: r.copy }));
    expect(await within(tab).findByRole('alert')).toHaveTextContent(r.copyFailed);
    expect(warn).toHaveBeenCalled();
  });

  it('warns that the printed QR stops working and makes a new code only on the second tap', async () => {
    const old = 'open-code-1234567890';
    db.registrationCode = old;
    const tab = await section();
    await userEvent.click(within(tab).getByRole('button', { name: r.newCode }));
    expect(within(tab).getByText(r.newCodeWarning)).toBeVisible();
    expect(codeCalls()).toHaveLength(0);
    await userEvent.click(within(tab).getByRole('button', { name: r.confirmNewCode }));
    expect(codeCalls()).toHaveLength(1);
    const code = String(codeCalls()[0][1].p_code);
    expect(code).not.toBe(old);
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(await within(tab).findByLabelText(r.link)).toHaveValue(linkOf(code));
    await waitFor(() => expect(within(tab).getByRole('button', { name: r.newCode })).toHaveFocus());
  });

  it('warns that the printed QR stops working and closes only on the second tap', async () => {
    db.registrationCode = 'open-code-1234567890';
    const tab = await section();
    await userEvent.click(within(tab).getByRole('button', { name: r.close }));
    expect(within(tab).getByText(r.closeWarning)).toBeVisible();
    expect(codeCalls()).toHaveLength(0);
    await userEvent.click(within(tab).getByRole('button', { name: r.confirmClose }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('set_registration_code', { p_code: null });
    expect(await within(tab).findByText(r.closed)).toBeVisible();
    expect(db.registrationCode).toBeNull();
  });

  it.each([
    ['opening', null, [r.openAction]],
    ['closing', 'open-code-1234567890', [r.close, r.confirmClose]],
  ] as const)('moves focus to the heading after %s removes the button', async (_, code, taps) => {
    db.registrationCode = code;
    const tab = await section();
    for (const name of taps) await userEvent.click(within(tab).getByRole('button', { name }));
    await waitFor(() =>
      expect(within(tab).getByRole('heading', { level: 2, name: r.title })).toHaveFocus(),
    );
  });

  it('drops the confirmation on Prekliči without a change', async () => {
    db.registrationCode = 'open-code-1234567890';
    const tab = await section();
    await userEvent.click(within(tab).getByRole('button', { name: r.close }));
    await userEvent.click(within(tab).getByRole('button', { name: t.common.cancel }));
    expect(within(tab).queryByText(r.closeWarning)).toBeNull();
    expect(within(tab).getByRole('button', { name: r.close })).toHaveFocus();
    expect(codeCalls()).toHaveLength(0);
  });

  it('shows a refusal', async () => {
    const tab = await section();
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_FORBIDDEN: trainer only' },
    });
    await userEvent.click(within(tab).getByRole('button', { name: r.openAction }));
    expect(await within(tab).findByRole('alert')).toHaveTextContent(t.errors.AMRAP_FORBIDDEN);
    expect(within(tab).getByText(r.closed)).toBeVisible();
  });
});

describe('blocked periods', () => {
  it('keeps Prekliči disabled while the overlapping bookings are counted', async () => {
    const form = await newBlockedForm();
    await fillTemplate(form, {
      [t.settings.fromDate]: '2026-12-24',
      [t.settings.fromTime]: '00:00',
      [t.settings.toDate]: '2026-12-27',
      [t.settings.toTime]: '00:00',
    });
    const release = holdTable('appointments');
    await userEvent.click(within(form).getByRole('button', { name: t.settings.save }));
    expect(within(form).getByRole('button', { name: t.settings.cancelEdit })).toBeDisabled();
    release();
    await waitFor(() => expect(form).not.toBeInTheDocument());
  });

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
