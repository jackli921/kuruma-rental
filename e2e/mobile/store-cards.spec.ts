import { expect, test } from '@playwright/test'

// Mobile UX hardening, Search store cards (#1302, epic #1294 Wave 2). Runs ONLY on
// the mobile-safari project (real iPhone 13 / WebKit, 390px wide) — the #1294 gate.
// The flag-default search surface is the store grid, and a store has no image
// field, so each card renders the store's own initials as a branded fallback tile
// rather than the earlier generic glyph, which read as empty/unfinished on mobile.
// Store name + card come from the e2e/mock-api.ts storefront fixture.
const STORE_NAME = 'Best Car Rental Osaka'

test.describe('mobile search store cards (#1302)', () => {
  test('renders a branded monogram tile, not a bare glyph, and fits the 390px card', async ({
    page,
  }) => {
    await page.goto('/en/search')

    // No range in the URL -> beforeLoad seeds a default JST range and redirects,
    // so results auto-run (mirrors storefront-search.spec.ts).
    await expect(page).toHaveURL(/\/en\/search\?from=.+&to=.+/)

    const card = page.getByRole('link', { name: new RegExp(STORE_NAME) })
    await expect(card).toHaveCount(1)

    // The fallback hero is the store's own initials on a labelled tile — a
    // deliberate visual (#1302), not a bare placeholder glyph.
    const tile = card.getByRole('img', { name: 'Store location' })
    await expect(tile).toBeVisible()
    await expect(tile).toHaveText('BC')

    // No vehicle photo masquerades as the store hero (#955), and the card stays
    // within the phone's viewport width.
    await expect(card.locator('img')).toHaveCount(0)
    const box = await card.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(box?.width ?? 0).toBeLessThanOrEqual(viewport?.width ?? 0)
  })
})
