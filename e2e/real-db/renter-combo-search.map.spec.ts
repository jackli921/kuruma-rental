import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'

// #1423 (#464 follow-up). Covers acceptance #1's first clause — "a class deal *in
// search* links to the store page" — which the sibling renter-combo-booking spec
// cannot reach: that spec runs on the store-grid search view (VITE_SEARCH_MAP_ENABLED
// OFF) and enters the combo through the store's "Class deals" section instead.
//
// This spec runs on the map-enabled twin server (playwright.real-db.config.ts, the
// `authenticated-real-db-map` project / MAP_BASE_URL), where /search renders the
// map+list view and its CLASS_COMBO `ComboRow` card. It proves ONLY the discovery
// hop: search -> the Kei-class ComboRow -> its "View cars" CTA lands on the pickup
// store page. The booking journey past that point is already covered by the sibling,
// so this stays a focused, write-free navigation test (no bookings, no cleanup).
//
// Seed + selectors mirror the sibling: Best Car Rental / Namba is the only seeded
// location with ACTIVE class rate plans (seed-data/class-rate-plans.ts), so the Kei
// combo is the one deterministic CLASS_COMBO row for this window.
const STORE_NAME = 'Namba'
const CLASS_LABEL = 'Kei car'

// Real ids are UUIDs (db/seed-id.ts); asserting the store URL's shape also proves
// the ComboRow CTA carried a real locationId, not a slug or an empty segment.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// The same far-future window as the sibling: anchored to the 15th of the month TWO
// months out and computed RELATIVE TO TODAY, so the combo class always reads
// AVAILABLE and a hard-coded date can't silently rot into the demo-relative seed
// range as real time advances (#1401).
const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const NOW = new Date()
const WINDOW_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 2, 15))
const WINDOW_END = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 2, 17))
const FROM = `${isoDate(WINDOW_START)}T10:00`
const TO = `${isoDate(WINDOW_END)}T10:00`

test.describe('renter class-combo search discovery (real DB, map view)', () => {
  test('a class deal in search links to the pickup store page', async ({ browser, baseURL }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips

    const context = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const page = await context.newPage()

    await test.step('1. search renders the map+list view with the Kei-class ComboRow', async () => {
      await page.goto(`/en/search?from=${FROM}&to=${TO}`)
      await expect(page).toHaveURL(/\/search\?from=.+&to=.+/)

      // The map-enabled results view lists rows in <ul aria-label="Available cars">.
      // Scope every assertion to it: the map popup carousel renders the SAME ComboRow
      // on pin hover/select, so an unscoped locator would be strict-mode ambiguous.
      const list = page.getByRole('list', { name: 'Available cars' })
      await expect(list).toBeVisible({ timeout: 20_000 })

      // A CLASS_COMBO row titles its class in an <h3> (a SPECIFIC row puts the class
      // in a badge span and the car NAME in the <h3>), so the level-3 "Kei car"
      // heading uniquely targets the combo card. Exactly one such row exists — the
      // Namba Kei combo — so a count of 1 fails if the map view or the flat-search
      // combo read-side ever stops surfacing it.
      const comboCard = list
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: CLASS_LABEL, level: 3 }) })
      await expect(comboCard).toHaveCount(1)
      await expect(comboCard.getByText('Class deal')).toBeVisible()
      await expect(comboCard.getByText('Exact car assigned at pickup')).toBeVisible()

      // The CTA is the ComboRow's sole navigation affordance (#885 1b).
      await comboCard.getByRole('link', { name: 'View cars' }).click()
    })

    await test.step('2. the CTA lands on the pickup store page carrying the window', async () => {
      // The store URL keeps the search window (dates survive the drill-down, #885 1b)
      // and a real UUID locationId — proof the search card linked to a concrete store.
      await expect(page).toHaveURL(new RegExp(`/storefronts/${UUID}\\?from=.+&to=.+`))
      await expect(
        page.getByRole('heading', { name: STORE_NAME, level: 1, exact: true }),
      ).toBeVisible()
      // The store the combo pointed at exposes its own "Class deals" section — proof
      // the search card linked to the RIGHT storefront with its class context intact.
      await expect(page.getByRole('heading', { name: 'Class deals', level: 2 })).toBeVisible()
    })

    await context.close()
  })
})
