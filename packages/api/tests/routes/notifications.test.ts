import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import type { BookingRepository } from '../../src/repositories/types'
import { createNotificationRoutes } from '../../src/routes/notifications'
import type { EmailSender } from '../../src/services/email/email-sender'
import { NotificationService } from '../../src/services/notification'
import { NotificationDispatcher } from '../../src/services/notification-dispatcher'
import type { Booking, NotificationLog } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

// HTTP-boundary tests for createNotificationRoutes (#706). The notification
// ledger is operator-private: the role gate (RENTER/PARTNER -> 403) and the
// bypass-caller scope-required branch (ADMIN/STAFF with neither operatorId nor
// includeAll -> 400) live ONLY in the route handler, so they need a route-level
// test. Mirrors dashboard-overview.test.ts (testAuthMiddleware + in-memory repo).

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
const RENTER_ID = 'renter-1'
const NOW = new Date('2026-07-01T00:00:00Z')

function makeBooking(over: Partial<Booking>): Booking {
  return {
    id: 'bk-a',
    operatorId: OP_A,
    renterId: RENTER_ID,
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-2',
    startAt: NOW,
    endAt: NOW,
    effectiveEndAt: NOW,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 24000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

/**
 * Seed the in-memory ledger with one OPERATOR_BOOKING_ALERT row per operator by
 * running the real dispatch path, then return a wired NotificationService. Going
 * through the dispatcher (not hand-built rows) keeps the seeded rows in lock-step
 * with how production writes them, so the scoping assertions can't drift.
 */
async function setup() {
  const logRepo = new InMemoryNotificationLogRepository()
  const bookingA = makeBooking({ id: 'bk-a', operatorId: OP_A })
  const bookingB = makeBooking({ id: 'bk-b', operatorId: OP_B, bookingCode: 'EFGH6789' })

  const operatorRepo = new InMemoryOperatorRepository(
    new Map([
      [
        OP_A,
        {
          id: OP_A,
          slug: 'op-a',
          name: 'Op A',
          preAuthHandoffUrl: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      [
        OP_B,
        {
          id: OP_B,
          slug: 'op-b',
          name: 'Op B',
          preAuthHandoffUrl: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    ]),
  )
  const userRepo = new InMemoryUserRepository(
    new Map([
      [
        'owner-a',
        {
          id: 'owner-a',
          name: 'Owner A',
          email: 'owner-a@op.com',
          phone: null,
          language: 'ja',
          country: null,
          role: 'OPERATOR_OWNER',
          operatorId: OP_A,
        },
      ],
      [
        'owner-b',
        {
          id: 'owner-b',
          name: 'Owner B',
          email: 'owner-b@op.com',
          phone: null,
          language: 'ja',
          country: null,
          role: 'OPERATOR_OWNER',
          operatorId: OP_B,
        },
      ],
    ]),
  )
  const fakeVehicleRepo = {
    findById: async () => ({ name: 'Aqua', make: null, model: null, licensePlate: null }),
  } as unknown as ConstructorParameters<typeof NotificationDispatcher>[2]
  const fakeLocationRepo = {
    findById: async (_c: unknown, id: string) => ({ id, name: id }),
  } as unknown as ConstructorParameters<typeof NotificationDispatcher>[4]
  const sender: EmailSender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }

  const dispatcher = new NotificationDispatcher(
    logRepo,
    operatorRepo,
    fakeVehicleRepo,
    userRepo,
    fakeLocationRepo,
    sender,
    { emailFrom: 'noreply@kuruma.jp' },
  )

  const bookingsById = new Map([
    [bookingA.id, bookingA],
    [bookingB.id, bookingB],
  ])
  const bookingRepo = {
    findById: async (_c: unknown, id: string) => bookingsById.get(id),
  } as unknown as BookingRepository

  // One OPERATOR_BOOKING_ALERT row per operator (recipient = that operator's owner).
  await dispatcher.processOne(bookingA, 'OPERATOR_BOOKING_ALERT')
  await dispatcher.processOne(bookingB, 'OPERATOR_BOOKING_ALERT')

  const service = new NotificationService(logRepo, bookingRepo, dispatcher)
  return { service, logRepo, sender }
}

function mount(service: NotificationService, role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createNotificationRoutes(service))
  return app
}

/** All rows in the ledger, read with a full-access bypass context. */
async function allRows(logRepo: InMemoryNotificationLogRepository): Promise<NotificationLog[]> {
  return logRepo.findAll({ userId: 'sys', role: 'PLATFORM_ADMIN', bypassScope: true })
}

describe('GET /notifications — auth & role gate', () => {
  it('401 when unauthenticated', async () => {
    const { service } = await setup()
    const app = new Hono()
    app.route('/', createNotificationRoutes(service))
    expect((await app.request('/notifications')).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER'] as const)('403 for %s (operator-private ledger)', async (role) => {
    const { service } = await setup()
    const res = await mount(service, role).request('/notifications')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ success: false, error: 'Forbidden' })
  })
})

describe('GET /notifications — cross-operator scope required for bypass callers', () => {
  it.each(['ADMIN', 'STAFF', 'PLATFORM_ADMIN'] as const)(
    '400 for %s with neither operatorId nor includeAll',
    async (role) => {
      const { service } = await setup()
      const res = await mount(service, role).request('/notifications')
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        success: false,
        error: 'operatorId or includeAll=true is required for cross-operator reads',
      })
    },
  )

  it('ADMIN with operatorId returns only that operator rows', async () => {
    const { service } = await setup()
    const res = await mount(service, 'ADMIN').request(`/notifications?operatorId=${OP_A}`)
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: NotificationLog[] }
    expect(data).toHaveLength(1)
    expect(data[0]?.operatorId).toBe(OP_A)
  })

  it('ADMIN with includeAll=true returns every operator row', async () => {
    const { service, logRepo } = await setup()
    const res = await mount(service, 'ADMIN').request('/notifications?includeAll=true')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: NotificationLog[] }
    expect(data).toHaveLength((await allRows(logRepo)).length)
    expect(new Set(data.map((r) => r.operatorId))).toEqual(new Set([OP_A, OP_B]))
  })
})

