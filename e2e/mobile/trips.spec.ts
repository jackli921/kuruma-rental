import { type BrowserContext, expect, test } from '@playwright/test'

// Mobile UX hardening, Trips surface (#1301, epic #1294 Wave 2). Runs ONLY on the
// mobile-safari project (real iPhone 13 / WebKit), where `@media (pointer: coarse)`
// matches — so these prove the touch-target floor and no-overflow behaviour on the
// browser phone that actually runs, which desktop Chromium and jsdom cannot.

const ONE_HOUR_S = 60 * 60

// WCAG 2.5.5 / Apple HIG minimum touch target; one sub-pixel of slack absorbs
// WebKit's fractional layout rounding (mirrors primitives.spec.ts).
const MIN_TOUCH_PX = 43.5

// Mock track has no real auth: mock-api.ts echoes the `e2e-mock-role` cookie as the
// session role on GET /auth/session (mirrors primitives.spec.ts / admin-portal).
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

test.describe('mobile trips date range (#1301)', () => {
  // A narrow phone makes the ~45-char EN date range ("Jul 1, 2026, 10:00 AM – Jul
  // 14, 2026, 10:00 AM") wider than the card's content box. With whitespace-nowrap
  // that string forced the card to overflow horizontally; allowing it to wrap at the
  // separator (each date stays a nowrap unit) keeps the card within its width.
  test.use({ viewport: { width: 360, height: 780 } })

  test('the booking date range wraps instead of overflowing the card', async ({
    context,
    page,
  }) => {
    await signInAs(context, 'RENTER')
    await page.goto('/en/bookings')

    const card = page.locator('li', { hasText: 'E2ETRIP1' })
    await expect(card).toBeVisible()

    // The card content never exceeds its own box: with the pre-#1301 nowrap the date
    // string forces scrollWidth past clientWidth (horizontal overflow); wrapping keeps
    // them equal. 1px absorbs WebKit's fractional rounding.
    const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

test.describe('mobile trips touch targets (#1301)', () => {
  test('each cancel-reason radio row clears the 44px touch floor', async ({ context, page }) => {
    await signInAs(context, 'RENTER')

    // Create a CONFIRMED booking through the mock so the confirmation page renders the
    // cancel control (gate: isCancellationEnabled(), baked ON in the E2E web server +
    // CONFIRMED status + session csrfToken). Mirrors primitives.spec.ts (#1306).
    const created = await page.request.post('/api/bookings', {
      data: {
        requestedVehicleId: 'e2e-test-vehicle-1',
        pickupLocationId: 'e2e-store-1',
        dropoffLocationId: 'e2e-store-1',
        insuranceOptionId: 'e2e-ins-1',
        startAt: '2027-06-01T10:00:00.000Z',
        endAt: '2027-06-03T10:00:00.000Z',
      },
    })
    expect(created.ok(), 'mock POST /bookings failed').toBe(true)
    const { data: booking } = (await created.json()) as { data: { id: string } }

    await page.goto(`/en/bookings/confirmation?bookingId=${booking.id}`)
    await page.getByRole('button', { name: 'Cancel booking' }).click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible()
    // Let the open-zoom settle so boundingBox reflects the final (unscaled) height,
    // not a mid-transition frame — base-ui animates the popup in on open, and a
    // scaled frame reads ~1.5% short of the 44px floor.
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    )

    // Each reason row is a full-width <label> wrapping a radio; the label is the tap
    // target. Without pointer-coarse:min-h-11 the row is ~20px (a 16px input) and this
    // fails — a real regression guard.
    const rows = dialog.locator('label:has(input[type="radio"])')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const box = await rows.nth(i).boundingBox()
      expect(box, `reason row #${i} has no box`).not.toBeNull()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    }
  })
})
