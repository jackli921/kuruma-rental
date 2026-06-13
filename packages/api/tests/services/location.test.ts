import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryLocationRepository } from '../../src/repositories/in-memory'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import type { Geocoder } from '../../src/services/geocoding/types'
import { LocationService } from '../../src/services/location'
import type { Booking } from '../../src/stores'

// Fake Geocoders for the #531 write-decision matrix. The real adapter never
// throws; `throwingGeocoder` proves the service is resilient even if a future
// adapter (or a transient bug) lets one escape — a save must never be blocked.
const hitGeocoder = (lat: number, lng: number): Geocoder => ({
  geocode: async () => ({ lat, lng }),
})
const missGeocoder: Geocoder = { geocode: async () => null }
const throwingGeocoder: Geocoder = {
  geocode: async () => {
    throw new Error('geocoder exploded')
  },
}

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: PG_ERROR.UNIQUE_VIOLATION,
  })

const opA = 'op_a'
const opB = 'op_b'

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

function createInput(operatorId: string, name: string) {
  return {
    operatorId,
    name,
    address: '1-2-3 Somewhere',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE' as const,
  }
}

function seedBooking(store: Map<string, Booking>, overrides: Partial<Booking>): void {
  const now = new Date('2026-07-01T00:00:00Z')
  const booking: Booking = {
    id: crypto.randomUUID(),
    operatorId: opA,
    renterId: 'renter-1',
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-x',
    dropoffLocationId: 'loc-x',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    status: 'CONFIRMED',
    source: 'DIRECT',
    bookingCode: `BK${store.size}`,
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 12000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
  store.set(booking.id, booking)
}

describe('LocationService', () => {
  let repo: InMemoryLocationRepository
  let bookingStore: Map<string, Booking>
  let service: LocationService

  // Build a service wired to a specific Geocoder; the matrix tests vary it.
  const build = (geocoder: Geocoder = missGeocoder) =>
    new LocationService(repo, new InMemoryBookingRepository(bookingStore), geocoder)

  beforeEach(() => {
    repo = new InMemoryLocationRepository()
    bookingStore = new Map()
    // Default: a Geocoder that never resolves coords, so the existing
    // name/scope tests (which omit coords) are unaffected by geocode-on-save.
    service = build(missGeocoder)
  })

  describe('create', () => {
    it('creates a location for the caller operator', async () => {
      const result = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.location.name).toBe('Namba')
        expect(result.location.operatorId).toBe(opA)
      }
    })

    it('rejects a duplicate name within the same operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      const result = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('allows the same name under a different operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      const result = await service.create(ctxFor(opB), createInput(opB, 'Namba'))
      expect(result.ok).toBe(true)
    })

    it('maps a unique-violation that slips past the pre-check (lost race) to 409', async () => {
      // The pre-check sees no duplicate, but a concurrent insert wins the race
      // and the DB unique constraint fires. The service must surface the
      // friendly 409 rather than let the raw error escape as a 500.
      vi.spyOn(repo, 'findByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'create').mockRejectedValue(uniqueViolation())

      const result = await service.create(ctxFor(opA), createInput(opA, 'Namba'))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('update', () => {
    it('updates a field for an owned location', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opA), created.location.id, {
        defaultTurnaroundMinutes: 3600,
      })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.defaultTurnaroundMinutes).toBe(3600)
    })

    it('returns 404 (not 403) when the id belongs to another operator', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opB), created.location.id, { name: 'Hijack' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
    })

    it('loads the row (scoped) before writing, and never writes on a cross-tenant id', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const findByIdSpy = vi.spyOn(repo, 'findById')
      const updateSpy = vi.spyOn(repo, 'update')

      await service.update(ctxFor(opB), created.location.id, { name: 'Hijack' })

      expect(findByIdSpy).toHaveBeenCalledWith(ctxFor(opB), created.location.id)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('rejects renaming to a name already used by the same operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      const umeda = await service.create(ctxFor(opA), createInput(opA, 'Umeda'))
      if (!umeda.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opA), umeda.location.id, { name: 'Namba' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('allows renaming to a still-unique name', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.update(ctxFor(opA), created.location.id, { name: 'Namba South' })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.name).toBe('Namba South')
    })

    it('maps a unique-violation on rename that slips past the pre-check to 409', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      // Pre-check passes, but the concurrent rename collides at the DB.
      vi.spyOn(repo, 'findByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'update').mockRejectedValue(uniqueViolation())

      const result = await service.update(ctxFor(opA), created.location.id, { name: 'Umeda' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED for an owned location', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const result = await service.archive(ctxFor(opA), created.location.id)

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.status).toBe('ARCHIVED')
    })

    it('returns 404 and does not write when archiving another operator location', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')

      const archiveSpy = vi.spyOn(repo, 'archive')
      const result = await service.archive(ctxFor(opB), created.location.id)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
      expect(archiveSpy).not.toHaveBeenCalled()
    })

    it('refuses to archive a location with active bookings (409 + code, #412)', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')
      seedBooking(bookingStore, { pickupLocationId: created.location.id, status: 'CONFIRMED' })

      const archiveSpy = vi.spyOn(repo, 'archive')
      const result = await service.archive(ctxFor(opA), created.location.id)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.code).toBe('LOCATION_HAS_ACTIVE_BOOKINGS')
        expect(result.activeBookingsCount).toBe(1)
      }
      expect(archiveSpy).not.toHaveBeenCalled()
    })

    it('counts a booking that references the location only as DROPOFF (#412)', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')
      seedBooking(bookingStore, {
        pickupLocationId: 'other-loc',
        dropoffLocationId: created.location.id,
        status: 'ACTIVE',
      })

      const result = await service.archive(ctxFor(opA), created.location.id)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('archives when only non-active (CANCELLED) bookings reference the location (#412)', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Namba'))
      if (!created.ok) throw new Error('seed failed')
      seedBooking(bookingStore, { pickupLocationId: created.location.id, status: 'CANCELLED' })

      const result = await service.archive(ctxFor(opA), created.location.id)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.location.status).toBe('ARCHIVED')
    })
  })

  // #531 geocode-on-save decision matrix. coordinateSource is server-derived:
  // MANUAL (operator pin), GEOCODED (derived from address), or null (none).
  describe('geocode-on-save (#531 matrix)', () => {
    const seed = (coords: {
      latitude: number | null
      longitude: number | null
      coordinateSource: 'GEOCODED' | 'MANUAL' | null
    }) => repo.create({ ...createInput(opA, 'Namba'), ...coords })

    describe('create', () => {
      it('an explicit coord pair is stored verbatim as MANUAL, without geocoding', async () => {
        const geocode = vi.fn(async () => ({ lat: 0, lng: 0 }))
        const result = await build({ geocode }).create(ctxFor(opA), {
          ...createInput(opA, 'Namba'),
          latitude: 34.5,
          longitude: 135.5,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(34.5)
          expect(result.location.longitude).toBe(135.5)
          expect(result.location.coordinateSource).toBe('MANUAL')
        }
        expect(geocode).not.toHaveBeenCalled()
      })

      it('an explicit null pair clears coords (source null), without geocoding', async () => {
        const geocode = vi.fn(async () => ({ lat: 0, lng: 0 }))
        const result = await build({ geocode }).create(ctxFor(opA), {
          ...createInput(opA, 'Namba'),
          latitude: null,
          longitude: null,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBeNull()
          expect(result.location.coordinateSource).toBeNull()
        }
        expect(geocode).not.toHaveBeenCalled()
      })

      it('an address-only create geocodes the address → GEOCODED', async () => {
        const result = await build(hitGeocoder(34.69, 135.5)).create(
          ctxFor(opA),
          createInput(opA, 'Namba'),
        )
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(34.69)
          expect(result.location.longitude).toBe(135.5)
          expect(result.location.coordinateSource).toBe('GEOCODED')
        }
      })

      it('an address-only create whose geocode misses persists with null coords', async () => {
        const result = await build(missGeocoder).create(ctxFor(opA), createInput(opA, 'Namba'))
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBeNull()
          expect(result.location.coordinateSource).toBeNull()
        }
      })

      it('a throwing geocoder never blocks the save (persists with null coords)', async () => {
        const result = await build(throwingGeocoder).create(ctxFor(opA), createInput(opA, 'Namba'))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.location.coordinateSource).toBeNull()
      })
    })

    describe('update', () => {
      it('an explicit coord pair overrides to MANUAL', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'GEOCODED' })
        const geocode = vi.fn(async () => ({ lat: 0, lng: 0 }))
        const result = await build({ geocode }).update(ctxFor(opA), loc.id, {
          latitude: 35,
          longitude: 139,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(35)
          expect(result.location.coordinateSource).toBe('MANUAL')
        }
        expect(geocode).not.toHaveBeenCalled()
      })

      it('an explicit coord pair outranks regeocode:true (pins MANUAL, no geocode)', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'GEOCODED' })
        const geocode = vi.fn(async () => ({ lat: 0, lng: 0 }))
        const result = await build({ geocode }).update(ctxFor(opA), loc.id, {
          latitude: 35,
          longitude: 139,
          regeocode: true,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(35)
          expect(result.location.coordinateSource).toBe('MANUAL')
        }
        expect(geocode).not.toHaveBeenCalled()
      })

      it('an explicit null pair clears a MANUAL pin', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'MANUAL' })
        const result = await build(missGeocoder).update(ctxFor(opA), loc.id, {
          latitude: null,
          longitude: null,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBeNull()
          expect(result.location.coordinateSource).toBeNull()
        }
      })

      it('a changed address over GEOCODED coords re-geocodes → GEOCODED', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'GEOCODED' })
        const result = await build(hitGeocoder(36, 140)).update(ctxFor(opA), loc.id, {
          address: 'New address, Kyoto',
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(36)
          expect(result.location.coordinateSource).toBe('GEOCODED')
        }
      })

      it('a changed address whose geocode fails CLEARS non-manual coords (no stale pin)', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'GEOCODED' })
        const result = await build(missGeocoder).update(ctxFor(opA), loc.id, {
          address: 'New address, Kyoto',
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBeNull()
          expect(result.location.longitude).toBeNull()
          expect(result.location.coordinateSource).toBeNull()
        }
      })

      it('a changed address PRESERVES a MANUAL pin (manual wins, no geocode)', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'MANUAL' })
        const geocode = vi.fn(async () => ({ lat: 9, lng: 9 }))
        const result = await build({ geocode }).update(ctxFor(opA), loc.id, {
          address: 'New address, Kyoto',
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(1)
          expect(result.location.coordinateSource).toBe('MANUAL')
        }
        expect(geocode).not.toHaveBeenCalled()
      })

      it('regeocode:true over a MANUAL pin replaces it with GEOCODED on success', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'MANUAL' })
        const result = await build(hitGeocoder(36, 140)).update(ctxFor(opA), loc.id, {
          regeocode: true,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(36)
          expect(result.location.coordinateSource).toBe('GEOCODED')
        }
      })

      it('regeocode:true that fails PRESERVES a MANUAL pin (explicit assertion, not stale)', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'MANUAL' })
        const result = await build(missGeocoder).update(ctxFor(opA), loc.id, { regeocode: true })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(1)
          expect(result.location.coordinateSource).toBe('MANUAL')
        }
      })

      it('regeocode:true that fails PRESERVES a GEOCODED pin when the address is unchanged (transient miss / #574 throttle-skip is not stale)', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'GEOCODED' })
        const result = await build(missGeocoder).update(ctxFor(opA), loc.id, { regeocode: true })
        expect(result.ok).toBe(true)
        if (result.ok) {
          // The address still supports the old pin, so a transient re-derivation
          // miss must not wipe valid coords (#574 makes this miss routine).
          expect(result.location.latitude).toBe(1)
          expect(result.location.longitude).toBe(2)
          expect(result.location.coordinateSource).toBe('GEOCODED')
        }
      })

      it('an unrelated edit (unchanged address) preserves existing coords', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'GEOCODED' })
        const geocode = vi.fn(async () => ({ lat: 0, lng: 0 }))
        const result = await build({ geocode }).update(ctxFor(opA), loc.id, {
          defaultTurnaroundMinutes: 60,
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.location.latitude).toBe(1)
          expect(result.location.coordinateSource).toBe('GEOCODED')
          expect(result.location.defaultTurnaroundMinutes).toBe(60)
        }
        expect(geocode).not.toHaveBeenCalled()
      })

      it('never persists a client-sent regeocode flag as a column', async () => {
        const loc = await seed({ latitude: 1, longitude: 2, coordinateSource: 'MANUAL' })
        const result = await build(missGeocoder).update(ctxFor(opA), loc.id, { regeocode: true })
        expect(result.ok).toBe(true)
        if (result.ok) expect('regeocode' in result.location).toBe(false)
      })
    })
  })
})
