// Minimal mock API for Playwright E2E. Returns fixture data for the vehicle
// endpoints that the renter public browse flow hits server-side. Keeps E2E
// decoupled from Postgres + wrangler dev; real-DB coverage lives in the
// integration suite.

const TEST_VEHICLE = {
  id: 'e2e-test-vehicle-1',
  classId: null,
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const ok = (data: unknown) => Response.json({ success: true, data })

Bun.serve({
  port: 8787,
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/vehicles') return ok([TEST_VEHICLE])
    if (url.pathname === '/availability') return ok([TEST_VEHICLE])
    if (url.pathname === `/vehicles/${TEST_VEHICLE.id}`) return ok(TEST_VEHICLE)

    return Response.json({ success: false, error: 'Not found' }, { status: 404 })
  },
})

// biome-ignore lint/suspicious/noConsole: mock server startup log
console.log('mock API listening on :8787')
