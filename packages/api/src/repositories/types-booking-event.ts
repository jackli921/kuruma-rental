import type { CallerContext } from '../middleware/auth'
import type { BookingEvent } from '../stores'

/**
 * Append-only booking lifecycle log (#392, proposal §5.2). The events are the
 * source of truth; `bookings.status` is the write-through projection. There is
 * deliberately NO update/delete method — immutability is enforced by the
 * interface, not just convention. Lives in its own module to keep the types.ts
 * barrel under the file-size cap; re-exported there for callers (#978).
 */
export interface BookingEventRepository {
  append(ctx: CallerContext, event: Omit<BookingEvent, 'id' | 'createdAt'>): Promise<BookingEvent>
  findByBookingId(ctx: CallerContext, bookingId: string): Promise<BookingEvent[]>
}
