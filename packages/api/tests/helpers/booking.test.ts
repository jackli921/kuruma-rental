import { describe, expect, it } from 'vitest'
import { makeBooking } from './booking'

// #900: makeBooking is the single typechecked chokepoint for full-Booking
// fixtures. The compile-time guarantee (tests/helpers/** is in the api typecheck
// project, makeBooking returns `: Booking`) is the real regression guard against
// field drift; these runtime checks pin the factory's contract so it can't be
// gutted without a test failure.
describe('makeBooking fixture factory (#900)', () => {
  it('stamps the server-derived settlement default (ADVISORY) and a CONFIRMED status', () => {
    const booking = makeBooking()

    expect(booking.cancellationFeeSettlement).toBe('ADVISORY')
    expect(booking.status).toBe('CONFIRMED')
    expect(booking.id).toMatch(/[0-9a-f-]{36}/)
    expect(booking.cancellationFee).toBeNull()
  })

  it('lets a caller override persistence + settlement fields over the defaults', () => {
    const booking = makeBooking({
      id: 'bk-fixed',
      status: 'CANCELLED',
      cancellationFee: 9_000,
      cancellationFeeSettlement: 'WAIVED',
    })

    expect(booking.id).toBe('bk-fixed')
    expect(booking.status).toBe('CANCELLED')
    expect(booking.cancellationFee).toBe(9_000)
    expect(booking.cancellationFeeSettlement).toBe('WAIVED')
  })

  it('gives each call a distinct id and bookingCode so multi-row tests never collide', () => {
    const a = makeBooking()
    const b = makeBooking()

    expect(a.id).not.toBe(b.id)
    expect(a.bookingCode).not.toBe(b.bookingCode)
  })
})
