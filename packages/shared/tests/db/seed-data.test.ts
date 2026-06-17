import { describe, expect, it } from 'vitest'
import { ACRISS_PATTERN } from '../../src/acriss'
import { BEST_CAR_RENTAL_OPERATOR_ID, BEST_CAR_RENTAL_OWNER_EMAIL } from '../../src/db/constants'
import {
  DEMO_ADD_ON_OPTIONS,
  DEMO_BOOKINGS,
  DEMO_FEE_SCHEDULES,
  DEMO_INSURANCE_OPTIONS,
  DEMO_LOCATIONS,
  DEMO_OPERATORS,
  DEMO_REGIONS,
  DEMO_RENTERS,
  DEMO_VEHICLES,
  DEMO_VEHICLE_CLASSES,
} from '../../src/db/seed-data'

// feeType<->unit coherence is NOT enforced by a DB CHECK — it lives in the Zod
// schema + FeeScheduleService (the only sanctioned writer). The seed is a second
// writer, so the fixtures must be coherent. Mirror of that rule (schema.ts note).
const COHERENT_UNIT = {
  OVERTIME_HOURLY: 'PER_HOUR',
  CLEANING_FLAT: 'FLAT',
  NO_FUEL_FLAT: 'FLAT',
} as const

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DEFAULT_TURNAROUND_MINUTES = 2880

// Slice 8 §3.1 — the demo "credibility floor": three operators, each loginable.
describe('seed-data demo operators (slice 8 §3.1)', () => {
  it('defines exactly 3 operators', () => {
    expect(DEMO_OPERATORS).toHaveLength(3)
  })

  it('has unique, kebab-case slugs', () => {
    const slugs = DEMO_OPERATORS.map((o) => o.slug)
    expect(new Set(slugs).size).toBe(3)
    for (const slug of slugs) expect(slug).toMatch(KEBAB)
  })

  it('has unique operator ids', () => {
    expect(new Set(DEMO_OPERATORS.map((o) => o.id)).size).toBe(3)
  })

  it('keeps Best Car Rental aligned with the existing seed constants (continuity)', () => {
    const best = DEMO_OPERATORS.find((o) => o.id === BEST_CAR_RENTAL_OPERATOR_ID)
    expect(best).toBeDefined()
    expect(best?.owner.email).toBe(BEST_CAR_RENTAL_OWNER_EMAIL)
  })

  it('gives every operator a distinct, well-formed owner email', () => {
    const emails = DEMO_OPERATORS.map((o) => o.owner.email)
    expect(new Set(emails).size).toBe(3)
    for (const email of emails) expect(email).toMatch(EMAIL)
  })
})

