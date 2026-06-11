import { Route } from '@/routes/$locale/_renter/bookings/confirmation'
import { isNotFound } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

// The loader is the route's only branching logic: it maps a missing bookingId or a
// null (404 -> null, IDOR-sealed) booking to notFound(), and only fetches the class
// when the booking carries a classId. The api helpers it composes (fetchBookingById
// 404->null, fetchClassById 404->null) are covered in their own suites.
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { bookingId: string | undefined }
}) => Promise<unknown>

function makeContext(ensureQueryData: ReturnType<typeof vi.fn>) {
  return { context: { queryClient: { ensureQueryData } } }
}

const booking = { id: 'b-1', classId: 'c1', bookingCode: 'ABCD1234' }

describe('confirmation route loader', () => {
  it('throws notFound when no bookingId is in the URL', async () => {
    const ensureQueryData = vi.fn()
    await loader({ ...makeContext(ensureQueryData), deps: { bookingId: undefined } }).then(
      () => {
        throw new Error('expected notFound')
      },
      (err) => expect(isNotFound(err)).toBe(true),
    )
    expect(ensureQueryData).not.toHaveBeenCalled()
  })

  it('throws notFound when the booking resolves to null (unknown or not owned)', async () => {
    const ensureQueryData = vi.fn().mockResolvedValueOnce(null)
    await loader({ ...makeContext(ensureQueryData), deps: { bookingId: 'missing' } }).then(
      () => {
        throw new Error('expected notFound')
      },
      (err) => expect(isNotFound(err)).toBe(true),
    )
  })

  it('returns the booking with a null class when it has no classId', async () => {
    const ensureQueryData = vi.fn().mockResolvedValueOnce({ ...booking, classId: null })
    const result = await loader({
      ...makeContext(ensureQueryData),
      deps: { bookingId: 'b-1' },
    })
    expect(result).toEqual({ booking: { ...booking, classId: null }, vehicleClass: null })
    expect(ensureQueryData).toHaveBeenCalledTimes(1)
  })

  it('resolves the class when the booking carries a classId', async () => {
    const vehicleClass = { id: 'c1', name: 'Compact' }
    const ensureQueryData = vi
      .fn()
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(vehicleClass)
    const result = await loader({
      ...makeContext(ensureQueryData),
      deps: { bookingId: 'b-1' },
    })
    expect(result).toEqual({ booking, vehicleClass })
    expect(ensureQueryData).toHaveBeenCalledTimes(2)
  })
})
