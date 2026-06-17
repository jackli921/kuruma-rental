import { notificationLog } from '@kuruma/shared/db/schema'
import { type SQL, and, eq, inArray, or, sql } from 'drizzle-orm'
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
import type { Db } from './shared'

type Row = typeof notificationLog.$inferSelect

function toNotificationLog(r: Row): NotificationLog {
  return {
    id: r.id,
    bookingId: r.bookingId,
    operatorId: r.operatorId,
    kind: r.kind,
    channel: r.channel,
    recipient: r.recipient,
    locale: r.locale,
    status: r.status,
    providerMessageId: r.providerMessageId,
    error: r.error,
    attempts: r.attempts,
    idempotencyKey: r.idempotencyKey,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

const LEASE_SECONDS = SEND_LEASE_MS / 1000

export class DrizzleNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly db: Db) {}

  async upsertQueued(data: NotificationLogUpsert): Promise<NotificationLog> {
    const [upserted] = await this.db
      .insert(notificationLog)
      .values({
        bookingId: data.bookingId,
        operatorId: data.operatorId,
        kind: data.kind,
        recipient: data.recipient,
        locale: data.locale,
        idempotencyKey: data.idempotencyKey,
      })
      .onConflictDoUpdate({
        target: notificationLog.idempotencyKey,
        // The recipient set is recomputed at each send (#878 member fan-out), so a
        // row that has NOT yet sent refreshes its audit recipient/locale to match
        // the address the resend will use. `setWhere` confines this to re-sendable
        // rows: a terminal (SENT/DEAD/NO_RECIPIENT) or in-flight (SENDING) row keeps
        // the address it was actually sent to, and the send LIFECYCLE is never reset.
        set: { recipient: data.recipient, locale: data.locale },
        setWhere: inArray(notificationLog.status, ['QUEUED', 'FAILED']),
      })
      .returning()
    if (upserted) return toNotificationLog(upserted)

    // `setWhere` skipped the update (the existing row is terminal or in-flight), so
    // RETURNING yielded nothing — read the untouched row back for the caller.
    const [existing] = await this.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.idempotencyKey, data.idempotencyKey))
    if (!existing) throw new Error('notification_log upsert lost the row after conflict')
    return toNotificationLog(existing)
  }

  async recordNoRecipient(data: NotificationLogNoRecipient): Promise<NotificationLog> {
    // #681: terminal NO_RECIPIENT row — empty address/locale (none resolved),
    // idempotent on its own key so exactly one record survives per skip.
    const [inserted] = await this.db
      .insert(notificationLog)
      .values({
        bookingId: data.bookingId,
        operatorId: data.operatorId,
        kind: data.kind,
        recipient: '',
        locale: '',
        status: 'NO_RECIPIENT',
        idempotencyKey: data.idempotencyKey,
      })
      .onConflictDoNothing({ target: notificationLog.idempotencyKey })
      .returning()
    if (inserted) return toNotificationLog(inserted)

    const [existing] = await this.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.idempotencyKey, data.idempotencyKey))
    if (!existing) throw new Error('notification_log recordNoRecipient lost the row after conflict')
    return toNotificationLog(existing)
  }

  async claim(id: string): Promise<NotificationLog | undefined> {
    // §3 atomic lease claim. The expired-lease branch reclaims a crashed SENDING;
    // a LIVE SENDING fails the predicate -> no row -> the caller skips (guard).
    const [claimed] = await this.db
      .update(notificationLog)
      .set({ status: 'SENDING', attempts: sql`${notificationLog.attempts} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          eq(notificationLog.id, id),
          or(
            inArray(notificationLog.status, ['QUEUED', 'FAILED']),
            and(
              eq(notificationLog.status, 'SENDING'),
              sql`${notificationLog.updatedAt} < now() - (${LEASE_SECONDS} * interval '1 second')`,
            ),
          ),
        ),
      )
      .returning()
    return claimed ? toNotificationLog(claimed) : undefined
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    await this.db
      .update(notificationLog)
      .set({ status: 'SENT', providerMessageId, error: null, updatedAt: sql`now()` })
      .where(eq(notificationLog.id, id))
  }

  async markFailed(id: string, error: string): Promise<void> {
    // #483: claim() already bumped attempts, so the column reflects the attempt
    // being recorded. Flip to terminal DEAD at the cap in ONE atomic UPDATE (a
    // read-then-write would race a concurrent claim). claim() never re-arms DEAD,
    // so a hard-bounce recipient stops being re-sent on every replay/resend.
    await this.db
      .update(notificationLog)
      .set({
        status: sql`(case when ${notificationLog.attempts} >= ${MAX_NOTIFICATION_ATTEMPTS} then 'DEAD' else 'FAILED' end)::notification_status`,
        error,
        updatedAt: sql`now()`,
      })
      .where(eq(notificationLog.id, id))
  }

  async findAll(ctx: CallerContext, filters?: NotificationLogFilters): Promise<NotificationLog[]> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    const conditions: SQL[] = []
    if (scope.kind === 'operator') conditions.push(eq(notificationLog.operatorId, scope.operatorId))
    else if (filters?.operatorId) conditions.push(eq(notificationLog.operatorId, filters.operatorId))
    if (filters?.bookingId) conditions.push(eq(notificationLog.bookingId, filters.bookingId))

    const rows = await this.db
      .select()
      .from(notificationLog)
      .where(conditions.length ? and(...conditions) : undefined)
    return rows.map(toNotificationLog)
  }

  async findById(ctx: CallerContext, id: string): Promise<NotificationLog | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(notificationLog.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(notificationLog.operatorId, scope.operatorId))
    const [row] = await this.db.select().from(notificationLog).where(and(...conditions))
    return row ? toNotificationLog(row) : undefined
  }
}
