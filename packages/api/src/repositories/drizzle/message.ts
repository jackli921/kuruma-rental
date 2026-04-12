import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import { type Db, messageColumns, normaliseMessage } from './shared'

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async create(threadId: string, senderId: string, content: string): Promise<Message> {
    return this.db.transaction(async (tx) => {
      const [inserted] = (await tx
        .insert(messages)
        .values({ threadId, senderId, content })
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
            sql`${threadParticipants.userId} <> ${senderId}`,
          ),
        )

      await tx.update(threads).set({ updatedAt: sql`now()` }).where(eq(threads.id, threadId))

      return normaliseMessage(inserted)
    })
  }

  async findByThreadId(threadId: string): Promise<Message[]> {
    const rows = (await this.db
      .select(messageColumns)
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))) as Array<Parameters<typeof normaliseMessage>[0]>

    return rows.map(normaliseMessage)
  }
}
