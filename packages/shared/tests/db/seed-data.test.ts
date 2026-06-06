import { describe, expect, it } from 'vitest'
import { BEST_CAR_RENTAL_OPERATOR_ID, BEST_CAR_RENTAL_OWNER_EMAIL } from '../../src/db/constants'
import { DEMO_LOCATIONS, DEMO_OPERATORS } from '../../src/db/seed-data'

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
