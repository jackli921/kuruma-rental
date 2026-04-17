import { expect, test } from '@playwright/test'

test.describe('Landing page', () => {
  test('renders hero with marketing copy', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Explore Japan at your own pace' }),
    ).toBeVisible()

    await expect(
      page.getByText(
        'Pick up a car in Osaka and drive anywhere. No approval wait, no hidden fees.',
      ),
    ).toBeVisible()
  })

  test('search widget is interactive', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
  })
})
