import { fill } from '../src/i18n/fill';
import { sl } from '../src/i18n/sl';
import { expect, signIn, test, TRAINER } from './fixtures';

test('the trainer assigns a fixed appointment and the customer sees it', async ({
  page,
  newGuardedPage,
  customer,
  slotTemplate,
}) => {
  await signIn(page, TRAINER);
  await page.goto(`/t/stranke/${customer.id}`);
  const rules = page.getByRole('region', { name: sl.customerDetail.rulesTitle });
  await rules.getByRole('button', { name: sl.customerDetail.addRule }).click();
  const form = rules.getByRole('form', { name: sl.customerDetail.addRuleLabel });
  await form.getByLabel(sl.customerDetail.ruleTemplate).selectOption(slotTemplate.id);
  await form.getByRole('button', { name: sl.customerDetail.addRule }).click();
  await expect(rules.getByRole('button', { name: sl.customerDetail.stopRule })).toBeVisible();

  const customerPage = await newGuardedPage();
  await signIn(customerPage, customer);
  await expect(
    customerPage.getByRole('heading', { name: sl.customer.upcomingTitle }),
  ).toBeVisible();
  await expect(
    customerPage
      .getByRole('listitem')
      .filter({ hasText: slotTemplate.startTime })
      .filter({ has: customerPage.getByRole('button', { name: sl.slot.cancel, exact: true }) })
      .first(),
  ).toBeVisible();
});

test('the trainer cancels an appointment with a reason and the customer sees it', async ({
  page,
  newGuardedPage,
  customer,
  fixedAppointment,
}) => {
  const reason = 'E2E razlog';
  await signIn(page, TRAINER);
  await page.goto(`/t/stranke/${customer.id}`);
  const upcoming = page.getByRole('region', { name: sl.customerDetail.upcomingTitle });
  const rows = upcoming.getByRole('listitem').filter({ hasText: fixedAppointment.startTime });
  await rows.last().getByRole('button', { name: sl.slot.cancel, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: sl.cancelDialog.title });
  await expect(dialog).toContainText(customer.name);
  await dialog.getByLabel(sl.cancelDialog.reason).fill(reason);
  await dialog.getByRole('button', { name: sl.cancelDialog.confirm, exact: true }).click();
  await expect(upcoming.getByText(sl.cancelDialog.done)).toBeVisible();

  const customerPage = await newGuardedPage();
  await signIn(customerPage, customer);
  await customerPage
    .getByRole('navigation', { name: sl.nav.customerLabel })
    .getByRole('link', { name: sl.nav.history })
    .click();
  const appointments = customerPage.getByRole('region', {
    name: sl.history.appointmentsTitle,
    exact: true,
  });
  await expect(
    appointments
      .getByRole('listitem')
      .filter({ hasText: sl.appointmentStatus.cancelled_by_trainer })
      .filter({ hasText: fill(sl.history.reason, { reason }) }),
  ).toBeVisible();
});