describe('GET /notifications — operator caller is auto-scoped', () => {
  it.each(['OPERATOR_OWNER', 'OPERATOR_STAFF'] as const)(
    '%s receives only its own operator rows without naming operatorId',
    async (role) => {
      const { service } = await setup()
      const res = await mount(service, role, OP_A).request('/notifications')
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as { data: NotificationLog[] }
      expect(data).toHaveLength(1)
      expect(data.every((r) => r.operatorId === OP_A)).toBe(true)
    },
  )

  it('cannot widen scope to another operator via operatorId (param ignored for operators)', async () => {
    const { service } = await setup()
    const res = await mount(service, 'OPERATOR_OWNER', OP_A).request(
      `/notifications?operatorId=${OP_B}`,
    )
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: NotificationLog[] }
    expect(data).toHaveLength(1)
    expect(data[0]?.operatorId).toBe(OP_A)
  })
})

// RENTER/PARTNER -> 403 is enforced at two layers: the route's MANAGEMENT_READ_ROLES
// gate AND the repo's requireManagementRead seal (findById throws ForbiddenError ->
// 403). These tests lock the end-to-end property; the GET tests above are the ones
// that fail specifically when the *route* gate is removed.
describe('POST /notifications/:id/resend — role gate & scoping', () => {
  it.each(['RENTER', 'PARTNER'] as const)('403 for %s', async (role) => {
    const { service, logRepo } = await setup()
    const [row] = await allRows(logRepo)
    const res = await mount(service, role).request(`/notifications/${row!.id}/resend`, {
      method: 'POST',
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ success: false, error: 'Forbidden' })
  })

  it('does not invoke the email sender on a forbidden resend', async () => {
    const { service, logRepo, sender } = await setup()
    const [row] = await allRows(logRepo)
    ;(sender.send as ReturnType<typeof vi.fn>).mockClear()
    await mount(service, 'RENTER').request(`/notifications/${row!.id}/resend`, { method: 'POST' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it("404 when an operator resends another operator's notification id", async () => {
    const { service, logRepo } = await setup()
    const opBRow = (await allRows(logRepo)).find((r) => r.operatorId === OP_B)
    const res = await mount(service, 'OPERATOR_OWNER', OP_A).request(
      `/notifications/${opBRow!.id}/resend`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ success: false, error: 'Notification not found' })
  })

  it('200 when an operator resends its OWN notification id', async () => {
    const { service, logRepo } = await setup()
    const opARow = (await allRows(logRepo)).find((r) => r.operatorId === OP_A)
    const res = await mount(service, 'OPERATOR_OWNER', OP_A).request(
      `/notifications/${opARow!.id}/resend`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: { outcome: string } }
    expect(body.success).toBe(true)
    // Row was already SENT by the seed dispatch -> a resend is a no-op, not a re-send.
    expect(body.data.outcome).toBe('already_sent')
  })
})
