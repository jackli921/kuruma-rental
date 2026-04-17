import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { type CallerContext, PRIVILEGED_ROLES } from '../../middleware/auth'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import { type Db, messageColumns, normaliseMessage } from './shared'

function parseTranslations(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Message | undefined> {
    const rows = (await this.db
      .select(messageColumns)
      .from(messages)
      .where(eq(messages.id, id))) as Array<Parameters<typeof normaliseMessage>[0]>
    const [row] = rows
    return row ? normaliseMessage(row) : undefined
  }

  async updateTranslation(
    messageId: string,
    language: string,
    translatedText: string,
    detectedSourceLanguage: string | null,
  ): Promise<Message | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = (await tx
        .select(messageColumns)
        .from(messages)
        .where(eq(messages.id, messageId))) as Array<Parameters<typeof normaliseMessage>[0]>
      if (!existing) return undefined

      const current = parseTranslations(existing.translations)
      current[language] = translatedText
      const nextJson = JSON.stringify(current)

      const updateValues: { translations: string; sourceLanguage?: string } = {
        translations: nextJson,
      }
      if (detectedSourceLanguage && !existing.sourceLanguage) {
        updateValues.sourceLanguage = detectedSourceLanguage
      }

      const [updated] = (await tx
        .update(messages)
        .set(updateValues)
        .where(eq(messages.id, messageId))
        .returning(messageColumns)) as Array<Parameters<typeof normaliseMessage>[0]>

      return updated ? normaliseMessage(updated) : undefined
    })
  }

  async findByIdempotencyKey(key: string): Promise<Message | undefined> {
    const rows = (await this.db
      .select(messageColumns)
      .from(messages)
      .where(eq(messages.idempotencyKey, key))) as Array<Parameters<typeof normaliseMessage>[0]>
    const [row] = rows
    return row ? normaliseMessage(row) : undefined
  }

  async create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<Message> {
    return this.db.transaction(async (tx) => {
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
