import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  type CallerContext,
  PRIVILEGED_ROLES,
  rejectOperatorContextUntilScoped,
} from '../../middleware/auth'
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
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    rejectOperatorContextUntilScoped(ctx, 'ThreadRepository')
    let threadRows: Thread[]

    if (PRIVILEGED_ROLES.has(ctx.role)) {
      // Staff/admin see all threads
      threadRows = (await this.db.select(threadColumns).from(threads)).map(toThread)
    } else {
      // Non-privileged: only threads where the user is a participant
      const myParticipations = await this.db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(eq(threadParticipants.userId, ctx.userId))

      const threadIds = [...new Set(myParticipations.map((p) => p.threadId))]
      if (threadIds.length === 0) return []

      threadRows = (await this.db
        .select(threadColumns)
        .from(threads)
        .where(inArray(threads.id, threadIds))).map(toThread)
    }

    const threadIds = threadRows.map((t) => t.id)
    if (threadIds.length === 0) return []

    // Step 3: fetch all participants for those threads in one round-trip.
    const participantRows = (await this.db
      .select(participantColumns)
      .from(threadParticipants)
      .where(inArray(threadParticipants.threadId, threadIds))).map(toThreadParticipant)

    // Step 4: fetch only the latest message per thread.
    const lastMessageRows = await this.db.execute<RawMessageRow>(sql`
      SELECT DISTINCT ON ("threadId")
        "id", "threadId", "senderId", "content", "sourceLanguage", "translations", "idempotencyKey", "createdAt"
      FROM "messages"
      WHERE "threadId" IN (${sql.join(
        threadIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY "threadId", "createdAt" DESC
    `)

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
    ctx: CallerContext,
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    rejectOperatorContextUntilScoped(ctx, 'ThreadRepository')
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

    const participants = participantRows.map(toThreadParticipant)

    // CallerContext scoping: non-privileged non-participants get undefined
    const isParticipant = participants.some((p) => p.userId === ctx.userId)
    if (!isParticipant && !PRIVILEGED_ROLES.has(ctx.role)) return undefined

    return {
      ...thread,
      participants,
      messages: (messageRows as Array<Parameters<typeof normaliseMessage>[0]>).map(
        normaliseMessage,
      ),
    }
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Thread | undefined> {
    rejectOperatorContextUntilScoped(ctx, 'ThreadRepository')
    // CallerContext scoping (issue #328): non-privileged callers only match
    // threads where they are a participant. Join the single thread row
    // against thread_participants so filtering happens server-side.
    if (PRIVILEGED_ROLES.has(ctx.role)) {
      const [row] = (await this.db
        .select(threadColumns)
        .from(threads)
        .where(eq(threads.idempotencyKey, key))).map(toThread)
      return row
    }

    const [row] = (await this.db
      .select(threadColumns)
      .from(threads)
      .innerJoin(threadParticipants, eq(threadParticipants.threadId, threads.id))
      .where(
        and(eq(threads.idempotencyKey, key), eq(threadParticipants.userId, ctx.userId)),
      )) as Array<Parameters<typeof toThread>[0]>
    return row ? toThread(row) : undefined
  }

  async create(
    ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
  ): Promise<Thread> {
    rejectOperatorContextUntilScoped(ctx, 'ThreadRepository')
    return this.db.transaction(async (tx) => {
      const [insertedThread] = (await tx
        .insert(threads)
        .values({ bookingId, idempotencyKey: idempotencyKey ?? null })
        .returning(threadColumns)).map(toThread)

      if (!insertedThread) {
        throw new Error('Failed to insert thread')
      }

      if (participantIds.length > 0) {
        await tx.insert(threadParticipants).values(
          participantIds.map((userId) => ({
            threadId: insertedThread.id,
            userId,
            unreadCount: 0,
          })),
        )
      }

      return insertedThread
    })
  }

  async markAsRead(ctx: CallerContext, threadId: string): Promise<void> {
    rejectOperatorContextUntilScoped(ctx, 'ThreadRepository')
    // CallerContext: only mark the caller's own participation as read
    await this.db
      .update(threadParticipants)
      .set({ unreadCount: 0 })
      .where(and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, ctx.userId)))
  }
}
