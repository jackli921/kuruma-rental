import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import type { NotificationLog } from '../../stores'
import { operatorReadScope } from '../../tenancy'
import {
  MAX_NOTIFICATION_ATTEMPTS,
  type NotificationLogFilters,
  type NotificationLogNoRecipient,
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
      if (existing) {
        // A row that has not yet sent recomputes its recipient set at each send
        // (#878 member fan-out), so refresh the audit recipient/locale to match the
        // address the resend will use. Never touch a terminal/in-flight row: its
        // recorded recipient must reflect who the mail was actually sent to.
        if (existing.status === 'QUEUED' || existing.status === 'FAILED') {
          const refreshed = { ...existing, recipient: data.recipient, locale: data.locale }
          this.store.set(existing.id, refreshed)
          return refreshed
        }
        return existing // never reset a row's lifecycle
      }
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

  async recordNoRecipient(data: NotificationLogNoRecipient): Promise<NotificationLog> {
    const existingId = this.byKey.get(data.idempotencyKey)
    if (existingId) {
      const existing = this.store.get(existingId)
      if (existing) return existing // idempotent — one terminal record per skip
    }
    const ts = this.now()
    const row: NotificationLog = {
      id: crypto.randomUUID(),
      bookingId: data.bookingId,
      operatorId: data.operatorId,
      kind: data.kind,
      channel: 'EMAIL',
      recipient: '',
      locale: '',
      status: 'NO_RECIPIENT',
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
    // #483: claim() already bumped attempts, so this row's count includes the
    // attempt being recorded. At the cap, flip to terminal DEAD — claim() never
    // re-arms it, so a poison recipient stops being re-sent.
    const status = row.attempts >= MAX_NOTIFICATION_ATTEMPTS ? 'DEAD' : 'FAILED'
    this.store.set(id, { ...row, status, error, updatedAt: this.now() })
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