// Slice 8 §3.2 — 3 real Kansai pickup points per operator (9 total).
describe('seed-data demo locations (slice 8 §3.2)', () => {
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))

  it('defines exactly 9 locations', () => {
    expect(DEMO_LOCATIONS).toHaveLength(9)
  })

  it('gives every operator exactly 3 locations', () => {
    for (const operatorId of operatorIds) {
      const count = DEMO_LOCATIONS.filter((l) => l.operatorId === operatorId).length
      expect(count).toBe(3)
    }
  })

  it('references only defined operators', () => {
    for (const loc of DEMO_LOCATIONS) expect(operatorIds.has(loc.operatorId)).toBe(true)
  })

  it('keeps location names unique within an operator (locations_operatorId_name_unique)', () => {
    for (const operatorId of operatorIds) {
      const names = DEMO_LOCATIONS.filter((l) => l.operatorId === operatorId).map((l) => l.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  // #551: a realistic, VARIED turnaround distribution. The old "8 at 2880 + one
  // override" fixture was the root of the "booked once = car gone" illusion — every
  // store cooled down for 48h. These assertions force a credible spread instead.
  it('keeps every turnaround at or above the 60-minute floor (locations_turnaround_min_60)', () => {
    for (const l of DEMO_LOCATIONS) expect(l.defaultTurnaroundMinutes).toBeGreaterThanOrEqual(60)
  })

  it('varies turnaround across at least 3 distinct values', () => {
    const distinct = new Set(DEMO_LOCATIONS.map((l) => l.defaultTurnaroundMinutes))
    expect(distinct.size).toBeGreaterThanOrEqual(3)
  })

  it('caps the 48h maximum at no more than 2 locations', () => {
    const atMax = DEMO_LOCATIONS.filter(
      (l) => l.defaultTurnaroundMinutes === DEFAULT_TURNAROUND_MINUTES,
    )
    expect(atMax.length).toBeLessThanOrEqual(2)
  })

  it('includes at least one realistic central turnaround in [60, 180] minutes', () => {
    const central = DEMO_LOCATIONS.filter(
      (l) => l.defaultTurnaroundMinutes >= 60 && l.defaultTurnaroundMinutes <= 180,
    )
    expect(central.length).toBeGreaterThanOrEqual(1)
  })
})

// #394 — hierarchical region taxonomy (prefecture -> city -> area, adjacency
// list). Platform-global reference data: no operatorId. Demo seed scope is
// Kansai only — every region node must contain a seeded location, so we seed the
// four prefectures that own the 9 demo locations and nothing else (§3 seed-scope).
describe('seed-data demo regions (#394)', () => {
  const regionsById = new Map(DEMO_REGIONS.map((r) => [r.id, r]))
  const parentIds = new Set(
    DEMO_REGIONS.map((r) => r.parentId).filter((p): p is string => p !== null),
  )

  it('has unique region ids', () => {
    expect(new Set(DEMO_REGIONS.map((r) => r.id)).size).toBe(DEMO_REGIONS.length)
  })

  it('points every non-root parentId at a defined region', () => {
    for (const r of DEMO_REGIONS) {
      if (r.parentId !== null) expect(regionsById.has(r.parentId)).toBe(true)
    }
  })

  it('resolves every region to a prefecture root, with no cycles', () => {
    for (const start of DEMO_REGIONS) {
      const seen = new Set<string>()
      let node: (typeof DEMO_REGIONS)[number] | undefined = start
      while (node && node.parentId !== null) {
        expect(seen.has(node.id)).toBe(false) // a repeat = cycle
        seen.add(node.id)
        node = regionsById.get(node.parentId)
      }
      expect(node).toBeDefined() // chain never dangled
      expect(node?.parentId).toBeNull() // terminated at a root
    }
  })

  it('roots are exactly the four Kansai prefectures (demo seed scope §3)', () => {
    const roots = DEMO_REGIONS.filter((r) => r.parentId === null)
      .map((r) => r.nameEn)
      .sort()
    expect(roots).toEqual(['Hyogo', 'Kyoto', 'Nara', 'Osaka'])
  })

  it('gives every region a non-empty trilingual name (nameEn/nameJa/nameZh)', () => {
    for (const r of DEMO_REGIONS) {
      expect(r.nameEn.length).toBeGreaterThan(0)
      expect(r.nameJa.length).toBeGreaterThan(0)
      expect(r.nameZh.length).toBeGreaterThan(0)
    }
  })

  it('maps every location to a leaf (area) region (locations.regionId FK, #394)', () => {
    for (const loc of DEMO_LOCATIONS) {
      // FK resolves to a defined region...
      expect(regionsById.has(loc.regionId)).toBe(true)
      // ...and that region is a leaf: no other region descends from it, so it is
      // the deepest (area) node, per "region_id points at the deepest node".
      expect(parentIds.has(loc.regionId)).toBe(false)
    }
  })

  // #651 Slice 1 — region coordinates + taxonomy + slugs.
  const isLeaf = (id: string) => !parentIds.has(id)

  it('types every region by tree position (root=PREFECTURE, leaf=AREA, else CITY)', () => {
    for (const r of DEMO_REGIONS) {
      const expected = r.parentId === null ? 'PREFECTURE' : isLeaf(r.id) ? 'AREA' : 'CITY'
      expect(r.type).toBe(expected)
    }
  })

  it('marks a region assignable iff it is an AREA (leaf) node', () => {
    for (const r of DEMO_REGIONS) expect(r.assignable).toBe(r.type === 'AREA')
  })

  it('gives every assignable (area) region valid WGS84 coordinates', () => {
    for (const r of DEMO_REGIONS.filter((r) => r.assignable)) {
      const lat = r.latitude as number
      const lng = r.longitude as number
      // Finite numbers (rejects null / NaN / Infinity)...
      expect(Number.isFinite(lat)).toBe(true)
      expect(Number.isFinite(lng)).toBe(true)
      // ...inside the WGS84 envelope...
      expect(lat).toBeGreaterThanOrEqual(-90)
      expect(lat).toBeLessThanOrEqual(90)
      expect(lng).toBeGreaterThanOrEqual(-180)
      expect(lng).toBeLessThanOrEqual(180)
      // ...and not the (0,0) Atlantic-Ocean default (Kansai is firmly NE quadrant).
      expect(lat).toBeGreaterThan(0)
      expect(lng).toBeGreaterThan(0)
    }
  })

  it("centres each area region on its anchor location's coordinates", () => {
    for (const loc of DEMO_LOCATIONS) {
      const region = regionsById.get(loc.regionId)
      expect(region?.latitude).toBe(loc.latitude)
      expect(region?.longitude).toBe(loc.longitude)
    }
  })

  it('gives every region a unique, kebab-case slug', () => {
    const slugs = DEMO_REGIONS.map((r) => r.slug)
    expect(new Set(slugs).size).toBe(DEMO_REGIONS.length)
    for (const slug of slugs) expect(slug).toMatch(KEBAB)
  })

  it('exposes the renter quick-chip slugs (namba / umeda / kix)', () => {
    const slugs = new Set(DEMO_REGIONS.map((r) => r.slug))
    for (const chip of ['namba', 'umeda', 'kix']) expect(slugs.has(chip)).toBe(true)
  })
})

// Slice 8 §3.3 — ACRISS class taxonomy; no operator has a single-class fleet.
describe('seed-data demo vehicle classes (slice 8 §3.3)', () => {
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))

  it('gives every operator at least 3 classes (no single-class fleet)', () => {
    for (const operatorId of operatorIds) {
      const count = DEMO_VEHICLE_CLASSES.filter((c) => c.operatorId === operatorId).length
      expect(count).toBeGreaterThanOrEqual(3)
    }
  })

  it('references only defined operators', () => {
    for (const cls of DEMO_VEHICLE_CLASSES) expect(operatorIds.has(cls.operatorId)).toBe(true)
  })

  it('has globally-unique slugs (vehicle_classes.slug is globally unique)', () => {
    const slugs = DEMO_VEHICLE_CLASSES.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('spans 6-8 distinct ACRISS codes (credibility floor §3.3)', () => {
    const codes = new Set(DEMO_VEHICLE_CLASSES.map((c) => c.acrissCode))
    expect(codes.size).toBeGreaterThanOrEqual(6)
    expect(codes.size).toBeLessThanOrEqual(8)
  })

  it('uses only well-formed ACRISS codes (vehicle_classes_acriss_code_format)', () => {
    for (const cls of DEMO_VEHICLE_CLASSES) expect(cls.acrissCode).toMatch(ACRISS_PATTERN)
  })

  it('sets positive seats and non-negative luggage capacity (notNull columns)', () => {
    for (const cls of DEMO_VEHICLE_CLASSES) {
      expect(cls.seats).toBeGreaterThan(0)
      expect(cls.luggageCapacity).toBeGreaterThanOrEqual(0)
    }
  })
})

// Slice 8 §3.4 — insurance: each operator offers Normal + Premium.
describe('seed-data demo insurance options (slice 8 §3.4)', () => {
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))

  it('gives every operator exactly 2 options (Normal + Premium)', () => {
    for (const operatorId of operatorIds) {
      expect(DEMO_INSURANCE_OPTIONS.filter((o) => o.operatorId === operatorId)).toHaveLength(2)
    }
  })

  it('references only defined operators', () => {
    for (const opt of DEMO_INSURANCE_OPTIONS) expect(operatorIds.has(opt.operatorId)).toBe(true)
  })

  it('offers the 150000 / 250000 deductible tiers per operator', () => {
    for (const operatorId of operatorIds) {
      const deductibles = DEMO_INSURANCE_OPTIONS.filter((o) => o.operatorId === operatorId)
        .map((o) => o.deductibleJpy)
        .sort((a, b) => a - b)
      expect(deductibles).toEqual([150000, 250000])
    }
  })

  it('prices every option at a non-negative daily rate and unique active name', () => {
    for (const opt of DEMO_INSURANCE_OPTIONS) expect(opt.dailyPriceJpy).toBeGreaterThanOrEqual(0)
    for (const operatorId of operatorIds) {
      const names = DEMO_INSURANCE_OPTIONS.filter((o) => o.operatorId === operatorId).map(
        (o) => o.name,
      )
      expect(new Set(names).size).toBe(names.length)
    }
  })
})

