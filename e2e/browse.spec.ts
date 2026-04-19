import { expect, test } from '@playwright/test'

const TEST_CLASS_NAME = 'E2E Test Compact'
const TEST_CLASS_SLUG = 'e2e-compact'

test.describe('Renter public browse flow', () => {
  test('catalog renders class card linking to class detail', async ({ page }) => {
    await page.goto('/en/vehicles')

    // Card link — only the correct render path produces a link whose href
    // matches the class detail route for this specific slug.
    const cards = page.getByRole('link', { name: new RegExp(TEST_CLASS_NAME) })
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toHaveAttribute(
      'href',
      new RegExp(`/vehicles/classes/${TEST_CLASS_SLUG}$`),
    )
  })

  test('clicking a class card navigates to class detail', async ({ page }) => {
    await page.goto('/en/vehicles')

    await page
      .getByRole('link', { name: new RegExp(TEST_CLASS_NAME) })
      .first()
      .click()

    await expect(page).toHaveURL(new RegExp(`/vehicles/classes/${TEST_CLASS_SLUG}$`))
    await expect(page.getByRole('heading', { level: 1, name: TEST_CLASS_NAME })).toBeVisible()
  })
})
