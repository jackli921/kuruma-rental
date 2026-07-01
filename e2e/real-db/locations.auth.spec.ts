import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// Names this spec creates; cleaned up in afterAll so a reused local branch
// doesn't accrete rows (a per-run CI branch is disposable, so this is belt-and-
// braces). The '%' makes the timestamped CRUD name match too.
const TEST_LOCATION_PREFIX = 'E2E '

// #416: authenticated, real-DB coverage for operator locations. The minted
// session cookie (auth.setup.ts) carries OPERATOR_OWNER + operatorId, so these
// flows exercise the real web -> real Hono API -> seeded Neon branch end to end.
test.describe('operator locations (authenticated, real DB)', () => {
  test.afterAll(async () => {
    const sql = testSql()
    try {
      await sql`DELETE FROM locations WHERE name LIKE ${`${TEST_LOCATION_PREFIX}%`}`
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  test('owner reaches /manage/locations and sees the seeded storefronts (P1)', async ({ page }) => {
    await page.goto('/en/manage/locations')

    // No redirect to sign-in: the operator session is honoured by middleware.
    await expect(page).toHaveURL(/\/en\/manage\/locations\/?$/)

    // The three seeded Best Car Rental storefronts render (slice 8 seed, §3.2).
    await expect(page.getByText('Namba')).toBeVisible()
    await expect(page.getByText('Shin-Osaka')).toBeVisible()
    await expect(page.getByText('Kansai Airport (KIX)')).toBeVisible()
  })

  test('invalid hours show the error under Closes, not Opens (P2)', async ({ page }) => {
    await page.goto('/en/manage/locations')
    await page.getByRole('button', { name: 'Add location' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.locator('#location-name').fill('E2E Hours Store')
    await dialog.locator('#location-address').fill('1-1 Test, Osaka')
    await dialog.getByLabel('Set operating hours').check()
    await dialog.locator('#location-openTime').fill('20:00')
    await dialog.locator('#location-closeTime').fill('08:00')
    await dialog.getByRole('button', { name: 'Save location' }).click()

    // Refine attaches to closeTime (validators/location.ts path: ['closeTime']),
    // so the message must render under the Closes field — not Opens, not silent.
    const closeField = dialog.locator('#location-closeTime').locator('xpath=..')
    const openField = dialog.locator('#location-openTime').locator('xpath=..')
    await expect(closeField).toContainText('closeTime must be after openTime')
    await expect(openField).not.toContainText('closeTime must be after openTime')
  })

  test('add -> edit -> archive a location writes through to the DB (CRUD)', async ({ page }) => {
    const name = `E2E Store ${Date.now()}`
    const renamed = `${name} edited`
    await page.goto('/en/manage/locations')

    // ADD
    await page.getByRole('button', { name: 'Add location' }).click()
    const addDialog = page.getByRole('dialog')
    await addDialog.locator('#location-name').fill(name)
    await addDialog.locator('#location-address').fill('1-1 Test, Osaka')
    // A synthetic address can't be geocoded, so the server can't auto-derive a
    // region and rejects the create ("needs a region"). Pick one explicitly via the
    // prefecture -> city -> area cascade; only the AREA level yields a regionId.
    await addDialog.locator('#region-prefecture').selectOption({ label: 'Osaka' })
    await addDialog.locator('#region-city').selectOption({ label: 'Osaka City' })
    await addDialog.locator('#region-area').selectOption({ label: 'Namba' })
    await addDialog.getByRole('button', { name: 'Save location' }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

    // EDIT
    const row = page.getByTestId('location-row').filter({ hasText: name })
    await row.getByRole('button', { name: 'Edit location' }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.locator('#location-name').fill(renamed)
    await editDialog.getByRole('button', { name: 'Save location' }).click()
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible()

    // ARCHIVE
    const editedRow = page.getByTestId('location-row').filter({ hasText: renamed })
    await editedRow.getByRole('button', { name: 'Archive location' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
    // Status flips to Archived and the archive control disables on that row.
    await expect(editedRow.getByText('Archived')).toBeVisible()
    await expect(editedRow.getByRole('button', { name: 'Archive location' })).toBeDisabled()
  })
})
