import { actionsFor } from '@/vite/operator-bookings/booking-actions'
import { describe, expect, it } from 'vitest'

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
