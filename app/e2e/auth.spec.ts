import type { Request } from '@playwright/test';
import { sl } from '../src/i18n/sl';
import { LOCAL_HOSTS } from './env';
import { expect, signIn, test, TRAINER } from './fixtures';

test('the trainer signs in and lands on /t', async ({ page }) => {
  await signIn(page, TRAINER);
  await expect(page).toHaveURL(/\/t$/);
});

test('a customer signs in and lands on /c', async ({ page, customer }) => {
  await signIn(page, customer);
  await expect(page).toHaveURL(/\/c$/);
});

test('a wrong password shows the sign-in error', async ({ page, customer }) => {
  await page.goto('/login');
  await page.getByLabel(sl.login.email).fill(customer.email);
  await page.getByLabel(sl.login.password).fill(`${customer.password}-wrong`);
  await page.getByRole('button', { name: sl.login.submit }).click();
  await expect(page.getByRole('alert')).toHaveText(sl.authErrors.invalid_credentials);
  await expect(page).toHaveURL(/\/login$/);
});

test('a customer who opens /t is sent to /c', async ({ page, customer }) => {
  await signIn(page, customer);
  await page.goto('/t');
  await expect(page).toHaveURL(/\/c$/);
});

test('the app only talks to the local Supabase stack', async ({ page, customer }) => {
  const apiRequests: Request[] = [];
  page.on('request', (request) => {
    if (/\/(auth|rest)\/v1\//.test(request.url())) apiRequests.push(request);
  });

  await signIn(page, customer);

  const urls = apiRequests.map((request) => new URL(request.url()));
  expect(urls.some((url) => url.pathname.startsWith('/auth/v1/'))).toBe(true);
  expect(urls.some((url) => url.pathname.startsWith('/rest/v1/'))).toBe(true);
  for (const url of urls) expect(LOCAL_HOSTS).toContain(url.hostname);
});
