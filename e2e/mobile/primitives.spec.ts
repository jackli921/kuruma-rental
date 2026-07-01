import { type BrowserContext, expect, test } from '@playwright/test'

// Mobile UX hardening gate (#1298, epic #1294). Runs ONLY on the mobile-safari
// project (real iPhone 13 / WebKit), where `@media (pointer: coarse)` matches —
// so these prove the touch-target floor and dialog scroll on the browser phones
// actually run, which desktop Chromium + jsdom unit tests cannot.

// WCAG 2.5.5 / Apple HIG minimum touch target. The Button primitive lifts every
// size to this floor via `pointer-coarse:min-h-11` (44px). One sub-pixel of
// slack absorbs WebKit's fractional layout rounding.
const MIN_TOUCH_PX = 43.5

const ONE_HOUR_S = 60 * 60

// Mock track: mock-api.ts echoes the `e2e-mock-role` cookie as the session role,
// so the admin guard resolves without a real token (see admin-portal.spec.ts).
async function signInAs(context: BrowserContext, role: string): Promise<void> {
  await context.addCookies([
    {
      name: 'e2e-mock-role',
      value: role,
      domain: 'localhost',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
    },
  ])
}

test.describe('mobile touch targets (#1298)', () => {
  // /en/search renders the storefront search form's submit through the Button
  // primitive (a default h-8/32px size), so on a phone it exercises the coarse
  // floor: without pointer-coarse:min-h-11 this button renders 32px and fails.
  test('every Button primitive clears the 44px floor on a phone', async ({ page }) => {
    await page.goto('/en/search')

    const buttons = page.locator('[data-slot="button"]:visible')
    await expect(buttons.first()).toBeVisible()
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox()
      expect(box, `button #${i} has no box`).not.toBeNull()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    }
  })
})

test.describe('mobile dialog scroll (#1298)', () => {
  test('a dialog is capped to the viewport and its footer stays reachable', async ({
    context,
    page,
  }) => {
    await signInAs(context, 'PLATFORM_ADMIN')
    await page.goto('/en/admin/operators')

    await page.getByRole('button', { name: 'Create operator' }).click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible()

    // Capped at 90dvh: it never spills past the screen edges on a small phone.
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + 1)

    // Its own overflow scrolls, so the submit stays reachable at any height.
    expect(await dialog.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
    const submit = dialog.getByRole('button', { name: 'Create', exact: true })
    await submit.scrollIntoViewIfNeeded()
    await expect(submit).toBeVisible()
  })
})
