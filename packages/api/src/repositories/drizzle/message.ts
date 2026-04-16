import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { type CallerContext, PRIVILEGED_ROLES } from '../../middleware/auth'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import { type Db, messageColumns, normaliseMessage } from './shared'

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async create(ctx: CallerContext, threadId: string, content: string): Promise<Message> {
    return this.db.transaction(async (tx) => {
      const [inserted] = (await tx
        .insert(messages)
        .values({ threadId, senderId: ctx.userId, content })
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
