import { describeBookingOverlapConformance } from '../booking-overlap-conformance'
import { InMemoryBookingRepository } from './booking'

// InMemory arm of the cross-impl conformance suite (#1106). Stub IDs are fine
// because the InMemory repo never validates FK references — only the Drizzle
// arm (tests/integration/booking-overlap.conformance.test.ts) seeds the real
// operator/class/location/vehicle rows the FK seal requires.
describeBookingOverlapConformance({
  adapterName: 'InMemory',
  setup: async () => ({
    repo: new InMemoryBookingRepository(),
    ids: {
      operatorId: 'op-conformance',
      classId: 'class-conformance',
      locationId: 'loc-conformance',
      vehicleId: 'veh-conformance',
      renterId: 'renter-conformance',
    },
    cleanup: async () => {
      // Each test gets a fresh repo above; no shared state to tear down.
    },
  }),
})
