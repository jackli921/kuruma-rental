import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// #464 slice 7: authenticated, real-DB coverage for operator combo deals (class
// rate plans). The minted session cookie (auth.setup.ts) carries OPERATOR_OWNER +
// operatorId (Best Car Rental), so these flows exercise the real web -> real Hono
// API -> seeded Neon branch end to end.
//
// Combo deals carry a free-text `label`, so this spec cleans up by an `E2E ` label
// prefix (mirroring the locations spec). The row is also found by a sentinel day
// rate well above any seeded combo (seed maxes at ¥14,000) so it never collides
// with a real row on screen.
const E2E_LABEL_PREFIX = 'E2E '
const ADD_RATE = 990_001
// Assert on the grouped digits only: formatJpy renders a ja-JP yen glyph whose
// exact codepoint (¥ vs ￥) is an Intl detail we don't want to pin.
const ADD_RATE_DIGITS = '990,001'

test.describe('operator combo deals (authenticated, real DB)', () => {
  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM class_rate_plans WHERE label LIKE ${`${E2E_LABEL_PREFIX}%`}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner reaches /manage/combo-deals and sees the seeded deals (P1)', async ({ page }) => {
    await page.goto('/en/manage/combo-deals')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/combo-deals\/?$/)

    // The three seeded Best Car Rental combo deals at Namba render as row headings
    // (their resolved class name), plus their internal labels (seed-data/class-rate-plans.ts).
    await expect(page.getByText('Kei Class Deal — Namba')).toBeVisible()
    await expect(page.getByText('Compact Class Deal — Namba')).toBeVisible()
    await expect(page.getByText('SUV Class Deal — Namba')).toBeVisible()
  })

  test('add -> toggle inactive -> delete a deal writes through to the DB (CRUD)', async ({
    page,
  }) => {
    const label = `${E2E_LABEL_PREFIX}Kei Shin-Osaka ${Date.now()}`
    await page.goto('/en/manage/combo-deals')

    // ADD: "Kei car" class at the "Shin-Osaka" location — a free (class, location)
    // slot the seed leaves open (its only deals are at Namba), so the per-scope
    // uniqueness seal doesn't 409. The sentinel rate makes the row findable.
    await page.getByRole('button', { name: 'Add deal' }).click()
    const addDialog = page.getByRole('dialog')
    await addDialog.locator('#combo-class').click()
    await page.getByRole('option', { name: 'Kei car' }).click()
    await addDialog.locator('#combo-location').click()
    await page.getByRole('option', { name: 'Shin-Osaka' }).click()
    await addDialog.locator('#combo-rate').fill(String(ADD_RATE))
    await addDialog.locator('#combo-label').fill(label)
    await addDialog.getByRole('button', { name: 'Save deal' }).click()

    // The row appears with its label and the formatted yen rate, badged Active.
    await expect(page.getByText(label)).toBeVisible()
    const row = page.getByTestId('combo-row').filter({ hasText: label })
    await expect(row.getByText(ADD_RATE_DIGITS)).toBeVisible()
    await expect(row.getByText('Active')).toBeVisible()

    // TOGGLE: deactivate flips the badge to Inactive (a direct PATCH, no dialog).
    await row.getByRole('button', { name: 'Deactivate deal' }).click()
    await expect(row.getByText('Inactive')).toBeVisible()
    // The toggle control now offers to re-activate it.
    await expect(row.getByRole('button', { name: 'Activate deal' })).toBeVisible()

    // DELETE: hard-remove; confirm in the dialog and the row disappears. Assert on
    // the row locator (not the bare label text — the confirm dialog's "Delete
    // {label}?" title also contains it, which would trip strict mode).
    await row.getByRole('button', { name: 'Delete deal' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(row).toHaveCount(0)
  })

  test('a duplicate (class, location) scope surfaces the already-exists banner (P2)', async ({
    page,
  }) => {
    await page.goto('/en/manage/combo-deals')

    // The seed already has a Kei deal at Namba, so re-creating that exact scope must
    // 409 and render the duplicate banner rather than writing a second row.
    await page.getByRole('button', { name: 'Add deal' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#combo-class').click()
    await page.getByRole('option', { name: 'Kei car' }).click()
    await dialog.locator('#combo-location').click()
    await page.getByRole('option', { name: 'Namba' }).click()
    await dialog.locator('#combo-rate').fill('5000')
    await dialog.getByRole('button', { name: 'Save deal' }).click()

    await expect(
      dialog.getByText('A deal already exists for this class and pickup location.'),
    ).toBeVisible()
    // The rejected submit never closed the dialog.
    await expect(dialog.getByRole('button', { name: 'Save deal' })).toBeVisible()
  })
})
