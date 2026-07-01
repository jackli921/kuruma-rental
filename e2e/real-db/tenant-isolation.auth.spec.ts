import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { SECOND_OPERATOR_OWNER_NAME, SECOND_OPERATOR_SEED_EMAIL, STORAGE_STATE } from './constants'
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
// denied them across read (by-id + list), write, and UI surfaces.
//
// Two properties keep this from passing vacuously (a spec that green-lights a
// broken isolation is worse than none):
//   1. POSITIVE CONTROL FOR B — the first test proves B's session can read its
//      OWN vehicle. A dead or mis-scoped B session (e.g. operatorId resolving to
//      null -> a "none" read scope) would 404 on everything, so every "B denied
//      A" assertion would pass while proving nothing. The positive control turns
//      "B sees nothing" into "B sees only its own".
//   2. UI checks WAIT FOR THE DENIAL — page.goto resolves on `load`, before the
//      SPA route loader settles, so a bare `toHaveCount(0)` can pass on the
//      skeleton regardless of isolation. Each UI test blocks on the detail
//      API response and asserts it was 403/404 before checking the DOM.
//
// Scope: bookings + vehicles (the operator's core data). Customers/messages/team
// are separate surfaces not covered here.

const ONE_HOUR_S = 60 * 60

// Cross-tenant denial is 404 (row-scoped read misses the row) OR 403 (role/scope
// gate rejects first); both are correct isolation outcomes, so every denial
// assertion accepts either. number[] (not `as const`) so toContain(status) types.
const DENIED_STATUSES: readonly number[] = [403, 404]

interface VehicleRow {
  readonly id: string
  readonly name: string
  readonly status: string
}

interface BookingRow {
  readonly id: string
  readonly renter: { readonly name: string | null } | null
}

/** Rows of a tenant-scoped `{ data: [...] }` list endpoint (empty on non-200). */
async function listRows<T>(request: APIRequestContext, path: string): Promise<T[]> {
  const res = await request.get(path)
  if (!res.ok()) return []
  const body = (await res.json()) as { data?: unknown }
  return Array.isArray(body.data) ? (body.data as T[]) : []
}

