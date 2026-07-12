import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #1536 messaging round-trip. Proves a message actually travels renter -> operator
// -> renter on the REAL Vite web -> Hono API -> seeded Postgres stack, across TWO
// authenticated actors, and that unread counts + read-receipts behave on BOTH
// sides. Messaging is a pre-GA gate (epic #1476) that had zero e2e coverage.
//
// The default `page` is the OPERATOR_OWNER (Best Car Rental); a second context
// carries RENTER_STORAGE_STATE (Sarah Smith), mirroring marketplace-happy-path.
//
// Thread-creation entry point (confirmed while implementing): a thread only exists
// once a booking commits — the API auto-creates it via `ensureThread` on the
// booking's post-commit seam, awaited before the response returns. There is NO
// caller-facing `POST /threads` (removed in #1386 as a spam vector). So the spec
// first books a car AS the renter (the same wizard marketplace-happy-path drives),
// then opens that booking's auto-created thread from the renter inbox (#1032).

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// Best Car Rental's KIX storefront — booking here scopes the thread's operatorId to
// Best Car Rental, the tenant the default OPERATOR_OWNER session read-scopes by.
const STOREFRONT_NAME = 'Kansai Airport (KIX)'
const OPERATOR_NAME = 'Best Car Rental'
const RENTER_NAME = 'Sarah Smith' // the operator thread heading resolves from booking.renter

// Unique per run so the assertions target THIS run's messages even if prior data
// lingers, and so the two directions never satisfy each other's text match.
const RUN = `${Date.now()}`
const RENTER_MSG = `Is the KIX counter staffed at 9am? [${RUN}]`
const OPERATOR_MSG = `Yes, staffed from 8am - see you there. [${RUN}]`

// A far-future window (+3 months), clear of the seeded near-term bookings AND of
// marketplace-happy-path's +2-month window, so the two specs never contend for the
// same KIX vehicle in one suite run. Computed relative to today (a hard-coded date
// silently rots into the seed range as real time advances).
const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const NOW = new Date()
const WINDOW_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 3, 15))
const WINDOW_END = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 3, 17))
const FROM = `${isoDate(WINDOW_START)}T10:00`
const TO = `${isoDate(WINDOW_END)}T10:00`

// bookingId(s) this run creates, torn down in afterAll. Deleting a thread cascades
// its messages + thread_participants (ON DELETE CASCADE), so the thread delete is
// enough for the messaging rows.
const createdBookingIds: string[] = []

