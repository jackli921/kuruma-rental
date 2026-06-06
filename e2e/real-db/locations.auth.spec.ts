import { expect, test } from '@playwright/test'

// #416: authenticated, real-DB coverage for operator locations. The minted
// session cookie (auth.setup.ts) carries OPERATOR_OWNER + operatorId, so these
// flows exercise the real web -> real Hono API -> seeded Neon branch end to end.
test.describe('operator locations (authenticated, real DB)', () => {
  test('owner reaches /manage/locations and sees the seeded storefronts (P1)', async ({ page }) => {
    await page.goto('/en/manage/locations')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/locations\/?$/)

    // The three seeded Best Car Rental storefronts render.
    await expect(page.getByText('Namba Store')).toBeVisible()
    await expect(page.getByText('Umeda Store')).toBeVisible()
    await expect(page.getByText('Kansai Airport Counter')).toBeVisible()
  })
})