test.describe('tenant isolation: operator B cannot reach operator A data', () => {
  let aContext: BrowserContext
  let bContext: BrowserContext
  let aBookingId: string
  let aRenterName: string
  let aVehicleId: string
  let aVehicleName: string
  let aVehicleStatus: string
  let bVehicleId: string
  let bVehicleName: string
  let bCsrf: string

  test.beforeAll(async ({ browser }, workerInfo) => {
    const baseURL = workerInfo.project.use.baseURL
    if (!baseURL) throw new Error('playwright.real-db.config must define use.baseURL')

    // Operator A: reuse the minted project storageState (Best Car Rental owner).
    aContext = await browser.newContext({ storageState: STORAGE_STATE, baseURL })
    // Operator B: mint a fresh Kansai Drive owner session — mintOperatorSessionTokenFor
    // resolves its operatorId off the seeded users row, so the cookie is scoped to
    // the second tenant exactly like a real operator login.
    bContext = await browser.newContext({ baseURL })
    await bContext.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: await mintOperatorSessionTokenFor(
          SECOND_OPERATOR_SEED_EMAIL,
          SECOND_OPERATOR_OWNER_NAME,
        ),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        expires: Math.floor(Date.now() / 1000) + ONE_HOUR_S,
      },
    ])

    // Discover REAL ids through each operator's own tenant-scoped API. A booking
    // may be a walk-in (renter = null), so pick the first with a named renter
    // rather than index 0 — an index-0 null would trip the guard on valid seed.
    const aBookings = await listRows<BookingRow>(aContext.request, '/api/bookings?expand=renter')
    const aVehicles = await listRows<VehicleRow>(aContext.request, '/api/vehicles')
    const bVehicles = await listRows<VehicleRow>(bContext.request, '/api/vehicles')

    const aBooking = aBookings.find((b) => b.renter?.name)
    const aVehicle = aVehicles.find((v) => v.name)
    const bVehicle = bVehicles.find((v) => v.name)

    // Fail loudly, never skip: missing fixtures would make the assertions vacuous.
    if (!aBooking?.renter?.name) {
      throw new Error('seed gap: operator A has no booking with a named renter to isolate')
    }
    if (!aVehicle) throw new Error('seed gap: operator A has no named vehicle to isolate')
    if (!bVehicle) {
      throw new Error(
        'seed gap: operator B (Kansai Drive) has no named vehicle for its positive control',
      )
    }

    aBookingId = aBooking.id
    aRenterName = aBooking.renter.name
    aVehicleId = aVehicle.id
    aVehicleName = aVehicle.name
    aVehicleStatus = aVehicle.status
    bVehicleId = bVehicle.id
    bVehicleName = bVehicle.name

    // CSRF token for B's write probe (double-submit: X-CSRF-Token must echo the
    // session's `csrf` claim, which GET /auth/session exposes as csrfToken).
    const bSession = await bContext.request.get('/auth/session')
    const bSessionBody = (await bSession.json()) as { data?: { csrfToken?: string } }
    bCsrf = bSessionBody.data?.csrfToken ?? ''
    if (!bCsrf) throw new Error('could not resolve operator B CSRF token from /auth/session')
  })

  test.afterAll(async () => {
    await aContext?.close()
    await bContext?.close()
  })

  test('positive control: operator B can read its OWN vehicle (session is live + scoped)', async () => {
    const res = await bContext.request.get(`/api/vehicles/${bVehicleId}`)
    expect(res.ok(), 'operator B must be able to read its own vehicle').toBe(true)
    expect(await res.text(), 'B own-vehicle read returns its data').toContain(bVehicleName)
  })

  test('API read: operator B is denied operator A vehicle by id', async () => {
    const res = await bContext.request.get(`/api/vehicles/${aVehicleId}`)
    expect(DENIED_STATUSES, `operator B must be denied A vehicle, got ${res.status()}`).toContain(
      res.status(),
    )
    // Probe the tenant-unique id, not the display name: `${make} ${model}` names
    // (e.g. "Toyota Yaris") recur across tenants, so only the id proves a 200 body
    // is A's vehicle. The fail() envelope never echoes the id on denial.
    expect(await res.text(), 'denied response must not leak A vehicle').not.toContain(aVehicleId)
  })

  test('API read: operator B is denied operator A booking by id', async () => {
    // expand=vehicle,renter (mirrors the trip-detail loader): /bookings/:id embeds
    // the renter name ONLY when BOTH tokens are present (bookings.ts ->
    // findByIdWithVehicleAndRenter). `expand=renter` alone returns findById -> a
    // bare renterId UUID, leaving this probe inert; with both tokens a 200 leak
    // would actually carry aRenterName and trip the not-toContain below.
    const res = await bContext.request.get(`/api/bookings/${aBookingId}?expand=vehicle,renter`)
    expect(DENIED_STATUSES, `operator B must be denied A booking, got ${res.status()}`).toContain(
      res.status(),
    )
    expect(await res.text(), 'denied response must not leak A renter').not.toContain(aRenterName)
  })

  test('API list: operator B vehicle list excludes operator A vehicles', async () => {
    const rows = await listRows<VehicleRow>(bContext.request, '/api/vehicles')
    expect(rows.length, 'operator B has its own fleet to list').toBeGreaterThan(0)
    expect(
      rows.map((v) => v.id),
      "operator A's vehicle must not appear in B's fleet list",
    ).not.toContain(aVehicleId)
  })

  test('API list: operator B booking list excludes operator A bookings', async () => {
    const rows = await listRows<BookingRow>(bContext.request, '/api/bookings')
    // Positive control (symmetric with the vehicle-list test): listRows maps any
    // non-200 to [], so absent this a broken/500 bookings endpoint would pass the
    // not-toContain vacuously. Kansai is seeded with bookings, so a live, correctly
    // scoped B session always has rows here.
    expect(rows.length, 'operator B has its own bookings to list').toBeGreaterThan(0)
    expect(
      rows.map((b) => b.id),
      "operator A's booking must not appear in B's booking list",
    ).not.toContain(aBookingId)
  })

  test('API write: operator B cannot change operator A vehicle status', async () => {
    // Target a status that DIFFERS from A's current one, so the "unchanged" check
    // below stays decisive: if the target equalled aVehicleStatus, a successful
    // cross-tenant write would leave the value equal and the proof would degenerate.
    // reason is always sent (required for MAINTENANCE, allowed for other statuses).
    const targetStatus = aVehicleStatus === 'MAINTENANCE' ? 'AVAILABLE' : 'MAINTENANCE'
    const res = await bContext.request.patch(`/api/vehicles/${aVehicleId}/status`, {
      headers: { 'X-CSRF-Token': bCsrf },
      data: { status: targetStatus, reason: 'e2e tenant-isolation write probe' },
    })
    expect(
      DENIED_STATUSES,
      `operator B write to A vehicle must be denied, got ${res.status()}`,
    ).toContain(res.status())

    // The decisive proof: A's vehicle is untouched regardless of the status code.
    const after = await aContext.request.get(`/api/vehicles/${aVehicleId}`)
    expect(after.ok()).toBe(true)
    const afterBody = (await after.json()) as { data?: { status?: string } }
    expect(afterBody.data?.status, 'A vehicle status unchanged after B write attempt').toBe(
      aVehicleStatus,
    )
  })

  test('UI: A booking detail renders for A but B is denied', async () => {
    const aPage = await aContext.newPage()
    await aPage.goto(`/en/manage/bookings/${aBookingId}`)
    await expect(aPage.getByText(aRenterName).first()).toBeVisible() // positive control
    await aPage.close()

    const bPage = await bContext.newPage()
    // Block on the tenant-sealed detail fetch (loader's expand=renter read) so the
    // absence check runs against the settled notFound() page, not the skeleton.
    const denied = bPage.waitForResponse(
      (r) => r.url().includes(`/bookings/${aBookingId}`) && r.url().includes('expand'),
    )
    await bPage.goto(`/en/manage/bookings/${aBookingId}`)
    expect(DENIED_STATUSES, 'B booking-detail API must be denied').toContain(
      (await denied).status(),
    )
    await expect(bPage.getByText(aRenterName)).toHaveCount(0)
    await bPage.close()
  })

  test('UI: A vehicle detail renders for A but B is denied', async () => {
    const aPage = await aContext.newPage()
    await aPage.goto(`/en/manage/fleet/${aVehicleId}`)
    await expect(aPage.getByText(aVehicleName).first()).toBeVisible() // positive control
    await aPage.close()

    const bPage = await bContext.newPage()
    const denied = bPage.waitForResponse((r) => r.url().includes(`/vehicles/${aVehicleId}`))
    await bPage.goto(`/en/manage/fleet/${aVehicleId}`)
    expect(DENIED_STATUSES, 'B vehicle-detail API must be denied').toContain(
      (await denied).status(),
    )
    await expect(bPage.getByText(aVehicleName)).toHaveCount(0)
    await bPage.close()
  })
})