// Demo polish (#509 follow-up) — operator add-on catalog so the Add-ons page and
// the booking wizard "extras" step show real data instead of an empty state.
// priceJpy is a FLAT per-booking charge; name is unique per operator while ACTIVE
// (add_on_options_active_name_unique). Structure mirrors insurance options.
describe('seed-data demo add-on options', () => {
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))

  it('gives every operator at least 3 add-ons (no empty Add-ons page)', () => {
    for (const operatorId of operatorIds) {
      const count = DEMO_ADD_ON_OPTIONS.filter((a) => a.operatorId === operatorId).length
      expect(count).toBeGreaterThanOrEqual(3)
    }
  })

  it('references only defined operators', () => {
    for (const a of DEMO_ADD_ON_OPTIONS) expect(operatorIds.has(a.operatorId)).toBe(true)
  })

  it('has globally-unique ids', () => {
    expect(new Set(DEMO_ADD_ON_OPTIONS.map((a) => a.id)).size).toBe(DEMO_ADD_ON_OPTIONS.length)
  })

  it('prices every add-on at a non-negative flat rate (add_on_options_price_non_negative)', () => {
    for (const a of DEMO_ADD_ON_OPTIONS) expect(a.priceJpy).toBeGreaterThanOrEqual(0)
  })

  it('keeps add-on names unique within an operator (add_on_options_active_name_unique)', () => {
    for (const operatorId of operatorIds) {
      const names = DEMO_ADD_ON_OPTIONS.filter((a) => a.operatorId === operatorId).map(
        (a) => a.name,
      )
      expect(new Set(names).size).toBe(names.length)
    }
  })
})

