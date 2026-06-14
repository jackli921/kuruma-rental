import { describe, expect, test, vi } from 'vitest'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../repositories/in-memory'
import {
  type Repos,
  buildDrizzleRepos,
  buildInMemoryRepos,
  buildOverrideRepos,
  buildRepos,
} from './repositories'

// The bug this bundle exists to kill (#635): a repo added to one wiring branch
// and forgotten in another. These tests pin the structural contract — every
// builder must populate the identical key set — so that divergence fails at
// test time, not at dev-server runtime.

const EXPECTED_KEYS: ReadonlyArray<keyof Repos> = [
  'vehicleClassRepo',
  'vehicleRepo',
  'bookingRepo',
  'availabilityRepo',
  'userRepo',
  'fleetOverviewRepo',
  'vehicleDetailRepo',
  'statsRepo',
  'overviewRepo',
  'threadRepo',
  'messageRepo',
  'maintenanceLogRepo',
  'photoStorage',
  'renterDocumentRepo',
  'documentStorage',
  'customerRepo',
  'operatorRepo',
  'locationRepo',
  'insuranceOptionRepo',
  'addOnRepo',
  'feeScheduleRepo',
  'notificationLogRepo',
  'storefrontRepo',
  'regionRepo',
  'paymentEventRepo',
  'paymentAnomalyRepo',
  'providerInviteRepo',
  'operatorMembershipRepo',
  'bookingEventRepo',
  'runInTransaction',
  'runOperatorGrant',
  'googleAuthRuntime',
]

function minimalOverrides() {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  return { vehicleRepo, bookingRepo, availabilityRepo }
}

// googleAuthRuntime is the sole intentionally-optional member: only the override
// and Drizzle branches build one. Every other member must be defined in every
// branch.
const ALWAYS_DEFINED = EXPECTED_KEYS.filter((k) => k !== 'googleAuthRuntime')

describe('repository bundle builders', () => {
  test('in-memory builder populates every repo member', () => {
    const repos = buildInMemoryRepos()
    expect(Object.keys(repos).sort()).toEqual([...EXPECTED_KEYS].sort())
    for (const key of ALWAYS_DEFINED) {
      expect(repos[key], `in-memory ${key}`).toBeDefined()
    }
    // No DB ⇒ no real Google OAuth runtime; the callback 503s by design.
    expect(repos.googleAuthRuntime).toBeUndefined()
  })

  test('override builder populates every repo member from the in-memory trio', () => {
    const repos = buildOverrideRepos(minimalOverrides())
    expect(Object.keys(repos).sort()).toEqual([...EXPECTED_KEYS].sort())
    for (const key of ALWAYS_DEFINED) {
      expect(repos[key], `override ${key}`).toBeDefined()
    }
  })

  test('override builder threads the three required repos through unchanged', () => {
    const overrides = minimalOverrides()
    const repos = buildOverrideRepos(overrides)
    expect(repos.vehicleRepo).toBe(overrides.vehicleRepo)
    expect(repos.bookingRepo).toBe(overrides.bookingRepo)
    expect(repos.availabilityRepo).toBe(overrides.availabilityRepo)
  })

  test('all builders expose the identical key set (no per-branch drift)', () => {
    const inMemoryKeys = Object.keys(buildInMemoryRepos()).sort()
    const overrideKeys = Object.keys(buildOverrideRepos(minimalOverrides())).sort()
    expect(overrideKeys).toEqual(inMemoryKeys)
  })

  test('buildRepos selects the override branch when overrides are supplied', () => {
    const overrides = minimalOverrides()
    const repos = buildRepos(overrides)
    expect(repos.vehicleRepo).toBe(overrides.vehicleRepo)
  })

  test('buildRepos falls back to in-memory when no overrides and no DATABASE_URL', () => {
    vi.stubEnv('DATABASE_URL', '')
    try {
      const repos = buildRepos()
      expect(repos.vehicleRepo).toBeInstanceOf(InMemoryVehicleRepository)
      expect(repos.googleAuthRuntime).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // The Drizzle branch is exercised by the integration suite (real Postgres);
  // calling buildDrizzleRepos here would require a live connection. We assert it
  // is exported so the e2e real-db harness (#634) can reuse prod wiring.
  test('buildDrizzleRepos is exported for harness reuse', () => {
    expect(typeof buildDrizzleRepos).toBe('function')
  })
})
