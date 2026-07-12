import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// #1532: authenticated, real-DB coverage for operator fee schedules. The minted
// session cookie (auth.setup.ts) carries OPERATOR_OWNER + operatorId, so these
// flows exercise the real web -> real Hono API -> seeded Neon branch end to end.
//
// Fee schedules have NO free-text name column (they're keyed by operator + type +
// class), so the usual `E2E ` name-prefix cleanup can't apply. Instead every row
// this spec creates uses a sentinel amount well above any real/seeded fee
// (seed maxes at ¥5,000), and afterAll deletes by that sentinel range. The
// `"amountJpy"` identifier is camelCase in the schema, so the raw SQL quotes it.
const E2E_FEE_SENTINEL_MIN = 900_000
const ADD_AMOUNT = 990_001
const EDIT_AMOUNT = 990_002
// Assert on the grouped digits only: formatJpy renders a ja-JP yen glyph whose
// exact codepoint (¥ vs ￥) is an Intl detail we don't want to pin.
const ADD_AMOUNT_DIGITS = '990,001'
const EDIT_AMOUNT_DIGITS = '990,002'

test.describe('operator fees (authenticated, real DB)', () => {
  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM fee_schedules WHERE "amountJpy" >= ${E2E_FEE_SENTINEL_MIN}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner reaches /manage/fees and sees the seeded schedules (P1)', async ({ page }) => {
    await page.goto('/en/manage/fees')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/fees\/?$/)

    // The three seeded Best Car Rental operator-wide fees render as row headings
    // (seed-data/fees.ts). "Cleaning" and "Returned without fuel" are unique
    // labels; "Overtime" repeats (op-wide + SUV) so it's asserted via count.
    await expect(page.getByRole('heading', { name: 'Cleaning' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Returned without fuel' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Overtime' })).toHaveCount(2)
  })

  test('an empty amount shows a validation error on the amount field (P2)', async ({ page }) => {
    await page.goto('/en/manage/fees')
    await page.getByRole('button', { name: 'Add fee' }).click()

    const dialog = page.getByRole('dialog')
    // Clearing the amount makes react-hook-form pass NaN to the zod resolver, which
    // rejects it on the amountJpy field. A negative value can't be used here: the
    // input carries `min={0}`, so the browser blocks submit natively before zod runs.
    await dialog.locator('#fee-amount').fill('')
    await dialog.getByRole('button', { name: 'Save fee' }).click()

    // An empty number input reaches the zod resolver as NaN; assert the resolver's
    // rejection renders under the amount field (not a bare substring).
    const amountField = dialog.locator('#fee-amount').locator('xpath=..')
    await expect(amountField).toContainText('expected number, received NaN')
    // The invalid submit never wrote: the dialog stays open.
    await expect(dialog.getByRole('button', { name: 'Save fee' })).toBeVisible()
  })

  test('add -> edit -> archive a fee writes through to the DB (CRUD)', async ({ page }) => {
    await page.goto('/en/manage/fees')

    // ADD: a per-class Cleaning fee on the seeded "Compact" class — a free slot the
    // seed leaves open (its only Cleaning fee is operator-wide), so the active-fee
    // uniqueness seal doesn't reject it. The sentinel amount makes the row findable.
    await page.getByRole('button', { name: 'Add fee' }).click()
    const addDialog = page.getByRole('dialog')
    await addDialog.locator('#fee-class').click()
    await page.getByRole('option', { name: 'Compact' }).click()
    await addDialog.locator('#fee-amount').fill(String(ADD_AMOUNT))
    await addDialog.getByRole('button', { name: 'Save fee' }).click()
    await expect(page.getByText(ADD_AMOUNT_DIGITS)).toBeVisible()

    // EDIT: bump the amount; the list refetches so the new figure replaces the old.
    const addedRow = page.locator('div.border-border').filter({ hasText: ADD_AMOUNT_DIGITS })
    await addedRow.getByRole('button', { name: 'Edit fee' }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.locator('#fee-amount').fill(String(EDIT_AMOUNT))
    await editDialog.getByRole('button', { name: 'Save fee' }).click()
    await expect(page.getByText(EDIT_AMOUNT_DIGITS)).toBeVisible()
    await expect(page.getByText(ADD_AMOUNT_DIGITS)).toBeHidden()

    // ARCHIVE: status flips to Archived and the archive control disables on that row.
    const editedRow = page.locator('div.border-border').filter({ hasText: EDIT_AMOUNT_DIGITS })
    await editedRow.getByRole('button', { name: 'Archive fee' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(editedRow.getByText('Archived')).toBeVisible()
    await expect(editedRow.getByRole('button', { name: 'Archive fee' })).toBeDisabled()
  })
})
