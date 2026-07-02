import { expect, test } from '@playwright/test'

// Mobile UX hardening, Header/nav (#1300, epic #1294 Wave 2). Runs ONLY on the
// mobile-safari project (real iPhone 13 / WebKit, 390px wide) — the #1294 gate.
// Covers the three ACs from the end-user path: the logged-out drawer now carries a
// public Browse link (not just "Log in"); the header's icon-only menu + language
// controls meet the 44px WCAG 2.5.5 touch floor; and the product brand is "Kuruma"
// everywhere (no leaked seed-operator name on the sign-in screen).
const TOUCH_TARGET_MIN = 44

test.describe('mobile header/nav (#1300)', () => {
  test('menu and language controls meet the 44px touch floor', async ({ page }) => {
    await page.goto('/en/search')
    await expect(page).toHaveURL(/\/en\/search\?from=.+&to=.+/)

    for (const name of ['Menu', 'Language']) {
      const control = page.getByRole('button', { name })
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box, `${name} control has a box`).not.toBeNull()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN)
    }
  })

  test('logged-out drawer exposes the public Browse link, not just Log in', async ({ page }) => {
    await page.goto('/en/search')
    await expect(page).toHaveURL(/\/en\/search\?from=.+&to=.+/)

    await page.getByRole('button', { name: 'Menu' }).click()

    // The drawer is no longer empty: a signed-out visitor gets the Browse funnel
    // link (-> /en/search) alongside the existing Log in action.
    const browse = page.getByRole('link', { name: 'Browse' })
    await expect(browse).toBeVisible()
    await expect(browse).toHaveAttribute('href', /\/en\/search$/)
    await expect(page.getByRole('link', { name: /log in/i })).toBeVisible()
  })

  test('sign-in screen uses the Kuruma product brand, not the seed operator name', async ({
    page,
  }) => {
    await page.goto('/en/login')
    await expect(page.getByText('Continue to Kuruma Rental')).toBeVisible()
    await expect(page.getByText('Best Car Rental')).toHaveCount(0)
  })
})
