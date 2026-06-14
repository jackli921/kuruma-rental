// Minimal mock API for Playwright E2E. Returns fixture data for the vehicle
// endpoints that the renter public browse flow hits server-side. Keeps E2E
// decoupled from Postgres + wrangler dev; real-DB coverage lives in the
// integration suite.

const MOCK_PORT = Number(process.env.MOCK_API_PORT ?? 8787)
const FROZEN_TIMESTAMP = '2026-01-01T00:00:00.000Z'

const TEST_CLASS_ID = 'e2e-test-class-1'
const TEST_CLASS_SLUG = 'e2e-compact'

// Renter storefront search/detail fixtures (#391). The storefront-search spec
// asserts against these exact values (store name, "Compact ×4" badge, price,
// vehicle names). CCAR maps to "Compact" in the acriss i18n namespace.
const TEST_STORE_ID = 'e2e-store-1'
const TEST_STORE_PHOTO = 'https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=600&q=80'
const TEST_OPERATING_HOURS = { openTime: '09:00', closeTime: '20:00' }

const TEST_STOREFRONT_CARD = {
  locationId: TEST_STORE_ID,
  operatorId: 'e2e-operator-1',
  operatorName: 'Best Car Rental',
  name: 'Best Car Rental Osaka',
  address: '1-2-3 Namba, Chuo-ku, Osaka',
  operatingHours: TEST_OPERATING_HOURS,
  classSummaries: [
    { acrissCode: 'CCAR', label: 'Compact', availableCount: 4 },
    { acrissCode: 'MVAR', label: 'Minivan', availableCount: 2 },
  ],
  fromDailyPriceJpy: 4500,
  fromHourlyPriceJpy: null,
  representativePhotos: [TEST_STORE_PHOTO],
}

const TEST_STOREFRONT_DETAIL = {
  storefront: {
    locationId: TEST_STORE_ID,
    name: 'Best Car Rental Osaka',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
    operatorName: 'Best Car Rental',
    operatingHours: TEST_OPERATING_HOURS,
  },
  vehicles: [
    {
      id: 'e2e-store-vehicle-1',
      name: 'E2E Honda Fit',
      make: 'Honda',
      model: 'Fit',
      year: 2024,
      seats: 5,
      transmission: 'AUTO',
      acrissCode: 'CCAR',
      classLabel: 'Compact',
      dailyRateJpy: 4500,
      hourlyRateJpy: null,
      photos: [TEST_STORE_PHOTO],
    },
    {
      id: 'e2e-store-vehicle-2',
      name: 'E2E Toyota Sienta',
      make: 'Toyota',
      model: 'Sienta',
      year: 2023,
      seats: 7,
      transmission: 'AUTO',
      acrissCode: 'MVAR',
      classLabel: 'Minivan',
      dailyRateJpy: 7800,
      hourlyRateJpy: null,
      photos: [TEST_STORE_PHOTO],
    },
  ],
  nextCursor: null,
}

// Mirrors the real toVehicleClass wire shape (#711 3c-2 validates it with Zod):
// operatorId (notNull), luggageSize, and acrissCode are all served by the real
// API, so the fixture must carry them or the catalog query fails its schema.
const TEST_CLASS = {
  id: TEST_CLASS_ID,
  operatorId: 'e2e-operator-1',
  name: 'E2E Test Compact',
  slug: TEST_CLASS_SLUG,
  description: 'Compact class used by the Playwright browse-flow spec.',
  photos: ['https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=600&q=80'],
  seats: 4,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM',
  transmission: 'AUTO',
  fuelType: 'Petrol',
  acrissCode: 'CCAR',
  sortOrder: 0,
  status: 'ACTIVE',
  createdAt: FROZEN_TIMESTAMP,
  updatedAt: FROZEN_TIMESTAMP,
}

const TEST_VEHICLE = {
  id: 'e2e-test-vehicle-1',
  classId: TEST_CLASS_ID,
  name: 'E2E Test Honda N-BOX',
  description: 'Compact kei car used by the Playwright browse-flow spec.',
  photos: ['https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=600&q=80'],
  seats: 4,
  transmission: 'AUTO',
  fuelType: 'Petrol',
  licensePlate: null,
  status: 'AVAILABLE',
  bufferMinutes: 60,
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
  make: 'Honda',
  model: 'N-BOX',
  year: 2024,
  color: 'White',
  dailyRateJpy: 5000,
  hourlyRateJpy: null,
  shakenExpiryDate: null,
  insuranceExpiryDate: null,
  createdAt: FROZEN_TIMESTAMP,
  updatedAt: FROZEN_TIMESTAMP,
}

