import { expect, test } from '@playwright/test';

/** Needs a real test user in a non-production Supabase project: E2E_EMAIL, E2E_PASSWORD, and NEXT_PUBLIC_SUPABASE_* pointing at it. Skipped otherwise. */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
test.skip(!email || !password, 'E2E_EMAIL / E2E_PASSWORD not set');

test('invalid credentials are rejected', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('nobody@example.invalid');
  await page.getByLabel(/password/i).fill('wrong-password-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('sign in, see the dashboard, sign out, and be locked out again', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email ?? '');
  await page.getByLabel(/password/i).fill(password ?? '');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
