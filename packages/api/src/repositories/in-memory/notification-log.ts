import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import type { NotificationLog } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import {
  type NotificationLogFilters,
  type NotificationLogRepository,
  type NotificationLogUpsert,
  SEND_LEASE_MS,
} from '../types'

/**
 * In-memory NotificationLogRepository. The `now` clock is injectable so lease
 * boundaries (SEND_LEASE_MS) are deterministically testable without sleeping.
 */
export class InMemoryNotificationLogRepository implements NotificationLogRepository {
  private readonly store: Map<string, NotificationLog>
  private readonly byKey: Map<string, string> // idempotencyKey -> id

  constructor(
    store?: Map<string, NotificationLog>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store ?? new Map()
    this.byKey = new Map()
    for (const row of this.store.values()) this.byKey.set(row.idempotencyKey, row.id)
  }

  async upsertQueued(data: NotificationLogUpsert): Promise<NotificationLog> {
    const existingId = this.byKey.get(data.idempotencyKey)
    if (existingId) {
      const existing = this.store.get(existingId)
      if (existing) return existing // replay no-op — never reset a row's lifecycle
    }
    const ts = this.now()
    const row: NotificationLog = {
      id: crypto.randomUUID(),
      bookingId: data.bookingId,
      operatorId: data.operatorId,
      kind: data.kind,
      channel: 'EMAIL',
      recipient: data.recipient,
      locale: data.locale,
      status: 'QUEUED',
      providerMessageId: null,
      error: null,
      attempts: 0,
      idempotencyKey: data.idempotencyKey,
      createdAt: ts,
      updatedAt: ts,
    }
    this.store.set(row.id, row)
    this.byKey.set(row.idempotencyKey, row.id)
    return row
  }

  async claim(id: string): Promise<NotificationLog | undefined> {
    const row = this.store.get(id)
    if (!row) return undefined
    const claimable =
      row.status === 'QUEUED' ||
      row.status === 'FAILED' ||
      (row.status === 'SENDING' && this.now().getTime() - row.updatedAt.getTime() >= SEND_LEASE_MS)
    if (!claimable) return undefined
    const claimed: NotificationLog = {
      ...row,
      status: 'SENDING',
      attempts: row.attempts + 1,
      updatedAt: this.now(),
    }
    this.store.set(id, claimed)
    return claimed
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    const row = this.store.get(id)
    if (!row) return
    this.store.set(id, {
      ...row,
      status: 'SENT',
      providerMessageId,
      error: null,
      updatedAt: this.now(),
    })
  }

  async markFailed(id: string, error: string): Promise<void> {
    const row = this.store.get(id)
    if (!row) return
    this.store.set(id, { ...row, status: 'FAILED', error, updatedAt: this.now() })
  }

  async findAll(ctx: CallerContext, filters?: NotificationLogFilters): Promise<NotificationLog[]> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    return [...this.store.values()]
      .filter((r) => {
        if (scope.kind === 'operator') return r.operatorId === scope.operatorId
        if (filters?.operatorId) return r.operatorId === filters.operatorId
        return true
      })
      .filter((r) => (filters?.bookingId ? r.bookingId === filters.bookingId : true))
  }

  async findById(ctx: CallerContext, id: string): Promise<NotificationLog | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const row = this.store.get(id)
    if (!row) return undefined
    if (scope.kind === 'operator' && row.operatorId !== scope.operatorId) return undefined
    return row
  }
}
