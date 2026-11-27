import type { Page } from '@playwright/test';
import { sl } from '../src/i18n/sl';
import { expect, signIn, test, TRAINER, type Registrant } from './fixtures';

async function submitRegistration(page: Page, who: Registrant): Promise<void> {
  await page.getByLabel(sl.register.name).fill(who.name);
  await page.getByLabel(sl.register.phone).fill(who.phone);
  await page.getByLabel(sl.register.email).fill(who.email);
  await page.getByLabel(sl.register.password, { exact: true }).fill(who.password);
  await page.getByLabel(sl.register.confirmPassword).fill(who.password);
  await page.getByRole('button', { name: sl.register.submit }).click();
}

// The gym code is one shared row; repeats of a serial block can run on other workers at once.
test.describe('with the gym code set', { lock: 'registration-code' }, () => {
  test.describe.configure({ mode: 'serial' });

  test('a person registers with the gym code and the trainer assigns a session', async ({
    page,
    newGuardedPage,
    registrationCode,
    registrant,
    slotTemplate,
  }) => {
    await page.goto(`/registracija?koda=${encodeURIComponent(registrationCode)}`);
    await submitRegistration(page, registrant);
    await page.waitForURL(/\/c$/);
    await expect(page.getByText(sl.customer.noAppointmentsYet)).toBeVisible();

    const trainerPage = await newGuardedPage();
    await signIn(trainerPage, TRAINER);
    await trainerPage.goto('/t/stranke');
    await trainerPage.getByLabel(sl.customers.search).fill(registrant.name);
    const row = trainerPage
      .getByRole('region', { name: sl.customers.listTitle })
      .getByRole('listitem')
      .filter({ has: trainerPage.getByRole('link', { name: registrant.name }) });
    await expect(row.getByText(sl.customers.newTag, { exact: true })).toBeVisible();
    await row.getByRole('link', { name: registrant.name }).click();

    const rules = trainerPage.getByRole('region', { name: sl.customerDetail.rulesTitle });
    await rules.getByRole('button', { name: sl.customerDetail.addRule }).click();
    const form = rules.getByRole('form', { name: sl.customerDetail.addRuleLabel });
    await form.getByLabel(sl.customerDetail.ruleTemplate).selectOption(slotTemplate.id);
    await form.getByRole('button', { name: sl.customerDetail.addRule }).click();
    await expect(rules.getByRole('button', { name: sl.customerDetail.stopRule })).toBeVisible();

    await trainerPage.goto('/t/stranke');
    await trainerPage.getByLabel(sl.customers.search).fill(registrant.name);
    await expect(row.getByRole('link', { name: registrant.name })).toBeVisible();
    await expect(row.getByText(sl.customers.newTag, { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: sl.customer.upcomingTitle })).toBeVisible();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: slotTemplate.startTime })
        .filter({ has: page.getByRole('button', { name: sl.slot.cancel, exact: true }) })
        .first(),
    ).toBeVisible();
  });

  test('a wrong code is refused', async ({ page, registrationCode, registrant }) => {
    await page.goto(`/registracija?koda=${encodeURIComponent(`${registrationCode}-wrong`)}`);
    await submitRegistration(page, registrant);
    await expect(
      page.getByRole('alert').filter({ hasText: sl.errors.AMRAP_REGISTRATION_CLOSED }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/registracija/);
  });
});

test('the link without a code shows no form', async ({ page }) => {
  await page.goto('/registracija');
  await expect(page.getByText(sl.register.noCode)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: sl.register.submit })).toHaveCount(0);
});
