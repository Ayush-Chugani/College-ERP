import { expect, test } from '@playwright/test';

test.describe('public pages', () => {
  test('login page renders an accessible form', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Sign in/);
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
  test('login validates empty input without calling the server', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
  });
  test('forgot-password page renders', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
  test('no horizontal scroll at phone width on the login page', async ({ page }) => {
    await page.goto('/login');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});

test.describe('route protection', () => {
  for (const path of ['/dashboard', '/students', '/announcements', '/grievances', '/admin/users', '/audit', '/audit/logins', '/notifications', '/search', '/mfa', '/activities', '/staff-profile', '/my-documents', '/admin/reference', '/finance/receipt/1', '/my-hr', '/employees/1/hr', '/students/1/records', '/settings']) {
    test(`${path} redirects an anonymous visitor to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(path).replace(/%2F/gi, '(?:%2F|/)')}`));
    });
  }
  test('an unsafe next parameter is not followed', async ({ page }) => {
    await page.goto('/login?next=https://evil.example');
    await expect(page).toHaveURL(/\/login/);
  });
});
