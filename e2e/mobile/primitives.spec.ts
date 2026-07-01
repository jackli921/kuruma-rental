import { type BrowserContext, expect, test } from '@playwright/test'

// Mobile UX hardening gate (#1298, epic #1294). Runs ONLY on the mobile-safari
// project (real iPhone 13 / WebKit), where `@media (pointer: coarse)` matches and
// dvh resolves to the device viewport — so these prove the touch-target floor and
// the dialog-scroll behaviour on the browser phones actually run, which desktop
// Chromium and jsdom unit tests cannot.
//
// Two proofs live here:
//  - touch targets: every Button primitive clears the 44px floor on a phone.
//  - dialog scroll (#1306): a viewport-tall renter dialog caps at 90dvh, scrolls
//    an INNER region to its footer, and keeps the close button pinned (#1307).

const ONE_HOUR_S = 60 * 60

// The mock track has no real auth: mock-api.ts echoes the `e2e-mock-role` cookie
// as the session role on GET /auth/session, so the SPA's guards resolve it without
// a real token or DB (mirrors e2e/admin-portal.spec.ts).
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

// WCAG 2.5.5 / Apple HIG minimum touch target. The Button primitive lifts every
// size to this floor via `pointer-coarse:min-h-11` (44px). One sub-pixel of slack
// absorbs WebKit's fractional layout rounding.
const MIN_TOUCH_PX = 43.5

test.describe('mobile touch targets (#1298)', () => {
  // /en/search renders the storefront search form's submit through the Button
  // primitive (a default h-8/32px size), so on a phone it exercises the coarse
  // floor directly: without pointer-coarse:min-h-11 this button renders 32px and
  // the assertion fails — a real regression guard, not a tautology.
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

test.describe('mobile dialog scroll + pinned close (#1306 / #1307)', () => {
  // A short phone viewport (still iPhone 13 / WebKit, so coarse-pointer + mobile UA
  // persist) forces the tall CancelBookingDialog to exceed 90dvh. At the full 844px
  // height this dialog fits and the inner scroll never engages, so the height is
  // shrunk to make the scroll path genuinely exercise in-browser.
  test.use({ viewport: { width: 390, height: 420 } })

  test('a viewport-tall renter dialog scrolls to its footer with the close pinned', async ({
    context,
    page,
  }) => {
    await signInAs(context, 'RENTER')

    // Create a CONFIRMED booking through the mock so the confirmation page renders
    // the cancel control — its gate is isCancellationEnabled() (baked ON in the E2E
    // web server) + status CONFIRMED + a session csrfToken. The mock POST needs no
    // auth; `page.request` hits /api/bookings, which the Vite proxy rewrites to the
    // mock's /bookings, storing the row the confirmation loader then re-reads.
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

    // Open the dialog (trigger label = bookings.cancel.action).
    await page.getByRole('button', { name: 'Cancel booking' }).click()

    const content = page.locator('[data-slot="dialog-content"]')
    const scroll = page.locator('[data-slot="dialog-scroll"]')
    await expect(content).toBeVisible()

    const viewport = page.viewportSize()
    if (!viewport) throw new Error('viewport size unavailable')

    // (A) The popup is capped to the viewport (max-h-[90dvh]) — it never renders
    // taller than the screen. Drop the cap and this tall dialog measures its full
    // natural height (> the viewport), so this fails.
    const contentBox = await content.boundingBox()
    expect(contentBox, 'dialog popup has no box').not.toBeNull()
    expect(contentBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      viewport.height * 0.9 + 8,
    )

    // (B) At this height the body genuinely overflows — the honest precondition for
    // the scroll+pin behaviour. If it did not overflow the test would prove nothing;
    // shorten the viewport above until it does.
    const overflow = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(overflow, 'dialog body did not overflow — shorten the viewport').toBeGreaterThan(0)

    // (C) The close button is pinned OUTSIDE the scroll region (#1307): its offset
    // from the popup top is unchanged after the body scrolls to the bottom. Measured
    // in one frame relative to the popup so the open-zoom transform cancels out. A
    // body-nested close would move with the scroll; the pinned X does not.
    //
    // The DIRECT-child combinator matters: the footer's "Keep booking" DialogClose
    // also carries data-slot="dialog-close" and sits INSIDE the scroll region, so a
    // bare selector would grab it. Only the pinned X is a direct child of the popup.
    const closeOffsetFromTop = () =>
      page.evaluate(() => {
        const popup = document.querySelector('[data-slot="dialog-content"]')
        const close = popup?.querySelector(':scope > [data-slot="dialog-close"]')
        if (!popup || !close) return null
        return close.getBoundingClientRect().top - popup.getBoundingClientRect().top
      })
    const closeBefore = await closeOffsetFromTop()
    await scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    const closeAfter = await closeOffsetFromTop()
    expect(closeBefore, 'close offset unavailable').not.toBeNull()
    expect(closeAfter).not.toBeNull()
    expect(Math.abs((closeAfter ?? 0) - (closeBefore ?? 0))).toBeLessThan(1)
    // …and it stays pinned near the top (top-2 = 8px), never scrolled into the body.
    expect(closeAfter ?? Number.POSITIVE_INFINITY).toBeLessThan(40)

    // (D) With the body scrolled to the bottom, the destructive submit now sits
    // inside the capped popup — i.e. scrolling made the footer reachable rather than
    // leaving it clipped off-screen.
    const submitReachable = await page.evaluate(() => {
      const popup = document.querySelector('[data-slot="dialog-content"]')?.getBoundingClientRect()
      const submit = document
        .querySelector('[data-slot="dialog-footer"] button:last-of-type')
        ?.getBoundingClientRect()
      if (!popup || !submit) return false
      return submit.top >= popup.top - 2 && submit.bottom <= popup.bottom + 2
    })
    expect(submitReachable, 'submit not reachable inside the capped popup after scroll').toBe(true)
  })
})