// Slice 8 §3.4 — fee schedules: 3 operator-wide types + >=1 per-class.
describe('seed-data demo fee schedules (slice 8 §3.4)', () => {
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))
  const classIdsByOperator = new Map(
    [...operatorIds].map((id) => [
      id,
      new Set(DEMO_VEHICLE_CLASSES.filter((c) => c.operatorId === id).map((c) => c.id)),
    ]),
  )

  it('gives every operator all three operator-wide fee types', () => {
    for (const operatorId of operatorIds) {
      const operatorWide = DEMO_FEE_SCHEDULES.filter(
        (f) => f.operatorId === operatorId && f.vehicleClassId == null,
      ).map((f) => f.feeType)
      expect(new Set(operatorWide)).toEqual(
        new Set(['OVERTIME_HOURLY', 'CLEANING_FLAT', 'NO_FUEL_FLAT']),
      )
    }
  })

  it('keeps every (feeType, unit) pair coherent (no DB CHECK guards this)', () => {
    for (const fee of DEMO_FEE_SCHEDULES) {
      expect(fee.unit).toBe(COHERENT_UNIT[fee.feeType])
    }
  })

  it('uses non-negative amounts', () => {
    for (const fee of DEMO_FEE_SCHEDULES) expect(fee.amountJpy).toBeGreaterThanOrEqual(0)
  })

  it('includes >=1 per-class fee sealed to a class of the same operator (composite FK)', () => {
    const perClass = DEMO_FEE_SCHEDULES.filter((f) => f.vehicleClassId != null)
    expect(perClass.length).toBeGreaterThanOrEqual(1)
    for (const fee of perClass) {
      expect(classIdsByOperator.get(fee.operatorId)?.has(fee.vehicleClassId as string)).toBe(true)
    }
  })
})

