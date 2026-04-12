import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import { type Db, messageColumns, normaliseMessage } from './shared'

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async create(threadId: string, senderId: string, content: string): Promise<Message> {
    // Insert the message AND atomically bump every other participant's
    // unread count in a single round-trip pair. The unread bump uses a
    // SQL arithmetic expression (`unreadCount + 1`) so concurrent inserts
    // can never lose an increment -- this is the Check-Then-Act race fix
    // called out in the issue.
    const [inserted] = (await this.db
      .insert(messages)
      .values({ threadId, senderId, content })
      .returning(messageColumns)) as Array<Parameters<typeof normaliseMessage>[0]>

    if (!inserted) {
      throw new Error('Failed to insert message')
    }

    await this.db
      .update(threadParticipants)
      .set({ unreadCount: sql`${threadParticipants.unreadCount} + 1` })
      .where(
        and(
          eq(threadParticipants.threadId, threadId),
          sql`${threadParticipants.userId} <> ${senderId}`,
        ),
      )

    // Touch the parent thread's updatedAt so findAll can sort by recency
    // later if/when needed. Cheap and keeps invariants honest.
    await this.db.update(threads).set({ updatedAt: sql`now()` }).where(eq(threads.id, threadId))

    return normaliseMessage(inserted)
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
