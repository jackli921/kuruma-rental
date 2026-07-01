import { expect, test } from '@playwright/test'

// Mobile UX hardening gate (#1298, epic #1294). Runs ONLY on the mobile-safari
// project (real iPhone 13 / WebKit), where `@media (pointer: coarse)` matches —
// so this proves the touch-target floor renders on the browser phones actually
// run, which desktop Chromium and jsdom unit tests cannot.
//
// The dialog-scroll half of #1298 (max-h-[90dvh] + overflow-y-auto on
// DialogContent) is proven deterministically by the class-contract unit test
// (src/components/ui/dialog.test.tsx). An in-browser scroll test needs a dialog
// genuinely taller than the viewport; the only dialog cheaply reachable in the
// mock lane (admin OperatorCreateDialog, ~292px) is too short to overflow a real
// phone, and a tall renter dialog (CancelBookingDialog) needs a renter trips-list
// mock this lane does not have yet. That belongs to the renter-trips mobile
// sibling of #1294 — tracked as a follow-up — not a cross-context admin reach here.

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
