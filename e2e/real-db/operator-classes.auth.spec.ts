import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// #1535: authenticated, real-DB coverage for operator vehicle classes. The minted
// session cookie (auth.setup.ts) carries OPERATOR_OWNER + operatorId, so these
// flows exercise the real web -> real Hono API -> seeded Neon branch end to end.
//
// Classes carry a free-text `name`, so the `E2E ` name-prefix cleanup keys off it,
// exactly like the locations spec. The rows this spec creates have no vehicles or
// fees pointing at them, so the delete-blocking FKs never fire in cleanup.
const E2E_CLASS_PREFIX = 'E2E '

test.describe('operator classes (authenticated, real DB)', () => {
  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM vehicle_classes WHERE name LIKE ${`${E2E_CLASS_PREFIX}%`}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner reaches /manage/classes and sees the seeded classes (P1)', async ({ page }) => {
    await page.goto('/en/manage/classes')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/classes\/?$/)

    // Best Car Rental's seeded classes render as row headings, with the slug below
    // (seed-data/classes.ts). SUV is namespaced 'best-suv' to keep slugs globally unique.
    await expect(page.getByRole('heading', { name: 'Kei car' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sedan' })).toBeVisible()
    await expect(page.getByText('best-suv')).toBeVisible()
  })

  test('a duplicate slug shows a validation error (P2)', async ({ page }) => {
    await page.goto('/en/manage/classes')
    await page.getByRole('button', { name: 'Add class' }).click()

    const dialog = page.getByRole('dialog')
    // 'kei' is already taken by the seeded Kei car class. Slugs are globally unique,
    // so the server rejects the create with a 409 the dialog surfaces inline.
    await dialog.locator('#class-name').fill('E2E Dup Class')
    await dialog.locator('#class-slug').fill('kei')
    await dialog.getByRole('button', { name: 'Save class' }).click()

    await expect(dialog).toContainText('Slug already in use')
    await expect(dialog.getByRole('button', { name: 'Save class' })).toBeVisible()
  })

  test('add -> edit -> archive a class writes through to the DB (CRUD)', async ({ page }) => {
    const stamp = Date.now()
    const name = `E2E Class ${stamp}`
    const renamed = `${name} edited`
    const slug = `e2e-class-${stamp}`
    await page.goto('/en/manage/classes')

    // ADD: name + a unique slug; seats/luggage/transmission/sortOrder keep their
    // form defaults, which satisfy the create schema.
    await page.getByRole('button', { name: 'Add class' }).click()
    const addDialog = page.getByRole('dialog')
    await addDialog.locator('#class-name').fill(name)
    await addDialog.locator('#class-slug').fill(slug)
    await addDialog.getByRole('button', { name: 'Save class' }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

    // EDIT: rename; the list refetches so the new heading replaces the old. Scope to
    // the class list item by its heading so nav/footer list items can never match.
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
    await row.getByRole('button', { name: 'Edit class' }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.locator('#class-name').fill(renamed)
    await editDialog.getByRole('button', { name: 'Save class' }).click()
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible()

    // ARCHIVE (soft delete): status flips to Archived and the delete control disables.
    const editedRow = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: renamed, exact: true }) })
    await editedRow.getByRole('button', { name: 'Delete class' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(editedRow.getByText('Archived')).toBeVisible()
    await expect(editedRow.getByRole('button', { name: 'Delete class' })).toBeDisabled()
  })
})
