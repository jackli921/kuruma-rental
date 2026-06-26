import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { MAX_NOTIFICATION_ATTEMPTS, SEND_LEASE_MS } from '../../src/repositories/types'

const OP1 = 'op-1'
const OP2 = 'op-2'
const operatorCtx = {
  userId: 'u1',
  role: 'OPERATOR_OWNER' as const,
  operatorId: OP1,
  bypassScope: false,
}
const otherOperatorCtx = {
  userId: 'u2',
  role: 'OPERATOR_OWNER' as const,
  operatorId: OP2,
  bypassScope: false,
}
const renterCtx = { userId: 'r1', role: 'RENTER' as const, bypassScope: false }

const seed = (
  over: Partial<Parameters<InMemoryNotificationLogRepository['upsertQueued']>[0]> = {},
) => ({
  bookingId: 'bk-1',
  operatorId: OP1,
  kind: 'RENTER_BOOKING_CONFIRM' as const,
  recipient: 'renter@example.com',
  locale: 'en',
  idempotencyKey: 'notify:bk-1:RENTER_BOOKING_CONFIRM',
  ...over,
})

describe('InMemoryNotificationLogRepository', () => {
  let now: Date
  let repo: InMemoryNotificationLogRepository

  beforeEach(() => {
    now = new Date('2026-07-01T00:00:00Z')
    repo = new InMemoryNotificationLogRepository(undefined, () => now)
  })

  it('upsertQueued inserts a QUEUED row with EMAIL channel and zero attempts', async () => {
    const row = await repo.upsertQueued(seed())
    expect(row.status).toBe('QUEUED')
    expect(row.channel).toBe('EMAIL')
    expect(row.attempts).toBe(0)
    expect(row.recipient).toBe('renter@example.com')
  })

  it('upsertQueued is idempotent — a replay returns a terminal SENT row unchanged', async () => {
    const first = await repo.upsertQueued(seed({ recipient: 'sent@op.com' }))
    await repo.claim(first.id)
    await repo.markSent(first.id, 'msg-1')
    const replay = await repo.upsertQueued(seed({ recipient: 'changed@op.com', locale: 'ja' }))
    expect(replay.id).toBe(first.id)
    expect(replay.status).toBe('SENT') // NOT reset to QUEUED
    // The audit recipient/locale must reflect who the mail was ACTUALLY sent to —
    // a post-send replay never rewrites a terminal row's address.
    expect(replay.recipient).toBe('sent@op.com')
    expect(replay.locale).toBe('en')
  })

  // The operator-alert recipient set (#878) is recomputed at each send; a row that
  // has not yet sent (QUEUED/FAILED) must refresh its audit recipient/locale so the
  // notification_log column matches the Bcc list the resend actually used.
  it('upsertQueued refreshes recipient/locale on a re-sendable FAILED row', async () => {
    const first = await repo.upsertQueued(seed({ recipient: 'owner@op.com', locale: 'en' }))
    await repo.claim(first.id)
    await repo.markFailed(first.id, 'transient') // non-terminal, still reclaimable
    const refreshed = await repo.upsertQueued(
      seed({ recipient: 'owner@op.com, staff@op.com', locale: 'ja' }),
    )
    expect(refreshed.id).toBe(first.id)
    expect(refreshed.status).toBe('FAILED') // lifecycle untouched
    expect(refreshed.attempts).toBe(1) // attempts NOT reset
    expect(refreshed.recipient).toBe('owner@op.com, staff@op.com')
    expect(refreshed.locale).toBe('ja')
  })

  it('upsertQueued refreshes recipient/locale on a still-QUEUED row', async () => {
    const first = await repo.upsertQueued(seed({ recipient: 'owner@op.com' }))
    const refreshed = await repo.upsertQueued(seed({ recipient: 'owner@op.com, staff@op.com' }))
    expect(refreshed.id).toBe(first.id)
    expect(refreshed.status).toBe('QUEUED')
    expect(refreshed.recipient).toBe('owner@op.com, staff@op.com')
  })

  // #681: a no-recipient skip is persisted as a terminal NO_RECIPIENT row.
  const noRecipient = (over: Record<string, unknown> = {}) => ({
    bookingId: 'bk-1',
    operatorId: OP1,
    kind: 'RENTER_BOOKING_CONFIRM' as const,
    idempotencyKey: 'notify:bk-1:RENTER_BOOKING_CONFIRM:no_recipient',
    ...over,
  })

  it('recordNoRecipient inserts a terminal NO_RECIPIENT row with empty address/locale', async () => {
    const row = await repo.recordNoRecipient(noRecipient())
    expect(row.status).toBe('NO_RECIPIENT')
    expect(row.recipient).toBe('')
    expect(row.locale).toBe('')
    expect(row.attempts).toBe(0)
  })

  it('recordNoRecipient is idempotent on its key', async () => {
    const a = await repo.recordNoRecipient(noRecipient())
    const b = await repo.recordNoRecipient(noRecipient())
    expect(b.id).toBe(a.id)
  })

  it('a NO_RECIPIENT record coexists with a real send row for the same (booking, kind)', async () => {
    await repo.recordNoRecipient(noRecipient())
    const sendRow = await repo.upsertQueued(seed()) // bare key — not poisoned by the skip
    expect(sendRow.status).toBe('QUEUED')
    const all = await repo.findAll(operatorCtx)
    expect(all).toHaveLength(2)
    expect(all.map((r) => r.status).sort()).toEqual(['NO_RECIPIENT', 'QUEUED'])
  })

  it('claim flips QUEUED -> SENDING and bumps attempts', async () => {
    const row = await repo.upsertQueued(seed())
    const claimed = await repo.claim(row.id)
    expect(claimed?.status).toBe('SENDING')
    expect(claimed?.attempts).toBe(1)
  })

  it('claim reclaims a FAILED row', async () => {
    const row = await repo.upsertQueued(seed())
    await repo.claim(row.id)
    await repo.markFailed(row.id, 'boom')
    const reclaimed = await repo.claim(row.id)
    expect(reclaimed?.status).toBe('SENDING')
    expect(reclaimed?.attempts).toBe(2)
  })

  it('claim returns undefined while a LIVE SENDING lease holds the row (concurrent-send guard)', async () => {
    const row = await repo.upsertQueued(seed())
    await repo.claim(row.id) // first sender holds the lease
    const second = await repo.claim(row.id)
    expect(second).toBeUndefined()
  })

  it('claim reclaims a SENDING row once its lease has EXPIRED', async () => {
    const row = await repo.upsertQueued(seed())
    await repo.claim(row.id)
    now = new Date(now.getTime() + SEND_LEASE_MS + 1000)
    const reclaimed = await repo.claim(row.id)
    expect(reclaimed?.status).toBe('SENDING')
    expect(reclaimed?.attempts).toBe(2)
  })

  it('claim never reclaims a terminal SENT row', async () => {
    const row = await repo.upsertQueued(seed())
    await repo.claim(row.id)
    await repo.markSent(row.id, 'msg-1')
    now = new Date(now.getTime() + SEND_LEASE_MS * 10)
    expect(await repo.claim(row.id)).toBeUndefined()
  })

  it('markSent / markFailed set terminal state + provider id / error', async () => {
    const row = await repo.upsertQueued(seed())
    await repo.claim(row.id)
    await repo.markSent(row.id, 'msg-42')
    const sent = await repo.findById(SYSTEM_CONTEXT, row.id)
    expect(sent).toMatchObject({ status: 'SENT', providerMessageId: 'msg-42' })

    const other = await repo.upsertQueued(
      seed({
        idempotencyKey: 'notify:bk-1:OPERATOR_BOOKING_ALERT',
        kind: 'OPERATOR_BOOKING_ALERT',
      }),
    )
    await repo.claim(other.id)
    await repo.markFailed(other.id, 'SMTP 550')
    const failed = await repo.findById(SYSTEM_CONTEXT, other.id)
    expect(failed).toMatchObject({ status: 'FAILED', error: 'SMTP 550' })
  })

  // #483: drive a row's attempts up to N via claim->markFailed (FAILED is always
  // reclaimable, so no lease wait is needed between cycles).
  const failNTimes = async (id: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await repo.claim(id)
      await repo.markFailed(id, 'boom')
    }
  }

  it('markFailed BELOW the attempt cap stays FAILED (still reclaimable)', async () => {
    const row = await repo.upsertQueued(seed())
    await failNTimes(row.id, MAX_NOTIFICATION_ATTEMPTS - 1)
    const failed = await repo.findById(SYSTEM_CONTEXT, row.id)
    expect(failed).toMatchObject({ status: 'FAILED', attempts: MAX_NOTIFICATION_ATTEMPTS - 1 })
  })

  it('markFailed AT the attempt cap flips to terminal DEAD (poison-message sink)', async () => {
    const row = await repo.upsertQueued(seed())
    await failNTimes(row.id, MAX_NOTIFICATION_ATTEMPTS)
    const dead = await repo.findById(SYSTEM_CONTEXT, row.id)
    expect(dead).toMatchObject({ status: 'DEAD', attempts: MAX_NOTIFICATION_ATTEMPTS })
  })

  it('claim never reclaims a terminal DEAD row (stops re-sending a poison recipient)', async () => {
    const row = await repo.upsertQueued(seed())
    await failNTimes(row.id, MAX_NOTIFICATION_ATTEMPTS)
    now = new Date(now.getTime() + SEND_LEASE_MS * 10)
    expect(await repo.claim(row.id)).toBeUndefined()
  })

  describe('findAll scoping', () => {
    beforeEach(async () => {
      await repo.upsertQueued(seed())
      await repo.upsertQueued(
        seed({
          operatorId: OP2,
          bookingId: 'bk-2',
          idempotencyKey: 'notify:bk-2:RENTER_BOOKING_CONFIRM',
        }),
      )
    })

    it('an operator caller sees only its own operator rows', async () => {
      const rows = await repo.findAll(operatorCtx)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.operatorId).toBe(OP1)
    })

    it('rejects a RENTER with ForbiddenError (private ledger)', async () => {
      await expect(repo.findAll(renterCtx)).rejects.toThrow(ForbiddenError)
    })

    it('a bypass caller sees all rows, filterable by bookingId', async () => {
      expect(await repo.findAll(SYSTEM_CONTEXT, { includeAllOperators: true })).toHaveLength(2)
      expect(
        await repo.findAll(SYSTEM_CONTEXT, { bookingId: 'bk-2', includeAllOperators: true }),
      ).toHaveLength(1)
    })
  })

  describe('findById scoping', () => {
    it('a cross-operator id resolves to undefined (no tenant leak)', async () => {
      const row = await repo.upsertQueued(seed())
      expect(await repo.findById(operatorCtx, row.id)).toBeDefined()
      expect(await repo.findById(otherOperatorCtx, row.id)).toBeUndefined()
    })
  })
})
