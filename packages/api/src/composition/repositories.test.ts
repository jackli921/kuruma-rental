import type { RunTx } from '@kuruma/shared/db'
import * as schema from '@kuruma/shared/db/schema'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, test, vi } from 'vitest'
import type { Db } from '../repositories/drizzle'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../repositories/in-memory'
import {
  type Repos,
  assertPhotosBaseConfigured,
  buildDrizzleRepos,
  buildInMemoryRepos,
  buildOverrideRepos,
  buildRepos,
} from './repositories'

// The bug this bundle exists to kill (#635): a repo added to one wiring branch
// and forgotten in another. These tests pin the structural contract — every
// builder must populate the identical key set — so that divergence fails at
// test time, not at dev-server runtime.

// `Record<keyof Repos, true>` makes the expected set exhaustive: adding a member
// to `Repos` without listing it here is a compile error, so the contract these
// tests pin can't silently fall behind the bundle it guards.
const EXPECTED_KEY_MAP: Record<keyof Repos, true> = {
  vehicleClassRepo: true,
  vehicleRepo: true,
  bookingRepo: true,
  availabilityRepo: true,
  userRepo: true,
  fleetOverviewRepo: true,
  vehicleDetailRepo: true,
  statsRepo: true,
  overviewRepo: true,
  threadRepo: true,
  messageRepo: true,
  maintenanceLogRepo: true,
  photoStorage: true,
  renterDocumentRepo: true,
  documentStorage: true,
  customerRepo: true,
  operatorRepo: true,
  locationRepo: true,
  insuranceOptionRepo: true,
  addOnRepo: true,
  feeScheduleRepo: true,
  classRatePlanRepo: true,
  notificationLogRepo: true,
  complianceAlertLogRepo: true,
  storefrontRepo: true,
  regionRepo: true,
  paymentEventRepo: true,
  paymentAnomalyRepo: true,
  providerInviteRepo: true,
  operatorMembershipRepo: true,
  auditLogRepo: true,
  bookingEventRepo: true,
  runInTransaction: true,
  runOperatorGrant: true,
  photosPublicUrl: true,
  googleAuthRuntime: true,
}

const EXPECTED_KEYS = Object.keys(EXPECTED_KEY_MAP) as ReadonlyArray<keyof Repos>

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

  // #634: the e2e real-db harness reuses this factory instead of hand-listing
  // every Drizzle repo (the omission that silently emptied the operator add-ons
  // page). Construction needs no live connection — repos only store the db — so
  // we inject a stub db + recording tx runner and assert the full bundle wires
  // through them. The Drizzle branch's real queries stay covered by the
  // integration suite (real Postgres).
  test('buildDrizzleRepos populates every member from an injected db + runTx', async () => {
    const calls: string[] = []
    // A real postgres-js drizzle instance: lazy, so no socket opens at
    // construction (mirrors the harness). The Auth.js DrizzleAdapter validates
    // the db's type, so a bare {} won't do — but the connection is never used,
    // because the recording runTx below never executes a query.
    const client = postgres('postgres://u:p@127.0.0.1:1/none', { max: 1 })
    const stubDb = drizzle(client, { schema }) as unknown as Db
    const recordingRunTx = (() => {
      calls.push('runTx')
      return Promise.resolve(undefined)
    }) as unknown as RunTx

    try {
      const repos = buildDrizzleRepos({ db: stubDb, runTx: recordingRunTx })

      // No repo silently omitted — the harness-omission landmine #634 closes.
      expect(Object.keys(repos).sort()).toEqual([...EXPECTED_KEYS].sort())
      for (const key of ALWAYS_DEFINED) {
        expect(repos[key], `drizzle ${key}`).toBeDefined()
      }

      // tx-bound paths delegate to the INJECTED runner, not getDb()/prod runTx.
      await repos.runInTransaction(async () => undefined as never)
      expect(calls).toEqual(['runTx'])
    } finally {
      await client.end({ timeout: 0 })
    }
  })
})

// #967: an empty photos base silently disables BOTH the r2: re-encode and the
// cross-tenant photo-spoof guard. When the bucket binding IS present, an empty
// base reopens the IDOR (a PATCH'd `${bucketHost}/vehicles/<victim>/x.jpg` is
// stored literally and rendered). Fail loud at the composition root instead.
describe('assertPhotosBaseConfigured (#967 fail-loud config invariant)', () => {
  test('throws when the bucket is bound but the public base is empty', () => {
    expect(() => assertPhotosBaseConfigured(true, '')).toThrow(/VEHICLE_PHOTOS_PUBLIC_URL/)
  })

  test('passes when the bucket is bound and the base is set', () => {
    expect(() => assertPhotosBaseConfigured(true, 'https://photos.kuruma.app')).not.toThrow()
  })

  test('passes when no bucket is bound, regardless of base (dev/in-memory)', () => {
    expect(() => assertPhotosBaseConfigured(false, '')).not.toThrow()
  })
})
