import type { Page } from '@playwright/test';
import { fill } from '../src/i18n/fill';
import { sl } from '../src/i18n/sl';
import { expect, signIn, test } from './fixtures';

function upcomingRows(page: Page, startTime: string) {
  return page
    .getByRole('listitem')
    .filter({ hasText: startTime })
    .filter({ has: page.getByRole('button', { name: sl.slot.cancel, exact: true }) });
}

test('a customer sees their fixed appointments on Home', async ({
  page,
  customer,
  fixedAppointment,
}) => {
  await signIn(page, customer);
  await expect(page.getByRole('heading', { name: sl.customer.upcomingTitle })).toBeVisible();
  await expect(upcomingRows(page, fixedAppointment.startTime).nth(2)).toBeVisible();
});

test('a customer cancels an appointment and restores it', async ({
  page,
  customer,
  fixedAppointment,
}) => {
  await signIn(page, customer);
  const rows = upcomingRows(page, fixedAppointment.startTime);
  await expect(rows.nth(2)).toBeVisible();
  const when = await rows.last().getAttribute('aria-label');
  if (when === null) throw new Error('the upcoming row has no aria-label');
  const upcomingRow = rows.and(page.getByRole('listitem', { name: when, exact: true }));
  const cancelledRow = page
    .getByRole('region', { name: sl.customer.cancelledTitle })
    .getByRole('listitem', { name: when, exact: true });

  await upcomingRow.getByRole('button', { name: sl.slot.cancel, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: sl.cancelDialog.title });
  await expect(dialog).toContainText(sl.cancelDialog.free);
  await dialog.getByRole('button', { name: sl.cancelDialog.confirm, exact: true }).click();

  await expect(upcomingRow).toHaveCount(0);
  await cancelledRow.getByRole('button', { name: sl.customer.undo }).click();

  await expect(page.getByRole('status').filter({ hasText: sl.customer.restored })).toBeVisible();
  await expect(upcomingRow).toBeVisible();
  await expect(cancelledRow).toHaveCount(0);
});

test('the calendar shows free places and no book button', async ({
  page,
  customer,
  fixedAppointment,
}) => {
  await signIn(page, customer);
  await page
    .getByRole('navigation', { name: sl.nav.customerLabel })
    .getByRole('link', { name: sl.nav.calendar })
    .click();
  await page.getByRole('button', { name: sl.calendar.nextWeek }).click();

  const mine = page
    .getByRole('listitem')
    .filter({ hasText: fixedAppointment.startTime })
    .filter({ hasText: sl.calendar.mine });
  await expect(mine).toContainText(
    fill(sl.calendar.spots, {
      free: fixedAppointment.capacity - 1,
      capacity: fixedAppointment.capacity,
    }),
  );
  await expect(page.getByRole('button', { name: sl.calendar.book })).toHaveCount(0);
});
