import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';
import { PAGE_SIZE } from '../data/page';
import { t } from '../i18n';
import { db, holdTable } from './fakeSupabase';

export const PAGED_TOTAL = PAGE_SIZE * 2 + Math.ceil(PAGE_SIZE / 2);

function showMore(section: HTMLElement) {
  return within(section).queryByRole('button', { name: t.common.showMore });
}

async function expectRows(section: HTMLElement, expected: string[]) {
  await waitFor(() =>
    expect(within(section).getAllByRole('listitem')).toHaveLength(expected.length),
  );
  const items = within(section).getAllByRole('listitem');
  expected.forEach((text, index) => expect(items[index]).toHaveTextContent(text));
}

export async function expectEveryPage(section: HTMLElement, expected: string[]) {
  for (let shown = PAGE_SIZE; ; shown += PAGE_SIZE) {
    const count = Math.min(shown, expected.length);
    await expectRows(section, expected.slice(0, count));
    const button = showMore(section);
    if (count === expected.length) {
      expect(button).toBeNull();
      return;
    }
    expect(button).not.toBeNull();
    await userEvent.click(button as HTMLElement);
    await waitFor(() => expect(within(section).getAllByRole('listitem')[count]).toHaveFocus());
  }
}

export async function expectLoadingThenRows(
  section: HTMLElement,
  table: string,
  expected: string[],
) {
  await expectRows(section, expected.slice(0, PAGE_SIZE));
  const release = holdTable(table);
  await userEvent.click(showMore(section) as HTMLElement);
  const busy = within(section).getByRole('button', { name: t.common.loading });
  expect(busy).toHaveAttribute('aria-disabled', 'true');
  expect(busy).toHaveFocus();
  await userEvent.click(busy);
  release();
  await expectRows(section, expected.slice(0, PAGE_SIZE * 2));
}

export async function expectRetryAfterFailure(
  section: HTMLElement,
  table: string,
  expected: string[],
) {
  await expectRows(section, expected.slice(0, PAGE_SIZE));
  db.readErrors[table] = { message: 'offline' };
  await userEvent.click(showMore(section) as HTMLElement);
  expect(await within(section).findByRole('alert')).toHaveTextContent(t.common.loadFailed);
  await expectRows(section, expected.slice(0, PAGE_SIZE));
  const button = showMore(section);
  expect(button).not.toHaveAttribute('aria-disabled', 'true');
  delete db.readErrors[table];
  await userEvent.click(button as HTMLElement);
  await expectRows(section, expected.slice(0, PAGE_SIZE * 2));
  expect(within(section).queryByRole('alert')).toBeNull();
}