// Slice 8 §3.3 — ~41 vehicles across 8 ACRISS codes. Two composite-FK seals
// (class + pickup location, both to the vehicle's own operator) and the headline
// credibility floor: every storefront (location) shows >=3 distinct class summaries.
describe('seed-data demo vehicles (slice 8 §3.3)', () => {
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))
  const operatorClassKeys = new Set(DEMO_VEHICLE_CLASSES.map((c) => `${c.operatorId}::${c.id}`))
  const operatorLocationKeys = new Set(DEMO_LOCATIONS.map((l) => `${l.operatorId}::${l.id}`))
  const acrissByClassId = new Map(DEMO_VEHICLE_CLASSES.map((c) => [c.id, c.acrissCode]))

  it('defines exactly 41 vehicles (credibility floor §3.3)', () => {
    expect(DEMO_VEHICLES).toHaveLength(41)
  })

  it('references only defined operators', () => {
    for (const v of DEMO_VEHICLES) expect(operatorIds.has(v.operatorId)).toBe(true)
  })

  it('has unique ids and unique license plates (vehicles.licensePlate unique)', () => {
    expect(new Set(DEMO_VEHICLES.map((v) => v.id)).size).toBe(DEMO_VEHICLES.length)
    expect(new Set(DEMO_VEHICLES.map((v) => v.licensePlate)).size).toBe(DEMO_VEHICLES.length)
  })

  it('seals every vehicle class to its own operator (vehicles_operatorId_classId_fk)', () => {
    for (const v of DEMO_VEHICLES) {
      expect(operatorClassKeys.has(`${v.operatorId}::${v.classId}`)).toBe(true)
    }
  })

  it('seals every pickup location to its own operator (vehicles_operatorId_pickupLocationId_fk)', () => {
    for (const v of DEMO_VEHICLES) {
      expect(operatorLocationKeys.has(`${v.operatorId}::${v.pickupLocationId}`)).toBe(true)
    }
  })

  it('gives every storefront >=3 distinct class summaries (headline floor §3.3)', () => {
    for (const loc of DEMO_LOCATIONS) {
      const classesHere = new Set(
        DEMO_VEHICLES.filter((v) => v.pickupLocationId === loc.id).map((v) => v.classId),
      )
      expect(classesHere.size).toBeGreaterThanOrEqual(3)
    }
  })

  it('covers exactly the 8 ACRISS codes of the class taxonomy (no empty class)', () => {
    const codesViaVehicles = new Set(DEMO_VEHICLES.map((v) => acrissByClassId.get(v.classId)))
    const classCodes = new Set(DEMO_VEHICLE_CLASSES.map((c) => c.acrissCode))
    expect(codesViaVehicles).toEqual(classCodes)
    expect(codesViaVehicles.size).toBe(8)
  })

  it('prices every vehicle with >=1 non-negative rate (vehicles_pricing_at_least_one)', () => {
    for (const v of DEMO_VEHICLES) {
      expect(v.dailyRateJpy != null || v.hourlyRateJpy != null).toBe(true)
      if (v.dailyRateJpy != null) expect(v.dailyRateJpy).toBeGreaterThanOrEqual(0)
      if (v.hourlyRateJpy != null) expect(v.hourlyRateJpy).toBeGreaterThanOrEqual(0)
    }
  })

  it('sets positive seats (notNull integer column)', () => {
    for (const v of DEMO_VEHICLES) expect(v.seats).toBeGreaterThan(0)
  })

  // Every storefront card must show a car, not an empty frame. Photos are keyed
  // per make+model (models repeat across the fleet) with a labeled-placeholder
  // backstop, so coverage is total regardless of source availability.
  it('gives every vehicle at least one photo (no imageless storefront card)', () => {
    for (const v of DEMO_VEHICLES) {
      expect(v.photos.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('uses only well-formed https image URLs for every photo (no mixed content)', () => {
    for (const v of DEMO_VEHICLES) {
      for (const photo of v.photos) {
        expect(() => new URL(photo)).not.toThrow()
        expect(photo.startsWith('https://')).toBe(true)
      }
    }
  })

  it('covers every distinct model in the fleet with a photo set', () => {
    const models = new Set(DEMO_VEHICLES.map((v) => v.name))
    for (const model of models) {
      const sample = DEMO_VEHICLES.find((v) => v.name === model)
      expect(sample?.photos.length).toBeGreaterThanOrEqual(1)
    }
  })
})

// Slice 8 §3.5 — demo renter personas covering all three locales.
describe('seed-data demo renters (slice 8 §3.5)', () => {
  it('defines 4 renters with unique ids and @example.test emails', () => {
    expect(DEMO_RENTERS).toHaveLength(4)
    expect(new Set(DEMO_RENTERS.map((r) => r.id)).size).toBe(4)
    for (const r of DEMO_RENTERS) expect(r.email).toMatch(/@example\.test$/)
  })

  it('covers the ja/zh/en renter locales (proposal §8.2)', () => {
    expect(new Set(DEMO_RENTERS.map((r) => r.language))).toEqual(new Set(['ja', 'zh', 'en']))
  })
})

// Slice 8 §3.5 — sample bookings in marketplace shape. The booking-code alphabet
// must match the slice-6 generator (2-9A-HJ-NP-Z, excludes 0 O 1 I l) so the E2E
// operator-portal assertion reads identically (§5 step 5, §9 item 3).
describe('seed-data demo bookings (slice 8 §3.5)', () => {
  const NO_CONFUSABLES = /^[2-9A-HJ-NP-Z]{8}$/
  const operatorIds = new Set(DEMO_OPERATORS.map((o) => o.id))
  const renterIds = new Set(DEMO_RENTERS.map((r) => r.id))
  const classKeys = new Set(DEMO_VEHICLE_CLASSES.map((c) => `${c.operatorId}::${c.id}`))
  const insuranceByOperator = new Map(
    DEMO_INSURANCE_OPTIONS.map((o) => [o.id, o.operatorId] as const),
  )

  it('has unique ids and unique no-confusables booking codes', () => {
    expect(new Set(DEMO_BOOKINGS.map((b) => b.id)).size).toBe(DEMO_BOOKINGS.length)
    const codes = DEMO_BOOKINGS.map((b) => b.bookingCode)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(NO_CONFUSABLES)
  })

  it('references only defined renters and operators', () => {
    for (const b of DEMO_BOOKINGS) {
      expect(renterIds.has(b.renterId)).toBe(true)
      expect(operatorIds.has(b.operatorId)).toBe(true)
    }
  })

  it('seals every (operatorId, classId) to a defined class of that operator', () => {
    for (const b of DEMO_BOOKINGS) {
      expect(classKeys.has(`${b.operatorId}::${b.classId}`)).toBe(true)
    }
  })

  it('pairs each selected insurance option with the booking’s own operator', () => {
    for (const b of DEMO_BOOKINGS) {
      if (b.insuranceOptionId == null) continue
      expect(insuranceByOperator.get(b.insuranceOptionId)).toBe(b.operatorId)
    }
  })

  it('demos exactly one vehicle substitution (§9 item 25)', () => {
    expect(DEMO_BOOKINGS.filter((b) => b.substitute)).toHaveLength(1)
  })

  it('spreads across all four booking statuses', () => {
    expect(new Set(DEMO_BOOKINGS.map((b) => b.status))).toEqual(
      new Set(['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
    )
  })

  it('uses positive durations and non-negative prices', () => {
    for (const b of DEMO_BOOKINGS) {
      expect(b.durationHours).toBeGreaterThan(0)
      expect(b.totalPriceJpy).toBeGreaterThanOrEqual(0)
    }
  })
})
