import { expect, test } from './fixtures';

// Temporary: proves that a failed CI run uploads the report and a trace. Reverted in the next commit.
test('deliberate failure', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/never-matches/, { timeout: 2000 });
});
