import type { Locator, Page } from '@playwright/test'

/**
 * Drive the operator location region cascade (#1543). Each level is a base-ui combobox
 * (type-to-search), not a native <select>, and its options portal to the page root — so
 * the control is located by its accessible label inside the dialog, but options are queried
 * on `page`. Selecting the AREA level is what yields a regionId.
 */
export async function pickRegionCascade(
  page: Page,
  dialog: Locator,
  levels: { prefecture: string; city: string; area: string },
): Promise<void> {
  const steps: ReadonlyArray<readonly [string, string]> = [
    ['Prefecture', levels.prefecture],
    ['City', levels.city],
    ['Area', levels.area],
  ]
  for (const [label, name] of steps) {
    await dialog.getByLabel(label).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
}
