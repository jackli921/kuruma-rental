import type { RunTx } from '@kuruma/shared/db'
import { messages, threadParticipants, threads } from '@kuruma/shared/db/schema'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
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

    return this.hydrate(threadRows)
  }

  // #1476: page the caller's in-scope threads with limit/offset + the total count
  // pushed into SQL, so the service never materialises every in-scope thread (a
  // PLATFORM_ADMIN `all` scope would otherwise scan platform-wide per GET /threads).
  // Ordered newest createdAt first with id as the tiebreaker for a stable page
  // boundary; the in-memory repo mirrors the same order.
  async findPage(
    ctx: CallerContext,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{
    threads: Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>
    total: number
  }> {
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return { threads: [], total: 0 }

    const order = [desc(threads.createdAt), desc(threads.id)] as const
    let total: number
    let threadRows: Thread[]

    if (scope.kind === 'all') {
      total = (await this.db.select({ value: count() }).from(threads))[0]?.value ?? 0
      threadRows = (await this.db
        .select(threadColumns)
        .from(threads)
        .orderBy(...order)
        .limit(limit)
        .offset(offset)).map(toThread)
    } else if (scope.kind === 'operator') {
      const where = eq(threads.operatorId, scope.operatorId)
      total = (await this.db.select({ value: count() }).from(threads).where(where))[0]?.value ?? 0
      threadRows = (await this.db
        .select(threadColumns)
        .from(threads)
        .where(where)
        .orderBy(...order)
        .limit(limit)
        .offset(offset)).map(toThread)
    } else {
      // participant: join through thread_participants (one row per thread, given the
      // (threadId,userId) unique) so limit/offset + the count stay in SQL.
      const where = eq(threadParticipants.userId, scope.userId)
      total =
        (await this.db
          .select({ value: count() })
          .from(threads)
          .innerJoin(threadParticipants, eq(threadParticipants.threadId, threads.id))
          .where(where))[0]?.value ?? 0
      threadRows = (
        (await this.db
          .select(threadColumns)
          .from(threads)
          .innerJoin(threadParticipants, eq(threadParticipants.threadId, threads.id))
          .where(where)
          .orderBy(...order)
          .limit(limit)
          .offset(offset)) as Array<Parameters<typeof toThread>[0]>
      ).map(toThread)
    }

    return { threads: await this.hydrate(threadRows), total }
  }

  // Attach each thread's participants and most-recent message in two batched
  // round-trips. Shared by findAll and findPage so both shape rows identically.
  private async hydrate(
    threadRows: Thread[],
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    const threadIds = threadRows.map((t) => t.id)
    if (threadIds.length === 0) return []

    // Fetch all participants for those threads in one round-trip.
    const participantRows = (await this.db
      .select(participantColumns)
      .from(threadParticipants)
      .where(inArray(threadParticipants.threadId, threadIds))).map(toThreadParticipant)

    // Fetch only the latest message per thread.
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
    const scope = threadReadScope(ctx)
    if (scope.kind === 'participant') {
      // Renter side: only mark the caller's own participation as read.
      await this.db
        .update(threadParticipants)
        .set({ unreadCount: 0 })
        .where(
          and(eq(threadParticipants.threadId, threadId), eq(threadParticipants.userId, ctx.userId)),
        )
      return
    }
    // Operator/admin side: zero the thread's tenant-level unread (#1205 slice 3).
    // An operator may only clear its own tenant's thread; admin (`all`) any.
    const conditions = [eq(threads.id, threadId)]
    if (scope.kind === 'operator') conditions.push(eq(threads.operatorId, scope.operatorId))
    await this.db.update(threads).set({ operatorUnreadCount: 0 }).where(and(...conditions))
  }
}
