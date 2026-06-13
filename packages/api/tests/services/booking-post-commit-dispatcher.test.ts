import { describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { BookingPostCommitDispatcher } from '../../src/services/booking-post-commit-dispatcher'
import type { Booking } from '../../src/stores'

const ctx: CallerContext = { userId: 'u', role: 'RENTER', bypassScope: false }
const booking = { id: 'bk-1' } as unknown as Booking

describe('BookingPostCommitDispatcher', () => {
  it('runs ensureThread THEN notifications, in order', async () => {
    const calls: string[] = []
    const ensureThread = vi.fn(async () => {
      calls.push('thread')
    })
    const notifications = {
      dispatch: vi.fn(async () => {
        calls.push('notify')
      }),
    }
    await new BookingPostCommitDispatcher(ensureThread, notifications).run(ctx, booking)
    expect(calls).toEqual(['thread', 'notify'])
  })

  it('catches a thread failure and STILL dispatches notifications (booking authoritative)', async () => {
    const ensureThread = vi.fn(async () => {
      throw new Error('thread boom')
    })
    const notifications = { dispatch: vi.fn(async () => {}) }
    const dispatcher = new BookingPostCommitDispatcher(ensureThread, notifications)
    await expect(dispatcher.run(ctx, booking)).resolves.toBeUndefined()
    expect(notifications.dispatch).toHaveBeenCalledTimes(1) // repair-on-replay: never short-circuits
  })

  it('catches a notification failure — run still resolves', async () => {
    const ensureThread = vi.fn(async () => {})
    const notifications = {
      dispatch: vi.fn(async () => {
        throw new Error('send boom')
      }),
    }
    await expect(
      new BookingPostCommitDispatcher(ensureThread, notifications).run(ctx, booking),
    ).resolves.toBeUndefined()
  })

  // #664: the lifecycle trigger flows through to the notification dispatch; an
  // omitted trigger defaults to CREATED so create()'s existing call sites and the
  // operator resend are unchanged.
  it('forwards the lifecycle trigger to notifications.dispatch (defaults to CREATED)', async () => {
    const ensureThread = vi.fn(async () => {})
    const notifications = { dispatch: vi.fn(async () => {}) }
    const dispatcher = new BookingPostCommitDispatcher(ensureThread, notifications)

    await dispatcher.run(ctx, booking)
    expect(notifications.dispatch).toHaveBeenLastCalledWith(booking, 'CREATED')

    await dispatcher.run(ctx, booking, 'CANCELLED')
    expect(notifications.dispatch).toHaveBeenLastCalledWith(booking, 'CANCELLED')
  })
})
