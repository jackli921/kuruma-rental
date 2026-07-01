import { type BrowserContext, expect, test } from '@playwright/test'

const ONE_HOUR_S = 60 * 60

// The mock track has no real auth: mock-api.ts echoes the `e2e-mock-role` cookie
// as the session role on GET /auth/session, so a renter-gated page resolves it
// without a real token or DB (mirrors e2e/admin-portal.spec.ts).
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

// #1299 (epic #1294), Wave 2. The reservation wizard's running total + advance nav
// must be reachable on a phone without scrolling to the end of a long step. Runs on
// the mobile-safari (iPhone 13 / WebKit) project. A short viewport makes step 1
// exceed the screen, so this proves the bar is PINNED — not that a short step just
// happens to fit above the fold.
test.describe('mobile booking wizard summary bar (#1299)', () => {
  test.use({ viewport: { width: 390, height: 420 } })

  test('running total shows from step 1 and Continue stays pinned in view', async ({
    context,
    page,
  }) => {
    await signInAs(context, 'RENTER')
    // vehicleId + locationId are TEST_STOREFRONT_DETAIL fixtures; from/to are JST
    // datetime-local strings parseSearchRange accepts. 3 days x ¥4,500 daily rate
    // = ¥13,500 base (no add-ons selected yet).
    await page.goto(
      '/en/bookings/new?vehicleId=e2e-store-vehicle-1&locationId=e2e-store-1&from=2026-07-10T10:00&to=2026-07-13T10:00',
    )

    const bar = page.locator('[data-slot="reservation-summary-bar"]')
    await expect(bar).toBeVisible()

    // AC1: the running estimate total (3 days x ¥4,500 = 13,500) is visible from the
    // first step (dates), not only on Confirm. Match the digits, not the yen glyph:
    // WebKit's ICU formats JPY with the ASCII ¥ where Node's jsdom uses fullwidth ￥.
    await expect(bar.getByText(/13,500/)).toBeVisible()

    // AC2: the bar is pinned (position: sticky) so the advance action is reachable
    // without hunting. Removing the sticky bar (reverting to the end-of-flow nav)
    // fails both the CSS assertion and — on this short viewport where step 1
    // overflows — the in-viewport check.
    await expect(bar).toHaveCSS('position', 'sticky')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeInViewport()
  })
})
