import { describe, expect, it } from 'vitest'
import { ACRISS_PATTERN } from '../../src/acriss'
import { BEST_CAR_RENTAL_OPERATOR_ID, BEST_CAR_RENTAL_OWNER_EMAIL } from '../../src/db/constants'
import {
  DEMO_FEE_SCHEDULES,
  DEMO_INSURANCE_OPTIONS,
  DEMO_LOCATIONS,
  DEMO_OPERATORS,
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

  it('defaults turnaround to 2880m with exactly one configurability override', () => {
    const overridden = DEMO_LOCATIONS.filter(
      (l) => l.defaultTurnaroundMinutes !== DEFAULT_TURNAROUND_MINUTES,
    )
    expect(overridden).toHaveLength(1)
    expect(
      DEMO_LOCATIONS.filter((l) => l.defaultTurnaroundMinutes === DEFAULT_TURNAROUND_MINUTES),
    ).toHaveLength(8)
    // override must stay non-negative (locations_turnaround_non_negative CHECK)
    for (const l of overridden) expect(l.defaultTurnaroundMinutes).toBeGreaterThanOrEqual(0)
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
