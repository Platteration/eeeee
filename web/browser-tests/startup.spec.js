import { test, expect } from '@playwright/test';

test('a failed application module shows reload recovery without clearing saved data', async ({ page }) => {
  await page.route('**/src/photoRecovery.js', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#startup-message')).toContainText('could not start');
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await expect(page.locator('#startup-retry')).toBeVisible();
  await page.unroute('**/src/photoRecovery.js');
  await page.locator('#startup-retry').click();
  await expect(page.locator('#startup')).toBeHidden();
  await expect(page.locator('main')).not.toHaveAttribute('inert');
  await page.locator('#pool-photo-button').click();
  await expect(page.locator('#pool-photo')).toBeVisible();
});
