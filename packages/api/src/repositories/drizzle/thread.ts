import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Message, Thread, ThreadParticipant } from '../../stores'
import type { ThreadRepository } from '../types'
import {
  type Db,
  type RawMessageRow,
  messageColumns,
  normaliseMessage,
  participantColumns,
  threadColumns,
  toThread,
  toThreadParticipant,
} from './shared'

export class DrizzleThreadRepository implements ThreadRepository {
  constructor(private readonly db: Db) {}

  async findAll(
    userId: string,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    // Step 1: which threads does this user participate in?
    const myParticipations = await this.db
      .select({ threadId: threadParticipants.threadId })
      .from(threadParticipants)
      .where(eq(threadParticipants.userId, userId))

    const threadIds = [...new Set(myParticipations.map((p) => p.threadId))]
    if (threadIds.length === 0) return []

    // Step 2: fetch the threads themselves.
    const threadRows = (await this.db
      .select(threadColumns)
      .from(threads)
      .where(inArray(threads.id, threadIds))).map(toThread)

    // Step 3: fetch all participants for those threads in one round-trip.
    const participantRows = (await this.db
      .select(participantColumns)
      .from(threadParticipants)
      .where(inArray(threadParticipants.threadId, threadIds))).map(toThreadParticipant)

    // Step 4: fetch only the latest message per thread. The DISTINCT ON
    // pattern keeps this O(threads) instead of O(messages) -- important once
    // any single conversation grows beyond a few dozen messages.
    const lastMessageRows = await this.db.execute<RawMessageRow>(sql`
      SELECT DISTINCT ON ("threadId")
        "id", "threadId", "senderId", "content", "sourceLanguage", "translations", "createdAt"
      FROM "messages"
      WHERE "threadId" IN (${sql.join(
        threadIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY "threadId", "createdAt" DESC
    `)

    // postgres-js returns rows on the result directly; neon-http wraps in {rows}.
    // Coerce both shapes into a single array.
    const lastMessageList = (
      Array.isArray(lastMessageRows)
        ? lastMessageRows
        : ((lastMessageRows as { rows?: unknown[] }).rows ?? [])
    ) as Array<RawMessageRow>

    const lastMessageByThreadId = new Map<string, Message>()
    for (const row of lastMessageList) {
      lastMessageByThreadId.set(row.threadId, normaliseMessage(row))
    }

    return threadRows.map((thread) => ({
      ...thread,
      participants: participantRows.filter((p) => p.threadId === thread.id),
      lastMessage: lastMessageByThreadId.get(thread.id) ?? null,
    }))
  }

  async findById(
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    const [thread] = (await this.db
      .select(threadColumns)
      .from(threads)
      .where(eq(threads.id, id))).map(toThread)

    if (!thread) return undefined

    const [participantRows, messageRows] = await Promise.all([
      this.db
        .select(participantColumns)
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, id)),
      this.db
        .select(messageColumns)
        .from(messages)
        .where(eq(messages.threadId, id))
        .orderBy(asc(messages.createdAt)),
    ])

    return {
      ...thread,
      participants: participantRows.map(toThreadParticipant),
      messages: (messageRows as Array<Parameters<typeof normaliseMessage>[0]>).map(
        normaliseMessage,
      ),
    }
  }

  async create(bookingId: string | null, participantIds: string[]): Promise<Thread> {
    // Two-statement sequence: insert the thread row, then insert all
    // participants in one batch. Cleaner than a transaction for this case;
    // if the participant insert fails, the thread row is orphaned but
    // harmless and can be GC'd later. (postgres-js + neon-http both support
    // .transaction() but the behaviour differs slightly across drivers and
    // we don't need atomicity here for correctness.)
    const [insertedThread] = (await this.db
      .insert(threads)
      .values({ bookingId })
      .returning(threadColumns)).map(toThread)

    if (!insertedThread) {
      throw new Error('Failed to insert thread')
    }

    if (participantIds.length > 0) {
      await this.db.insert(threadParticipants).values(
        participantIds.map((userId) => ({
          threadId: insertedThread.id,
          userId,
          unreadCount: 0,
        })),
      )
    }

    return insertedThread
  }

  async markAsRead(threadId: string, userId: string): Promise<void> {
    // Single UPDATE -- no read-modify-write, no race window.
    await this.db
      .update(threadParticipants)
      .set({ unreadCount: 0 })
      .where(and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, userId)))
  }
}
