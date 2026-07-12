import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// #1533: authenticated, real-DB coverage for operator insurance options. The
// minted session cookie (auth.setup.ts) carries OPERATOR_OWNER + operatorId, so
// these flows exercise the real web -> real Hono API -> seeded Neon branch.
//
// Insurance is purely self-authored: the form sends a name bundle and the service
// mirrors nameI18n.en into the `name` column (the active-name unique seal). So the
// `E2E ` name-prefix cleanup keys off that column, exactly like the locations spec.
const E2E_INSURANCE_PREFIX = 'E2E '

test.describe('operator insurance (authenticated, real DB)', () => {
  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM insurance_options WHERE name LIKE ${`${E2E_INSURANCE_PREFIX}%`}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner reaches /manage/insurance and sees the seeded plans (P1)', async ({ page }) => {
    await page.goto('/en/manage/insurance')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/insurance\/?$/)

    // Best Car Rental's two seeded tiers render as row headings (seed-data/insurance.ts).
    await expect(page.getByRole('heading', { name: 'Normal' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible()
  })

  test('a negative daily price shows a validation error on the price field (P2)', async ({
    page,
  }) => {
    await page.goto('/en/manage/insurance')
    await page.getByRole('button', { name: 'Add option' }).click()

    const dialog = page.getByRole('dialog')
    // A valid name isolates the error to the price field. The daily-price input has
    // no native min, so -1 reaches the zod resolver (min(0)) instead of being
    // blocked by the browser.
    await dialog.locator('#insurance-name-en').fill('E2E Insurance Invalid')
    await dialog.locator('#insurance-dailyPrice').fill('-1')
    await dialog.getByRole('button', { name: 'Save option' }).click()

    const priceField = dialog.locator('#insurance-dailyPrice').locator('xpath=..')
    await expect(priceField).toContainText('Daily price cannot be negative')
    await expect(dialog.getByRole('button', { name: 'Save option' })).toBeVisible()
  })

  test('add -> edit -> archive an option writes through to the DB (CRUD)', async ({ page }) => {
    const name = `E2E Insurance ${Date.now()}`
    const renamed = `${name} edited`
    await page.goto('/en/manage/insurance')

    // ADD
    await page.getByRole('button', { name: 'Add option' }).click()
    const addDialog = page.getByRole('dialog')
    await addDialog.locator('#insurance-name-en').fill(name)
    await addDialog.locator('#insurance-dailyPrice').fill('1200')
    await addDialog.getByRole('button', { name: 'Save option' }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

    // EDIT
    const row = page.locator('div.border-border').filter({ hasText: name })
    await row.getByRole('button', { name: 'Edit option' }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.locator('#insurance-name-en').fill(renamed)
    await editDialog.getByRole('button', { name: 'Save option' }).click()
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible()

    // ARCHIVE: status flips to Archived and the archive control disables on that row.
    const editedRow = page.locator('div.border-border').filter({ hasText: renamed })
    await editedRow.getByRole('button', { name: 'Archive option' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(editedRow.getByText('Archived')).toBeVisible()
    await expect(editedRow.getByRole('button', { name: 'Archive option' })).toBeDisabled()
  })
})
