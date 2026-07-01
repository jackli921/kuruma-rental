import { expect, test } from '@playwright/test'

// #1099 quick-view: an operator peeks a booking's key facts inline on the calendar
// (hover to open a card, click to pin it, click the card to open the full detail
// page) instead of full-navigating on every event click. Runs on the project-default
// OPERATOR_OWNER `page` (Best Car Rental) against the seeded fixture.
//
// The seed mints UUID ids (db/seed-id.ts), so the detail URL carries a UUID, not the
// input slug. But renter names and booking codes are inserted literally, so we anchor
// on Best Car Rental's offset-0 ACTIVE booking (seed-data/bookings.ts
// `bk_demo_best_suv_sub`): renter "Chen Wei", code "B4N8RXY2". Its start is today, so
// it always falls inside this week's window regardless of when the smoke runs.
const RENTER_NAME = 'Chen Wei'
const BOOKING_CODE = 'B4N8RXY2'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

test('operator peeks then pins a booking quick-view card, then opens its detail page', async ({
  page,
}) => {
  // Week view renders booking chips (the default timeline view shows fleet rows, no
  // chips). No ?date -> this week, which contains the offset-0 booking.
  await page.goto('/en/manage/bookings?view=week')
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible()

  // The chip is a Popover trigger button titled with the renter. Best's calendar
  // carries exactly one Chen Wei event (their other bookings are on other tenants).
  const chip = page.getByRole('button', { name: new RegExp(RENTER_NAME) }).first()
  await expect(chip).toBeVisible({ timeout: 20_000 })

  // The booking code renders ONLY inside the open card, never in the chip title, so
  // it is the unambiguous proof the quick-view opened.
  const cardCode = page.getByText(BOOKING_CODE)
  await expect(cardCode).toBeHidden()

  await test.step('hover peeks the card', async () => {
    await chip.hover()
    // Opens after HOVER_OPEN_DELAY_MS (120ms); toBeVisible auto-waits past it.
    await expect(cardCode).toBeVisible()
  })

  await test.step('click pins the card so it survives the pointer leaving', async () => {
    await chip.click()
    // Move the pointer well away; a pinned card must stay open (a hover-only card
    // would close here).
    await page.mouse.move(0, 0)
    await expect(cardCode).toBeVisible()
  })

  await test.step('clicking the pinned card opens the full booking detail page', async () => {
    // The whole card is a TanStack <Link>; its accessible name carries the
    // view-details affordance.
    await page.getByRole('link', { name: /View full details/ }).click()
    await expect(page).toHaveURL(new RegExp(`/en/manage/bookings/${UUID}`))
  })
})
