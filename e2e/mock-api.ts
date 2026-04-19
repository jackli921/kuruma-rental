// Minimal mock API for Playwright E2E. Returns fixture data for the vehicle
// endpoints that the renter public browse flow hits server-side. Keeps E2E
// decoupled from Postgres + wrangler dev; real-DB coverage lives in the
// integration suite.

const MOCK_PORT = Number(process.env.MOCK_API_PORT ?? 8787)
const FROZEN_TIMESTAMP = '2026-01-01T00:00:00.000Z'

const TEST_CLASS_ID = 'e2e-test-class-1'
const TEST_CLASS_SLUG = 'e2e-compact'

const TEST_CLASS = {
  id: TEST_CLASS_ID,
  name: 'E2E Test Compact',
  slug: TEST_CLASS_SLUG,
  description: 'Compact class used by the Playwright browse-flow spec.',
  photos: ['https://images.unsplash.com/photo-1734857039653-c1b0a4b3422a?w=600&q=80'],
  seats: 4,
  luggageCapacity: 2,
  transmission: 'AUTO',
  fuelType: 'Petrol',
  dailyRateJpy: 5000,
  hourlyRateJpy: null,
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

const ok = (data: unknown) => Response.json({ success: true, data })
const fail = (error: string, status: number) => Response.json({ success: false, error }, { status })

Bun.serve({
  port: MOCK_PORT,
  fetch(req) {
    const url = new URL(req.url)

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

    return fail('Not found', 404)
  },
})
