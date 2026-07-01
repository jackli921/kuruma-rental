import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { SECOND_OPERATOR_NAME, SECOND_OPERATOR_SEED_EMAIL, STORAGE_STATE } from './constants'
import { SESSION_COOKIE_NAME, mintOperatorSessionTokenFor } from './mint-session'

// Tenant isolation (#1258): a signed-in operator must never reach another
// operator's data through the real Vite -> Hono -> Postgres stack. Service-layer
// scoping is already unit/integration-covered (tenancy-isolation.test.ts et al);
// this is the missing BROWSER-level guarantee for the security invariant.
//
// A = Best Car Rental (the project-default operator storageState, seeded with
// bookings + a fleet). B = Kansai Drive (the second seeded operator, minted at
// runtime). A's row ids are re-minted on every seed, so the spec DISCOVERS them
// through A's own tenant-scoped API rather than hardcoding, then proves B is
// denied them at both layers:
//   - API: GET the resource by A's id as B -> 403/404, and A's data never leaks.
//   - UI: deep-link the resource as B -> tenant-sealed notFound() (bookings/
//     $bookingId.tsx, fleet/$vehicleId.tsx), no A data on the page.
// Each UI check is DIFFERENTIAL: the SAME url renders the resource for A (a
// positive control) and not for B, so the B absence assertion cannot pass
// trivially (e.g. from an unrelated load failure).

const ONE_HOUR_S = 60 * 60

interface ListRow {
  readonly id: string
}

/** First row of a tenant-scoped `{ data: [...] }` list endpoint, or null. */
async function firstRow<T extends ListRow>(
  request: APIRequestContext,
  path: string,
): Promise<T | null> {
  const res = await request.get(path)
  if (!res.ok()) return null
  const body = (await res.json()) as { data?: readonly T[] }
  return body.data?.[0] ?? null
}

test.describe('tenant isolation: operator B cannot reach operator A data', () => {
  let aContext: BrowserContext
  let bContext: BrowserContext
  let aBookingId: string
  let aRenterName: string
  let aVehicleId: string
  let aVehicleName: string

  test.beforeAll(async ({ browser }, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL as string

    // Operator A: reuse the minted project storageState (Best Car Rental owner).
    aContext = await browser.newContext({ storageState: STORAGE_STATE, baseURL })
    // Operator B: mint a fresh Kansai Drive owner session — mintOperatorSessionTokenFor
    // resolves its operatorId off the seeded users row, so the cookie is scoped to
    // the second tenant exactly like a real operator login.
    bContext = await browser.newContext({ baseURL })
    await bContext.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: await mintOperatorSessionTokenFor(SECOND_OPERATOR_SEED_EMAIL, SECOND_OPERATOR_NAME),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
      },
    ])

    const booking = await firstRow<{ id: string; renter: { name: string | null } | null }>(
      aContext.request,
      '/api/bookings?expand=renter',
    )
    const vehicle = await firstRow<{ id: string; name: string }>(aContext.request, '/api/vehicles')

    // Fail loudly, never skip: a seed that gives operator A no booking/vehicle
    // would make every assertion below vacuously pass.
    if (!booking?.id || !booking.renter?.name) {
      throw new Error('seed gap: operator A has no booking with a named renter to isolate')
    }
    if (!vehicle?.id) throw new Error('seed gap: operator A has no vehicle to isolate')

    aBookingId = booking.id
    aRenterName = booking.renter.name
    aVehicleId = vehicle.id
    aVehicleName = vehicle.name
  })

  test.afterAll(async () => {
    await aContext?.close()
    await bContext?.close()
  })

  test('API: operator B is denied operator A booking by id', async () => {
    const aRes = await aContext.request.get(`/api/bookings/${aBookingId}`)
    expect(aRes.ok(), 'operator A can read its own booking').toBe(true)

    const bRes = await bContext.request.get(`/api/bookings/${aBookingId}`)
    expect([403, 404], `operator B must be denied A booking, got ${bRes.status()}`).toContain(
      bRes.status(),
    )
    expect(await bRes.text(), 'denied response must not leak A renter').not.toContain(aRenterName)
  })

  test('API: operator B is denied operator A vehicle by id', async () => {
    const aRes = await aContext.request.get(`/api/vehicles/${aVehicleId}`)
    expect(aRes.ok(), 'operator A can read its own vehicle').toBe(true)

    const bRes = await bContext.request.get(`/api/vehicles/${aVehicleId}`)
    expect([403, 404], `operator B must be denied A vehicle, got ${bRes.status()}`).toContain(
      bRes.status(),
    )
  })

  test('UI: A booking detail renders for A but not for B', async () => {
    const aPage = await aContext.newPage()
    await aPage.goto(`/en/manage/bookings/${aBookingId}`)
    await expect(aPage.getByText(aRenterName).first()).toBeVisible() // positive control
    await aPage.close()

    const bPage = await bContext.newPage()
    await bPage.goto(`/en/manage/bookings/${aBookingId}`)
    // B stays on the deep link (authed, not login-redirected) but sees no A data.
    await expect(bPage).toHaveURL(new RegExp(`/manage/bookings/${aBookingId}$`))
    await expect(bPage.getByText(aRenterName)).toHaveCount(0)
    await bPage.close()
  })

  test('UI: A vehicle detail renders for A but not for B', async () => {
    const aPage = await aContext.newPage()
    await aPage.goto(`/en/manage/fleet/${aVehicleId}`)
    await expect(aPage.getByText(aVehicleName).first()).toBeVisible() // positive control
    await aPage.close()

    const bPage = await bContext.newPage()
    await bPage.goto(`/en/manage/fleet/${aVehicleId}`)
    await expect(bPage).toHaveURL(new RegExp(`/manage/fleet/${aVehicleId}$`))
    await expect(bPage.getByText(aVehicleName)).toHaveCount(0)
    await bPage.close()
  })
})
