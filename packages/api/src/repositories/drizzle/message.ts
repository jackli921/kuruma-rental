import type { RunTx } from '@kuruma/shared/db'
import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  type CallerContext,
  PRIVILEGED_ROLES,
  requireOperatorScope,
} from '../../middleware/auth'
import type { Message } from '../../stores'
import { threadReadScope } from '../../tenancy'
import type { MessageCreateResult, MessageRepository } from '../types'
import { type Db, messageColumns, normaliseMessage } from './shared'

export class DrizzleMessageRepository implements MessageRepository {
  // Interactive-transaction runner injected (DIP); the root wires runTx
  // (per-call neon-serverless) since the neon-http db can't transact (#493).
  constructor(
    private readonly db: Db,
    private readonly runTransaction: RunTx,
  ) {}

  async findById(ctx: CallerContext, id: string): Promise<Message | undefined> {
    // A message is visible iff its thread is — scope by the thread's tenant
    // (#1205). Joins keep the filter server-side.
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return undefined

    if (scope.kind === 'all') {
      const [row] = (await this.db
        .select(messageColumns)
        .from(messages)
        .where(eq(messages.id, id))) as Array<Parameters<typeof normaliseMessage>[0]>
      return row ? normaliseMessage(row) : undefined
    }

    if (scope.kind === 'operator') {
      const [row] = (await this.db
        .select(messageColumns)
        .from(messages)
        .innerJoin(threads, eq(threads.id, messages.threadId))
        .where(
          and(eq(messages.id, id), eq(threads.operatorId, scope.operatorId)),
        )) as Array<Parameters<typeof normaliseMessage>[0]>
      return row ? normaliseMessage(row) : undefined
    }

    const [row] = (await this.db
      .select(messageColumns)
      .from(messages)
      .innerJoin(threadParticipants, eq(threadParticipants.threadId, messages.threadId))
      .where(
        and(eq(messages.id, id), eq(threadParticipants.userId, scope.userId)),
      )) as Array<Parameters<typeof normaliseMessage>[0]>
    return row ? normaliseMessage(row) : undefined
  }

  async updateTranslation(
    messageId: string,
    language: string,
    translatedText: string,
    detectedSourceLanguage: string | null,
  ): Promise<Message | undefined> {
    // Single-statement atomic merge — avoids the SELECT-then-UPDATE race
    // where two concurrent translates would clobber each other at READ
    // COMMITTED isolation. jsonb_set merges the new language in place.
    const nextJson = sql`jsonb_set(
      ${messages.translations},
      ARRAY[${language}],
      to_jsonb(${translatedText}::text)
    )`

    const setClause = detectedSourceLanguage
      ? {
          translations: nextJson,
          sourceLanguage: sql`COALESCE(${messages.sourceLanguage}, ${detectedSourceLanguage})`,
        }
      : { translations: nextJson }

    const [updated] = (await this.db
      .update(messages)
      .set(setClause)
      .where(eq(messages.id, messageId))
      .returning(messageColumns)) as Array<Parameters<typeof normaliseMessage>[0]>

    return updated ? normaliseMessage(updated) : undefined
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Message | undefined> {
    // CallerContext scoping (issue #328): the key is sender-owned, so
    // non-privileged callers only match messages they themselves sent.
    // Privileged roles bypass the sender filter.
    const conditions = [eq(messages.idempotencyKey, key)]
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      conditions.push(eq(messages.senderId, ctx.userId))
    }

    const rows = (await this.db
      .select(messageColumns)
      .from(messages)
      .where(and(...conditions))) as Array<Parameters<typeof normaliseMessage>[0]>
    const [row] = rows
    return row ? normaliseMessage(row) : undefined
  }

  async create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<MessageCreateResult> {
    requireOperatorScope(ctx)
    return this.runTransaction(async (tx) => {
      const [inserted] = (await tx
        .insert(messages)
        .values({ threadId, senderId: ctx.userId, content, idempotencyKey: idempotencyKey ?? null })
        .returning(messageColumns)) as Array<Parameters<typeof normaliseMessage>[0]>

      if (!inserted) {
        throw new Error('Failed to insert message')
      }

      // Atomic bump -- SQL arithmetic prevents lost increments under concurrency
      await tx
        .update(threadParticipants)
        .set({ unreadCount: sql`${threadParticipants.unreadCount} + 1` })
        .where(
          and(
            eq(threadParticipants.threadId, threadId),
            sql`${threadParticipants.userId} <> ${ctx.userId}`,
          ),
        )

      // A renter send (participant scope) also bumps the operator's tenant-level
      // unread (#1205 slice 3); an operator/admin reply only touches updatedAt.
      // RETURNING the post-bump row makes the 0->1 transition (unreadCount === 1)
      // race-free — no separate read another concurrent send could settle (#1205 s4).
      const isRenterSend = threadReadScope(ctx).kind === 'participant'
      const [updatedThread] = await tx
        .update(threads)
        .set(
          isRenterSend
            ? {
                updatedAt: sql`now()`,
                operatorUnreadCount: sql`${threads.operatorUnreadCount} + 1`,
              }
            : { updatedAt: sql`now()` },
        )
        .where(eq(threads.id, threadId))
        .returning({
          operatorId: threads.operatorId,
          bookingId: threads.bookingId,
          operatorUnreadCount: threads.operatorUnreadCount,
        })

      // Non-null only when the bump landed on a booking+operator thread (the email
      // needs both notNull keys); otherwise the counter still moved but nothing fires.
      const operatorUnread =
        isRenterSend && updatedThread?.operatorId && updatedThread.bookingId
          ? {
              operatorId: updatedThread.operatorId,
              bookingId: updatedThread.bookingId,
              unreadCount: updatedThread.operatorUnreadCount,
            }
          : null

      return { message: normaliseMessage(inserted), operatorUnread }
    })
  }

  async findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]> {
    // Gate the listing by the thread's read scope (#1205): an operator must own
    // the thread's tenant; a renter must participate; admin sees all.
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return []
    if (scope.kind === 'operator') {
      const [owned] = await this.db
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.id, threadId), eq(threads.operatorId, scope.operatorId)))
      if (!owned) return []
    } else if (scope.kind === 'participant') {
      const [participation] = await this.db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(
          and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, scope.userId)),
        )
      if (!participation) return []
    }

    const rows = (await this.db
      .select(messageColumns)
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))) as Array<Parameters<typeof normaliseMessage>[0]>

    return rows.map(normaliseMessage)
  }
}
