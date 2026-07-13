import { expect, test } from '@playwright/test'

test.describe('Operator registration', () => {
  // Sign-in-first onboarding (#877): /business/register no longer accepts an
  // anonymous application. A signed-out visitor is redirected to login (carrying
  // returnTo), and only then applies from inside their account. The authenticated
  // happy path is covered in e2e/real-db/operator-onboarding.auth.spec.ts, which
  // can mint a real renter session; the mock lane guards the redirect gate so the
  // form can never leak to anonymous callers again.
  test('redirects anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/en/business/register')

    await expect(page).toHaveURL(/\/en\/login/)
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  })
})
