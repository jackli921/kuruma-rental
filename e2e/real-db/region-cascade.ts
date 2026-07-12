import type { Locator, Page } from '@playwright/test'

/**
 * Drive one region combobox level (#1543). Each level is a base-ui combobox (type-to-search),
 * not a native <select>: open it by its accessible label, then click the chosen option. Options
 * portal to the page root, so the trigger is located inside `within` (a dialog for the operator
 * cascade, the page itself for the public RegionPicker) but the option is always queried on `page`.
 */
export async function pickRegionLevel(
  page: Page,
  label: string,
  name: string,
  within: Locator | Page = page,
): Promise<void> {
  await within.getByLabel(label).click()
  await page.getByRole('option', { name, exact: true }).click()
}

/**
 * Drive the operator location region cascade (#1543): prefecture -> city -> area, each a combobox
 * inside the location dialog. Selecting the AREA level is what yields a regionId.
 */
export async function pickRegionCascade(
  page: Page,
  dialog: Locator,
  levels: { prefecture: string; city: string; area: string },
): Promise<void> {
  await pickRegionLevel(page, 'Prefecture', levels.prefecture, dialog)
  await pickRegionLevel(page, 'City', levels.city, dialog)
  await pickRegionLevel(page, 'Area', levels.area, dialog)
}