test.describe('messaging round-trip - renter <-> operator (real DB)', () => {
  test.afterAll(cleanup)

  test('renter sends -> operator sees/reads/replies -> renter sees the reply', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000) // Vite builds each route on first hit; two actors, real round-trips

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()

    let threadId = ''

    await test.step('setup: renter books a KIX car (the commit auto-creates the thread)', async () => {
      // Minimal replay of marketplace-happy-path steps 1-5: search -> storefront ->
      // vehicle -> 5-step wizard -> instant-book. ensureThread runs synchronously on
      // the post-commit seam, so the thread exists by the time the confirmation loads.
      await renter.goto(`/en/search?from=${FROM}&to=${TO}`)
      const storefront = renter.getByRole('link').filter({ hasText: STOREFRONT_NAME }).first()
      await expect(storefront).toBeVisible({ timeout: 20_000 })
      await storefront.click()
      await expect(renter.getByRole('heading', { name: STOREFRONT_NAME })).toBeVisible()
      await expect(renter.getByText(OPERATOR_NAME).first()).toBeVisible()

      await renter.getByRole('link', { name: 'Book this car' }).first().click()
      await expect(renter.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // dates -> addOns
      await expect(renter.getByText('Add optional extras')).toBeVisible()
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // addOns -> insurance
      await expect(renter.getByText('No insurance')).toBeVisible()
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // insurance -> confirm
      await expect(renter.getByText('Review your booking')).toBeVisible()
      await renter.getByRole('button', { name: 'Continue to payment' }).click() // confirm -> payment
      await expect(renter.getByRole('heading', { name: 'Confirm and reserve' })).toBeVisible()
      await renter.getByRole('checkbox').check() // liability-disclaimer consent (#613)
      await renter.getByRole('button', { name: 'Reserve now' }).click() // instant-book submit

      await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
      const bookingId = new URL(renter.url()).searchParams.get('bookingId') ?? ''
      expect(bookingId).toMatch(new RegExp(`^${UUID}$`))
      createdBookingIds.push(bookingId)

      // Resolve the auto-created thread precisely by bookingId. (The confirmation
      // page's "Message host" deep-link (#1032) shares the nav unread-badge's
      // threads cache, still within its 30s staleTime right after booking, so it
      // can lag a beat there — a product quirk, not this spec's concern. Each inbox
      // visit below is a full page load that refetches, so it never bites there.)
      threadId = await threadIdForBooking(bookingId)
      expect(threadId, 'ensureThread should create the booking thread on commit').toMatch(
        new RegExp(`^${UUID}$`),
      )
    })

    const operatorRow = () => page.locator(`a[href$="/manage/messages/${threadId}"]`)
    const renterRow = () => renter.locator(`a[href$="/messages/${threadId}"]`)

    await test.step('1. renter opens the booking thread from the inbox and sends', async () => {
      // Entry point: the renter inbox lists the booking's thread (a no-message thread
      // still shows). A full load refetches GET /threads, so the row is present.
      await renter.goto('/en/messages')
      await expect(renter.getByRole('heading', { name: 'Messages' })).toBeVisible()
      await renterRow().click()
      await expect(renter).toHaveURL(new RegExp(`/messages/${threadId}`))

      await renter.getByLabel('Compose message').fill(RENTER_MSG)
      await renter.getByRole('button', { name: 'Send' }).click()
      // The send invalidates the thread cache; the refetch is the source of truth,
      // so the sent line reappears as the renter's OWN bubble.
      await expect(
        renter.locator('li[data-own="true"]').filter({ hasText: RENTER_MSG }),
      ).toBeVisible({ timeout: 20_000 })
    })

    await test.step('2. operator sees the thread unread at /manage/messages', async () => {
      await page.goto('/en/manage/messages')
      await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()
      // Tenant-level operator unread badge (operatorUnreadCount), bumped by the
      // renter send. Scoped to THIS thread's row so another thread can't satisfy it.
      await expect(operatorRow().locator('output[aria-label="1 unread"]')).toBeVisible({
        timeout: 20_000,
      })
      await expect(operatorRow()).toContainText(RENTER_MSG)
    })

    await test.step('3. operator opens it; unread clears; renter message shows as a counterpart bubble', async () => {
      await operatorRow().click()
      await expect(page).toHaveURL(new RegExp(`/manage/messages/${threadId}`))
      await expect(page.getByRole('heading', { name: RENTER_NAME })).toBeVisible() // from booking.renter
      await expect(
        page.locator('li[data-own="false"]').filter({ hasText: RENTER_MSG }),
      ).toBeVisible()
      // Opening marks the thread read (ConversationView mount) -> the inbox badge drops.
      // Re-navigate under toPass so the best-effort read POST has time to land.
      await expect(async () => {
        await page.goto('/en/manage/messages')
        await expect(operatorRow()).toBeVisible()
        await expect(operatorRow().locator('output')).toHaveCount(0)
      }).toPass({ timeout: 15_000 })
    })

    await test.step('4. operator replies', async () => {
      await page.goto(`/en/manage/messages/${threadId}`)
      await page.getByLabel('Compose message').fill(OPERATOR_MSG)
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(
        page.locator('li[data-own="true"]').filter({ hasText: OPERATOR_MSG }),
      ).toBeVisible({ timeout: 20_000 })
    })

    await test.step('5. renter sees the reply unread, opens it, unread clears', async () => {
      await renter.goto('/en/messages')
      await expect(renter.getByRole('heading', { name: 'Messages' })).toBeVisible()
      // Per-participant renter unread, bumped by the operator reply.
      await expect(renterRow().locator('output[aria-label="1 unread"]')).toBeVisible({
        timeout: 20_000,
      })

      await renterRow().click()
      await expect(renter).toHaveURL(new RegExp(`/messages/${threadId}`))
      // Full transcript: the renter's own first message + the operator's reply.
      await expect(
        renter.locator('li[data-own="true"]').filter({ hasText: RENTER_MSG }),
      ).toBeVisible()
      await expect(
        renter.locator('li[data-own="false"]').filter({ hasText: OPERATOR_MSG }),
      ).toBeVisible()

      await expect(async () => {
        await renter.goto('/en/messages')
        await expect(renterRow()).toBeVisible()
        await expect(renterRow().locator('output')).toHaveCount(0)
      }).toPass({ timeout: 15_000 })
    })

    await test.step('6. renter translates the operator reply (optional)', async () => {
      await renter.goto(`/en/messages/${threadId}`)
      const reply = renter.locator('li[data-own="false"]').filter({ hasText: OPERATOR_MSG })
      await reply.getByRole('button', { name: 'Translate' }).click()
      // Local/e2e sets no GOOGLE_TRANSLATE_API_KEY, so the provider is the dev stub
      // `[<lang>] <text>` (translation-provider-factory) - deterministic and offline.
      await expect(reply).toContainText(`[en] ${OPERATOR_MSG}`)
      await expect(reply.getByRole('button', { name: 'Show original' })).toBeVisible()
    })

    await renterContext.close()
  })
})

/**
 * The auto-created thread's id for a booking (ensureThread, on the booking's
 * post-commit seam). Polls like marketplace-happy-path's notification poll: the
 * post-commit effects (thread + notifications) are eventually-consistent from the
 * client's view, so read until the thread lands rather than assuming it is there
 * the instant the confirmation page paints.
 */
async function threadIdForBooking(bookingId: string): Promise<string> {
  const sql = testSql()
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM threads WHERE "bookingId" = ${bookingId}
      `
      const id = rows[0]?.id
      if (id) return id
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return ''
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Delete the bookings this spec created; the thread delete cascades its messages. */
async function cleanup(): Promise<void> {
  if (createdBookingIds.length === 0) return
  const sql = testSql()
  try {
    const ids = createdBookingIds
    await sql`DELETE FROM notification_log WHERE "bookingId" IN ${sql(ids)}`
    await sql`DELETE FROM booking_events WHERE "bookingId" IN ${sql(ids)}`
    // payment_events has no ON DELETE CASCADE — the confirmation step writes one per
    // booking, so clear it before the booking or the delete below 23503s.
    await sql`DELETE FROM payment_events WHERE "bookingId" IN ${sql(ids)}`
    await sql`DELETE FROM threads WHERE "bookingId" IN ${sql(ids)}` // cascades messages + participants
    await sql`DELETE FROM bookings WHERE id IN ${sql(ids)}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
