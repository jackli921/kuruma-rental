import type { RunTx } from '@kuruma/shared/db'
import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  type CallerContext,
  PRIVILEGED_ROLES,
  rejectOperatorContextUntilScoped,
} from '../../middleware/auth'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import { type Db, messageColumns, normaliseMessage } from './shared'

export class DrizzleMessageRepository implements MessageRepository {
  // Interactive-transaction runner injected (DIP); the root wires runTx
  // (per-call neon-serverless) since the neon-http db can't transact (#493).
  constructor(
    private readonly db: Db,
    private readonly runTransaction: RunTx,
  ) {}

  async findById(ctx: CallerContext, id: string): Promise<Message | undefined> {
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
    // Non-privileged callers only see messages in threads they participate in.
    // Use a join rather than two round-trips so the filter runs server-side.
    const query = this.db
      .select(messageColumns)
      .from(messages)
      .where(eq(messages.id, id))

    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      const [row] = (await this.db
        .select(messageColumns)
        .from(messages)
        .innerJoin(threadParticipants, eq(threadParticipants.threadId, messages.threadId))
        .where(
          and(eq(messages.id, id), eq(threadParticipants.userId, ctx.userId)),
        )) as Array<Parameters<typeof normaliseMessage>[0]>
      return row ? normaliseMessage(row) : undefined
    }

    const [row] = (await query) as Array<Parameters<typeof normaliseMessage>[0]>
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
      COALESCE(NULLIF(${messages.translations}, '')::jsonb, '{}'::jsonb),
      ARRAY[${language}],
      to_jsonb(${translatedText}::text)
    )::text`

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
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
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
  ): Promise<Message> {
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
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

      await tx.update(threads).set({ updatedAt: sql`now()` }).where(eq(threads.id, threadId))

      return normaliseMessage(inserted)
    })
  }

  async findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]> {
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
    // CallerContext scoping: verify non-privileged caller is a thread participant
    if (!PRIVILEGED_ROLES.has(ctx.role)) {
      const [participation] = await this.db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(
          and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, ctx.userId)),
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
