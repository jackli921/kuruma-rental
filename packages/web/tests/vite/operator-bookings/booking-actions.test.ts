import { OPERATOR_BOOKING_TRANSITIONS, actionsFor } from '@/vite/operator-bookings/booking-actions'
import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'
import { describe, expect, it } from 'vitest'

// Parity guard: the component module keeps a LOCAL transition map so it never
// value-imports the drizzle schema (which would bundle drizzle-orm into the
// browser). This test imports the schema map — node-only, never bundled — so the
// schema stays the source of truth and any drift fails CI.
describe('OPERATOR_BOOKING_TRANSITIONS', () => {
  it('mirrors the schema state machine (VALID_BOOKING_TRANSITIONS) exactly', () => {
    expect(OPERATOR_BOOKING_TRANSITIONS).toEqual(VALID_BOOKING_TRANSITIONS)
  })
})

// #616: the operator Actions panel derives its buttons from this pure gate, NOT
// from VALID_BOOKING_TRANSITIONS alone — substitute and cancel follow their own
// backend rules (substitute: CONFIRMED|ACTIVE; cancel: CONFIRMED-only, the
// fee-bearing endpoint that 409s on ACTIVE).
describe('actionsFor', () => {
  it('CONFIRMED → mark-active + substitute + cancel (no mark-completed)', () => {
    expect(actionsFor('CONFIRMED')).toEqual({
      markActive: true,
      markCompleted: false,
      substitute: true,
      cancel: true,
    })
  })

  it('ACTIVE → mark-completed + substitute, but NOT cancel (the fee endpoint is CONFIRMED-only)', () => {
    expect(actionsFor('ACTIVE')).toEqual({
      markActive: false,
      markCompleted: true,
      substitute: true,
      cancel: false,
    })
  })

  it('COMPLETED → no actions (terminal)', () => {
    expect(actionsFor('COMPLETED')).toEqual({
      markActive: false,
      markCompleted: false,
      substitute: false,
      cancel: false,
    })
  })

  it('CANCELLED → no actions (terminal)', () => {
    expect(actionsFor('CANCELLED')).toEqual({
      markActive: false,
      markCompleted: false,
      substitute: false,
      cancel: false,
    })
  })
})
