import { type Locator, expect, test } from '@playwright/test'
import { testSql } from './pg'

// #1534: authenticated, real-DB coverage for operator add-ons (optional extras).
// The minted session cookie (auth.setup.ts) carries OPERATOR_OWNER + operatorId,
// so these flows exercise the real web -> real Hono API -> seeded Neon branch.
//
// #1523: add-on DESCRIPTIONS auto machine-translate on save, so this spec asserts
// only on the NAME the operator typed (the en source, which never translates) and
// never on a description variant. A self-authored add-on mirrors nameI18n.en into
// the `name` column, so the `E2E ` name-prefix cleanup keys off that column.
const E2E_ADD_ON_PREFIX = 'E2E '

// The create form defaults to the catalog picker when the shared-catalog flag is
// on; self-authoring exposes the name field. Switch to it only when needed so the
// spec is robust to the flag being off (which shows the custom fields directly).
async function ensureCustomAddOn(dialog: Locator): Promise<void> {
  if (!(await dialog.locator('#addon-name-en').isVisible())) {
    await dialog.getByText('Create your own').click()
  }
}

test.describe('operator add-ons (authenticated, real DB)', () => {
  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM add_on_options WHERE name LIKE ${`${E2E_ADD_ON_PREFIX}%`}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner reaches /manage/add-ons and sees the seeded add-ons (P1)', async ({ page }) => {
    await page.goto('/en/manage/add-ons')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/add-ons\/?$/)

    // Best Car Rental's seeded add-ons render as row headings (seed-data/add-ons.ts).
    await expect(page.getByRole('heading', { name: 'Child seat' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pocket Wi-Fi' })).toBeVisible()
  })

  test('a negative price shows a validation error on the price field (P2)', async ({ page }) => {
    await page.goto('/en/manage/add-ons')
    await page.getByRole('button', { name: 'Add add-on' }).click()

    const dialog = page.getByRole('dialog')
    await ensureCustomAddOn(dialog)
    // A valid name isolates the error to the price field. The price input has no
    // native min, so -1 reaches the zod resolver (min(0)) instead of being blocked.
    await dialog.locator('#addon-name-en').fill('E2E Add-on Invalid')
    await dialog.locator('#addon-price').fill('-1')
    await dialog.getByRole('button', { name: 'Save add-on' }).click()

    const priceField = dialog.locator('#addon-price').locator('xpath=..')
    await expect(priceField).toContainText('Price cannot be negative')
    await expect(dialog.getByRole('button', { name: 'Save add-on' })).toBeVisible()
  })

  test('add -> edit -> archive an add-on writes through to the DB (CRUD)', async ({ page }) => {
    // Assert only on the en name (source locale): the description auto-translates on
    // save, but the name the operator types is never machine-translated.
    const name = `E2E Add-on ${Date.now()}`
    const renamed = `${name} edited`
    await page.goto('/en/manage/add-ons')

    // ADD (self-authored)
    await page.getByRole('button', { name: 'Add add-on' }).click()
    const addDialog = page.getByRole('dialog')
    await ensureCustomAddOn(addDialog)
    await addDialog.locator('#addon-name-en').fill(name)
    await addDialog.locator('#addon-price').fill('700')
    await addDialog.getByRole('button', { name: 'Save add-on' }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

    // EDIT: a self-authored row keeps its name editable.
    const row = page.locator('div.border-border').filter({ hasText: name })
    await row.getByRole('button', { name: 'Edit add-on' }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.locator('#addon-name-en').fill(renamed)
    await editDialog.getByRole('button', { name: 'Save add-on' }).click()
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible()

    // ARCHIVE: status flips to Archived and the archive control disables on that row.
    const editedRow = page.locator('div.border-border').filter({ hasText: renamed })
    await editedRow.getByRole('button', { name: 'Archive add-on' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(editedRow.getByText('Archived')).toBeVisible()
    await expect(editedRow.getByRole('button', { name: 'Archive add-on' })).toBeDisabled()
  })
})