// Renter who books in the slice-6 E2E (#392). The forged session cookie's
// subject MUST match this id, and POST /bookings stamps it as the renter so the
// confirmation page's ownership check passes. Keep in sync with e2e/auth.ts.
const TEST_RENTER_ID = 'e2e-renter-1'

// The storefront operator's ACTIVE insurance options (#392). The booking form's
// dropdown renders these; the spec selects the first.
const TEST_INSURANCE = [
  {
    id: 'e2e-ins-1',
    name: 'Collision Damage Waiver',
    description: 'Reduces your liability in an accident.',
    dailyPriceJpy: 1500,
    deductibleJpy: 50000,
  },
  {
    id: 'e2e-ins-2',
    name: 'Full Protection',
    description: null,
    dailyPriceJpy: 3000,
    deductibleJpy: null,
  },
]

// Snapshotted at booking time — drives the confirmation "potential additional
// charges" block.
const TEST_FEE_SNAPSHOT = [
  { feeType: 'CLEANING_FLAT', unit: 'FLAT', amountJpy: 3000, vehicleClassId: null },
  { feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 1000, vehicleClassId: null },
]

// Platform-admin partner revenue (#462, month filter #628). GET /admin/revenue
// returns a fixed report; the spec asserts these exact figures + the 4% model.
// `availableMonths` (newest-first) + `selectedMonth` mirror the real service's
// AdminRevenueResponse so the SPA's month picker renders — omitting them makes
// RevenueView read `undefined.length` and throw into its error boundary. The mock
// ignores `?month` (no spec filters); the filtered path is covered by the real-DB
// lane + unit tests. Authz is proven separately by the adminGuard unit tests + the
// guard-redirect specs — forbidden roles never reach this route.
const TEST_ADMIN_REVENUE = {
  partners: [
    {
      operatorId: 'e2e-operator-1',
      operatorName: 'Best Car Rental',
      operatorSlug: 'best-car',
      grossJpy: 250000,
      platformFeeJpy: 10000,
      netToPartnerJpy: 240000,
      paymentCount: 8,
      months: [
        {
          month: '2026-03',
          grossJpy: 150000,
          platformFeeJpy: 6000,
          netToPartnerJpy: 144000,
          paymentCount: 5,
        },
        {
          month: '2026-02',
          grossJpy: 100000,
          platformFeeJpy: 4000,
          netToPartnerJpy: 96000,
          paymentCount: 3,
        },
      ],
    },
  ],
  totals: { grossJpy: 250000, platformFeeJpy: 10000, netToPartnerJpy: 240000, paymentCount: 8 },
  availableMonths: ['2026-03', '2026-02'],
  selectedMonth: null,
}

// POST /bookings creates; GET /bookings/:id reads. In-memory so the confirmation
// page can re-fetch what the form just created (unique ids keep workers isolated).
const bookings = new Map<string, unknown>()

const ok = (data: unknown) => Response.json({ success: true, data })
const fail = (error: string, status: number) => Response.json({ success: false, error }, { status })

// Read a single cookie value off the request. The mock track has no real auth, so
// authenticated specs (admin-portal.spec.ts) just set an `e2e-mock-role` cookie
// the spec controls; we echo it back as the session role.
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

