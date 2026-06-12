import { type BrowserContext, expect, test } from '@playwright/test'

const ONE_HOUR_S = 60 * 60

// The mock track has no real auth: mock-api.ts echoes the `e2e-mock-role` cookie
// as the session role on GET /auth/session, so the SPA's adminGuard resolves it
// without a real token or DB.
async function signInAs(context: BrowserContext, role: string): Promise<void> {
  await context.addCookies([
    {
      name: 'e2e-mock-role',
      value: role,
      domain: 'localhost',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
    },
  ])
}

// End-to-end proof of the two-layer /admin guard and the shell chrome on the Vite
// stack (#541, ported from the frozen Next.js spec). The authz *decision* is
// unit-tested (adminGuard); this proves the *wiring* — beforeLoad redirect, layout
// guard, sidebar + tab — and that the admin shell stays isolated from the
// always-mounted global Navbar (#481 review P2; the only real-browser proof).
test.describe('admin portal guard (#462 / #541)', () => {
  test('unauthenticated /en/admin redirects to login with a returnTo', async ({ page }) => {
    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/login\?returnTo=/)
  })

  test('a RENTER is forbidden and bounced to the home page', async ({ context, page }) => {
    await signInAs(context, 'RENTER')
    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/?$/)
  })

  test('an OPERATOR_OWNER is forbidden and bounced to the home page', async ({ context, page }) => {
    // Operators clear the business guard, so they are the realistic escalation
    // actor. The admin gate is narrower — tenant-scoped OPERATOR_* must NOT reach
    // the cross-tenant /admin.
    await signInAs(context, 'OPERATOR_OWNER')
    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/?$/)
  })

  test('a PLATFORM_ADMIN sees the nav and the revenue placeholder', async ({ context, page }) => {
    await signInAs(context, 'PLATFORM_ADMIN')

    await page.goto('/en/admin')
    await expect(page).toHaveURL(/\/en\/admin\/?$/)
    await expect(page.getByRole('link', { name: /partner revenue/i })).toBeVisible()
    // The always-mounted global Navbar must not bleed into the admin shell
    // (globals.css `:root:has([data-admin-sidebar]) [data-global-nav]`).
    await expect(page.locator('[data-global-nav]')).toBeHidden()

    await page.goto('/en/admin/revenue')
    await expect(page.getByText(/coming soon/i)).toBeVisible()
    await expect(page.getByText(/4%/)).toBeVisible()
  })

  test('a PLATFORM_ADMIN in renter view gets no global-nav leak on /admin', async ({
    context,
    page,
  }) => {
    // PLATFORM_ADMIN is a business role, so it can hold the renter-view cookie. In
    // renter view the global Navbar renders renter links WITHOUT data-business-nav,
    // so the suppression must key off data-global-nav (always present), not the
    // business marker. The AdminSidebar stays the only nav.
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

    await expect(page.getByRole('link', { name: /partner revenue/i })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Bookings' })).toBeHidden()
  })
})

test.describe('admin portal at mobile width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('a PLATFORM_ADMIN gets admin nav, not the global mobile menu', async ({ context, page }) => {
    await signInAs(context, 'PLATFORM_ADMIN')
    await page.goto('/en/admin')

    await expect(page.getByRole('link', { name: /partner revenue/i })).toBeVisible()
    // The global mobile menu is suppressed on admin pages.
    await expect(page.locator('[data-mobile-menu]')).toBeHidden()
  })
})
