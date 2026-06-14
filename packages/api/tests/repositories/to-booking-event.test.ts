import { describe, expect, it } from 'vitest'
import { toBookingEvent } from '../../src/repositories/drizzle/shared'

// #716: BookingEventPayload is a discriminated union keyed on `type`. Rows seeded
// or persisted before that change stored the jsonb payload WITHOUT an embedded
// `type`, so the read mapper must normalize it from the authoritative `type`
// column — otherwise the operator timeline can't narrow legacy events.
describe('toBookingEvent', () => {
  it('injects the discriminant from the type column into a legacy payload that lacks it', () => {
    const legacyRow = {
      id: 'e1',
      bookingId: 'b1',
      type: 'STATUS_CHANGED' as const,
      // Legacy/seed shape: no embedded `type`.
      payload: { from: 'CONFIRMED', to: 'ACTIVE' },
      actorId: null,
      createdAt: new Date('2026-07-01T01:00:00.000Z'),
    }

    const event = toBookingEvent(legacyRow as Parameters<typeof toBookingEvent>[0])

    expect(event.payload.type).toBe('STATUS_CHANGED')
    // The discriminant must narrow the payload without a cast.
    if (event.payload.type !== 'STATUS_CHANGED') throw new Error('payload did not narrow')
    expect(event.payload.from).toBe('CONFIRMED')
    expect(event.payload.to).toBe('ACTIVE')
  })

  it('keeps a payload that already carries the discriminant', () => {
    const row = {
      id: 'e2',
      bookingId: 'b1',
      type: 'BOOKING_CANCELLED' as const,
      payload: {
        type: 'BOOKING_CANCELLED',
        cancellationFee: 5000,
        cancelledAt: '2026-07-02T01:00:00Z',
      },
      actorId: null,
      createdAt: new Date('2026-07-02T01:00:00.000Z'),
    }

    const event = toBookingEvent(row as Parameters<typeof toBookingEvent>[0])

    expect(event.payload.type).toBe('BOOKING_CANCELLED')
    if (event.payload.type !== 'BOOKING_CANCELLED') throw new Error('payload did not narrow')
    expect(event.payload.cancellationFee).toBe(5000)
  })

  it('lets the type column win when a stored payload.type disagrees (column is authoritative)', () => {
    const driftedRow = {
      id: 'e3',
      bookingId: 'b1',
      type: 'BOOKING_CANCELLED' as const,
      // Drifted jsonb: the embedded type disagrees with the column. The column is
      // the source of truth (§3.1), so the mapper overwrites rather than preserves
      // — this pins the spread precedence `{ ...payload, type: column }` relies on.
      payload: {
        type: 'STATUS_CHANGED',
        cancellationFee: 5000,
        cancelledAt: '2026-07-02T01:00:00Z',
      },
      actorId: null,
      createdAt: new Date('2026-07-02T01:00:00.000Z'),
    }

    const event = toBookingEvent(driftedRow as Parameters<typeof toBookingEvent>[0])

    expect(event.payload.type).toBe('BOOKING_CANCELLED')
  })
})
