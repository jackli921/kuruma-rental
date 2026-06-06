import { type BrowserContext, expect, test } from '@playwright/test'
import { SESSION_COOKIE_NAME, mintMockSessionToken } from './mint-mock-session'

const ONE_HOUR_S = 60 * 60

async function signInAs(context: BrowserContext, role: string): Promise<void> {
  const value = await mintMockSessionToken(role)
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
    },
  ])
}

// Slice 5: end-to-end proof of the two-layer /admin guard and the shell chrome.
// The authz *decision* is unit-tested (isPlatformAdmin, decideAdminAccess); this
// spec proves the wiring — middleware redirect, layout guard, sidebar + tab.
test.describe('admin portal guard (#462)', () => {
  test('unauthenticated /en/admin redirects to login with a callbackUrl', async ({ page }) => {
    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/login\?callbackUrl=/)
  })

  test('a RENTER is forbidden and bounced to the home page', async ({ context, page }) => {
    await signInAs(context, 'RENTER')
    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/?$/)
  })

  test('an OPERATOR_OWNER is forbidden and bounced to the home page (#481 review)', async ({
    context,
    page,
  }) => {
    // Operators clear the business guard, so they are the realistic escalation
    // actor here. The admin gate is deliberately narrower than business — the
    // tenant-scoped OPERATOR_* roles must NOT reach the cross-tenant /admin.
    await signInAs(context, 'OPERATOR_OWNER')
    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/?$/)
  })

  test('a PLATFORM_ADMIN sees the nav and the revenue placeholder', async ({ context, page }) => {
    await signInAs(context, 'PLATFORM_ADMIN')

    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/admin\/?$/)
    await expect(page.getByRole('link', { name: /partner revenue/i })).toBeVisible()
    // P2: the global operator nav must not bleed into the admin shell.
    await expect(page.locator('[data-business-nav]')).toBeHidden()

    await page.goto('/en/admin/revenue')
    await expect(page.getByText(/coming soon/i)).toBeVisible()
    await expect(page.getByText(/4%/)).toBeVisible()
  })

  test('a PLATFORM_ADMIN in renter view gets no global-nav leak on /admin (#481 review P2)', async ({
    context,
    page,
  }) => {
    // PLATFORM_ADMIN is a business role, so it can hold the renter-view cookie.
    // In renter view the global Navbar renders public/renter links WITHOUT the
    // data-business-nav marker, so the round-1 CSS (keyed on data-business-nav)
    // did not suppress them. The AdminSidebar must remain the only nav.
    await signInAs(context, 'PLATFORM_ADMIN')
    await context.addCookies([
      {
        name: 'kuruma-view',
        value: 'renter',
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
      },
    ])
    await page.goto('/en/admin')

    // The admin sidebar is present...
    await expect(page.getByRole('link', { name: /partner revenue/i })).toBeVisible()
    // ...but the renter/public links from the global nav do not bleed through.
    await expect(page.getByRole('link', { name: 'Bookings' })).toBeHidden()
    await expect(page.getByRole('link', { name: 'Vehicles' })).toBeHidden()
  })
})

test.describe('admin portal at mobile width (#481 review P2)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a PLATFORM_ADMIN gets admin nav, not the operator mobile menu', async ({
    context,
    page,
  }) => {
    await signInAs(context, 'PLATFORM_ADMIN')
    await page.goto('/en/admin')

    // AdminSidebar collapses to a top bar on mobile and is the only nav.
    await expect(page.getByRole('link', { name: /partner revenue/i })).toBeVisible()
    // The global (operator) mobile menu is suppressed on admin pages.
    await expect(page.locator('[data-mobile-menu]')).toBeHidden()
  })
})