Bun.serve({
  port: MOCK_PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Session resolution for the mock track. Public specs send no cookie -> 401 ->
    // null (anonymous) in fetchSession (packages/web/src/vite/session.ts), whereas
    // a 404 would throw. Authenticated specs set `e2e-mock-role`; we echo it as the
    // session role so the SPA's guards (adminGuard/businessGuard) resolve without a
    // real token or DB. Shape matches the ok() session envelope fetchSession expects.
    if (url.pathname === '/auth/session') {
      const role = readCookie(req, 'e2e-mock-role')
      if (!role) return fail('unauthenticated', 401)
      return ok({
        user: {
          id: `e2e-${role.toLowerCase()}`,
          role,
          name: `E2E ${role}`,
          email: `${role.toLowerCase()}@e2e.local`,
        },
        csrfToken: 'e2e-csrf-token',
      })
    }

    if (url.pathname === '/admin/revenue') return ok(TEST_ADMIN_REVENUE)

    if (url.pathname === '/vehicles') return ok([TEST_VEHICLE])

    // Mirror real contract: /availability requires from + to date range.
    // See packages/api/src/routes/availability.ts — parseDateRange(c, true).
    if (url.pathname === '/availability') {
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      if (!from || !to) return fail('from and to query parameters required', 400)
      return ok([TEST_VEHICLE])
    }

    if (url.pathname === `/vehicles/${TEST_VEHICLE.id}`) return ok(TEST_VEHICLE)

    // Renter catalog (public) — browse-by-class flow.
    if (url.pathname === '/vehicle-classes') return ok([TEST_CLASS])
    if (url.pathname === `/vehicle-classes/by-slug/${TEST_CLASS_SLUG}`) return ok(TEST_CLASS)

    // Renter storefront search (public, #391). Mirrors the real contract:
    // GET /storefronts/search requires from + to (parseDateRange(c, true)).
    if (url.pathname === '/storefronts/search') {
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      if (!from || !to) return fail('from and to query parameters required', 400)
      return ok({ storefronts: [TEST_STOREFRONT_CARD], nextCursor: null })
    }

    // Storefront drill-down (public, #391). GET /storefronts/:locationId/vehicles.
    // Unknown store -> 404 (web renders notFound()); known store -> 200.
    if (url.pathname === `/storefronts/${TEST_STORE_ID}/vehicles`) {
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      if (!from || !to) return fail('from and to query parameters required', 400)
      return ok(TEST_STOREFRONT_DETAIL)
    }

    // Renter-facing active insurance for a storefront (public, #392).
    if (url.pathname === `/storefronts/${TEST_STORE_ID}/insurance-options`) {
      return ok(TEST_INSURANCE)
    }

    // Create a booking (#392). The web sends the slice-6 contract; the server
    // derives renterId/operatorId/snapshots. We reflect the chosen insurance so
    // the confirmation page can assert it.
    if (url.pathname === '/bookings' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        requestedVehicleId?: string
        pickupLocationId?: string
        dropoffLocationId?: string
        insuranceOptionId?: string
        startAt?: string
        endAt?: string
      }
      const chosen = TEST_INSURANCE.find((o) => o.id === body.insuranceOptionId)
      const id = crypto.randomUUID()
      const booking = {
        id,
        renterId: TEST_RENTER_ID,
        classId: null,
        requestedVehicleId: body.requestedVehicleId ?? null,
        assignedVehicleId: body.requestedVehicleId ?? null,
        pickupLocationId: body.pickupLocationId ?? null,
        dropoffLocationId: body.dropoffLocationId ?? null,
        startAt: body.startAt ?? FROZEN_TIMESTAMP,
        endAt: body.endAt ?? FROZEN_TIMESTAMP,
        effectiveEndAt: body.endAt ?? FROZEN_TIMESTAMP,
        status: 'CONFIRMED',
        source: 'DIRECT',
        bookingCode: `E2E${id.slice(0, 6).toUpperCase()}`,
        insuranceOptionId: chosen?.id ?? null,
        insuranceSnapshot: chosen
          ? {
              insuranceOptionId: chosen.id,
              name: chosen.name,
              dailyPriceJpy: chosen.dailyPriceJpy,
              deductibleJpy: chosen.deductibleJpy,
            }
          : null,
        feeSnapshot: TEST_FEE_SNAPSHOT,
        totalPrice: null,
        externalId: null,
        notes: null,
        createdAt: FROZEN_TIMESTAMP,
        updatedAt: FROZEN_TIMESTAMP,
        // Slice 7 (#393, §4h): renter-safe operator projection. Drives the
        // confirmation page's pre-auth handoff CTA (external link).
        operator: { name: 'Best Car Rental', preAuthHandoffUrl: 'https://pay.example.com/preauth' },
      }
      bookings.set(id, booking)
      return ok(booking)
    }

    // Confirmation page re-fetch (#392). GET /bookings/:id.
    const bookingMatch = url.pathname.match(/^\/bookings\/([^/]+)$/)
    if (bookingMatch && req.method === 'GET') {
      const booking = bookings.get(bookingMatch[1] ?? '')
      if (!booking) return fail('Booking not found', 404)
      return ok(booking)
    }

    return fail('Not found', 404)
  },
})
