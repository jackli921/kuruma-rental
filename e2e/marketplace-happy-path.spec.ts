import { type Page, expect, test } from '@playwright/test'

// Marketplace MVP acceptance journey — the §6.1 merge gate for slice 8 (#390):
// "renter search -> storefront result -> vehicle selection -> book ->
//  confirmation notification visible in operator portal".
//
// This is a SKELETON. Steps 1-2 (search + storefront) render against slice-5
// pages that already exist; steps 3-5 (insurance selection, booking with a
// no-confusables code + fee snapshot, operator-portal notification) depend on
// slice 6/7 UI + API that are NOT yet merged. The whole journey is therefore
// test.fixme() until 6/7 land — un-fixme step by step as each slice ships.
//
// Mock-API read track: every endpoint is stubbed in e2e/mock-api.ts (no Postgres).
// Fixture values below mirror that stub exactly; assertions are mutation-resistant
// (specific text / URL / role queries — never bare toBeVisible() truthiness).

const STORE_ID = 'e2e-store-1'
const STORE_NAME = 'Best Car Rental Osaka'
const OPERATOR_NAME = 'Best Car Rental'
const PICKUP = '2026-07-01T10:00'
const RETURN = '2026-07-03T10:00'

// The seeded CCAR vehicle in the storefront-detail fixture.
const VEHICLE_NAME = 'E2E Honda Fit'
const LICENSE_PLATE = 'なにわ 300 あ 12-34'
const DAILY_RATE = '¥4,500'

// No-confusables booking code (plan §9 item 3). POST /bookings returns 'H7K2M9PQ'.
const BOOKING_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/
const PREAUTH_URL = 'https://pay.example.com/preauth/e2e-booking-1'

// Runs the full acceptance journey on whichever device the calling test selects
// (desktop / mobile, per proposal §8.2). Returns the booking code captured at
// confirmation so step 5 can match it in the operator portal.
async function bookThroughStorefront(page: Page): Promise<string> {
  await test.step('1. Search surfaces the operator storefront card', async () => {
    await page.goto('/en/search')
    await page.locator('#from').fill(PICKUP)
    await page.locator('#to').fill(RETURN)
    await page.getByRole('button', { name: 'Search' }).click()

    await expect(page).toHaveURL(/\/en\/search\?from=.+&to=.+/)
    const card = page.getByRole('link', { name: new RegExp(STORE_NAME) })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(OPERATOR_NAME)
    await expect(page.getByText('Compact ×4')).toBeVisible()
    await expect(page.getByText('From ¥4,500 / day')).toBeVisible()
  })

  await test.step('2. Storefront result lists vehicles for the range', async () => {
    await page
      .getByRole('link', { name: new RegExp(STORE_NAME) })
      .first()
      .click()
    await expect(page).toHaveURL(new RegExp(`/en/storefronts/${STORE_ID}\\?from=.+&to=.+`))
    await expect(page.getByRole('heading', { level: 1, name: STORE_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: VEHICLE_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'E2E Toyota Sienta' })).toBeVisible()
  })

  await test.step('3. Vehicle selection shows plate, price + 2 insurance options', async () => {
    await page.getByRole('button', { name: new RegExp(`Select ${VEHICLE_NAME}`) }).click()
    const panel = page.getByRole('region', { name: 'Selected vehicle' })
    await expect(panel).toContainText(LICENSE_PLATE)
    await expect(panel.getByText(DAILY_RATE)).toBeVisible()

    // Exactly the operator's two options — no more, no less.
    const insurance = page.getByRole('combobox', { name: 'Insurance' })
    await expect(insurance.getByRole('option')).toHaveCount(2)
    await expect(insurance.getByRole('option', { name: 'Normal' })).toHaveCount(1)
    await expect(insurance.getByRole('option', { name: 'Premium' })).toHaveCount(1)
  })

  let bookingCode = ''
  await test.step('4. Booking confirms with a code, fee snapshot + pre-auth link', async () => {
    await page.getByRole('combobox', { name: 'Insurance' }).selectOption({ label: 'Premium' })
    await page.getByLabel('Email').fill('renter@example.com')
    await page.getByLabel('Full name').fill('Test Renter')
    await page.getByLabel('Phone').fill('+81 90 1234 5678')
    await page.getByLabel('Language').selectOption('en')
    await page.getByRole('button', { name: 'Confirm booking' }).click()

    await expect(page).toHaveURL(/\/booking\//)
    bookingCode = (await page.getByTestId('booking-code').innerText()).trim()
    expect(bookingCode).toMatch(BOOKING_CODE_RE)

    await expect(page.getByText(VEHICLE_NAME)).toBeVisible()
    await expect(page.getByText('Premium')).toBeVisible()
    await expect(page.getByRole('link', { name: /pre-?auth/i })).toHaveAttribute(
      'href',
      PREAUTH_URL,
    )

    // Snapshotted "potential additional charges" (slice 4b fees).
    const charges = page.getByRole('region', { name: 'Potential additional charges' })
    await expect(charges).toContainText('¥1,000')
    await expect(charges).toContainText('¥5,000')
    await expect(charges).toContainText('¥3,000')
  })

  return bookingCode
}

test.describe('Marketplace happy path (§6.1 merge gate)', () => {
  test.fixme('renter books a car and the operator sees the confirmation', async ({ page }) => {
    const bookingCode = await bookThroughStorefront(page)

    await test.step('5. Operator portal shows the booking + sent notification', async () => {
      // TODO(slice 7): replace with the operator-session helper (sets owner JWT).
      await page.goto('/manage/bookings')
      const row = page.getByRole('row', { name: new RegExp(bookingCode) })
      await expect(row).toHaveCount(1)

      await expect(page.getByTestId('notification-badge')).toHaveText('1')
      await expect(
        page.getByRole('row', { name: new RegExp(bookingCode) }).getByText('sent'),
      ).toBeVisible()
    })
  })
})

// Mobile variant (proposal §8.2: iPhone / Android Chrome). Same journey, no
// operator portal step — confirmation visibility on small screens is the point.
// Viewport-only override (our single project is chromium); a phone preset would
// force a webkit browser type, which describe-level use() forbids.
const PHONE_VIEWPORT = { width: 390, height: 844 }

test.describe('Marketplace happy path — mobile (§8.2)', () => {
  test.use({ viewport: PHONE_VIEWPORT, isMobile: true, hasTouch: true })

  test.fixme('renter completes the booking on a phone viewport', async ({ page }) => {
    const bookingCode = await bookThroughStorefront(page)
    expect(bookingCode).toMatch(BOOKING_CODE_RE)
  })
})
