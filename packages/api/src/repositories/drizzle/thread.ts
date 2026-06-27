import type { RunTx } from '@kuruma/shared/db'
import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { type CallerContext, requireOperatorScope } from '../../middleware/auth'
import type { Message, Thread, ThreadParticipant } from '../../stores'
import { threadReadScope } from '../../tenancy'
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
  // The interactive-transaction runner is injected (DIP) — the composition root
  // wires the concrete (runTx, per-call neon-serverless); tests/e2e inject a
  // postgres-js runner. The neon-http db this repo holds for reads can't run
  // interactive transactions on CF Workers (#493).
  constructor(
    private readonly db: Db,
    private readonly runTransaction: RunTx,
  ) {}

  async findAll(
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return []
    let threadRows: Thread[]

    if (scope.kind === 'all') {
      // PLATFORM_ADMIN sees every tenant's threads
      threadRows = (await this.db.select(threadColumns).from(threads)).map(toThread)
    } else if (scope.kind === 'operator') {
      // OPERATOR_*: only threads owned by this tenant (#1205)
      threadRows = (await this.db
        .select(threadColumns)
        .from(threads)
        .where(eq(threads.operatorId, scope.operatorId))).map(toThread)
    } else {
      // participant: only threads where the user is a participant
      const myParticipations = await this.db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(eq(threadParticipants.userId, scope.userId))

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
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return undefined

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

    // Read-scope visibility (#1205): admin sees all, an operator only its own
    // tenant, a renter only threads it participates in.
    const visible =
      scope.kind === 'all' ||
      (scope.kind === 'operator' && thread.operatorId === scope.operatorId) ||
      (scope.kind === 'participant' && participants.some((p) => p.userId === scope.userId))
    if (!visible) return undefined

    return {
      ...thread,
      participants,
      messages: (messageRows as Array<Parameters<typeof normaliseMessage>[0]>).map(
        normaliseMessage,
      ),
    }
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Thread | undefined> {
    // Read-scope the lookup (issue #328 + #1205) so a replayed key can't leak
    // another tenant's thread: admin matches any, an operator only within its
    // tenant, a renter only threads it participates in. Filtering runs
    // server-side.
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return undefined

    if (scope.kind === 'all') {
      const [row] = (await this.db
        .select(threadColumns)
        .from(threads)
        .where(eq(threads.idempotencyKey, key))).map(toThread)
      return row
    }

    if (scope.kind === 'operator') {
      const [row] = (await this.db
        .select(threadColumns)
        .from(threads)
        .where(
          and(eq(threads.idempotencyKey, key), eq(threads.operatorId, scope.operatorId)),
        )).map(toThread)
      return row
    }

    const [row] = (await this.db
      .select(threadColumns)
      .from(threads)
      .innerJoin(threadParticipants, eq(threadParticipants.threadId, threads.id))
      .where(
        and(eq(threads.idempotencyKey, key), eq(threadParticipants.userId, scope.userId)),
      )) as Array<Parameters<typeof toThread>[0]>
    return row ? toThread(row) : undefined
  }

  async create(
    ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
    operatorId?: string | null,
  ): Promise<Thread> {
    requireOperatorScope(ctx)
    return this.runTransaction(async (tx) => {
      const [insertedThread] = (await tx
        .insert(threads)
        .values({ bookingId, operatorId: operatorId ?? null, idempotencyKey: idempotencyKey ?? null })
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
    requireOperatorScope(ctx)
    // CallerContext: only mark the caller's own participation as read
    await this.db
      .update(threadParticipants)
      .set({ unreadCount: 0 })
      .where(and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, ctx.userId)))
  }
}
