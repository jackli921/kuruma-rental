import { type CallerContext, requireOperatorScope } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Message, Thread, ThreadParticipant } from '../../stores'
import { threadReadScope } from '../../tenancy'
import type { OperatorUnreadTransition, ThreadRepository } from '../types'

export class InMemoryThreadRepository implements ThreadRepository {
  private readonly threads = new Map<string, Thread>()
  private readonly participants = new Map<string, ThreadParticipant>()
  private readonly messages = new Map<string, Message>()

  async findAll(
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    return this.scopedThreads(ctx).map((thread) => this.hydrate(thread))
  }

  // #1476: page limit/offset over the in-scope set instead of the service loading
  // everything and slicing. Mirrors the Drizzle SQL LIMIT/OFFSET + COUNT and the
  // same ordering key (newest createdAt first, id as the tiebreaker) so each repo
  // paginates stably. The tiebreaker only decides exact createdAt ties; it uses a
  // code-unit id comparison (not locale-aware localeCompare) so the boundary is
  // collation-independent within this repo. Cross-repo byte-identical order isn't
  // relied on: production runs one repo, and the parity tests seed distinct times.
  async findPage(
    ctx: CallerContext,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{
    threads: Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>
    total: number
  }> {
    const scoped = this.scopedThreads(ctx)
    const ordered = [...scoped].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    const page = ordered.slice(offset, offset + limit).map((thread) => this.hydrate(thread))
    return { threads: page, total: scoped.length }
  }

  // The threads visible to the caller under its read scope (#1205): admin sees
  // all, an operator only its own tenant, a renter only threads it participates
  // in, a tokenless operator nothing. Shared by findAll and findPage.
  private scopedThreads(ctx: CallerContext): Thread[] {
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return []
    if (scope.kind === 'all') return [...this.threads.values()]
    if (scope.kind === 'operator') {
      return [...this.threads.values()].filter((t) => t.operatorId === scope.operatorId)
    }
    const threadIds = new Set(
      [...this.participants.values()]
        .filter((p) => p.userId === scope.userId)
        .map((p) => p.threadId),
    )
    return [...this.threads.values()].filter((t) => threadIds.has(t.id))
  }

  private hydrate(
    thread: Thread,
  ): Thread & { participants: ThreadParticipant[]; lastMessage: Message | null } {
    const participants = [...this.participants.values()].filter((p) => p.threadId === thread.id)
    const lastMessage =
      [...this.messages.values()]
        .filter((m) => m.threadId === thread.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .at(-1) ?? null
    return { ...thread, participants, lastMessage }
  }

  async findById(
    ctx: CallerContext,
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    const thread = this.threads.get(id)
    if (!thread) return undefined

    const threadParticipants = [...this.participants.values()].filter((p) => p.threadId === id)

    if (!this.isVisible(ctx, thread, threadParticipants)) return undefined

    const threadMessages = [...this.messages.values()]
      .filter((m) => m.threadId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return { ...thread, participants: threadParticipants, messages: threadMessages }
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Thread | undefined> {
    // CallerContext scoping (issue #328 + #1205): callers only match threads
    // visible under their read scope — admin sees all, an operator only its own
    // tenant, a renter only threads they participate in.
    for (const thread of this.threads.values()) {
      if (thread.idempotencyKey !== key) continue
      const participants = [...this.participants.values()].filter((p) => p.threadId === thread.id)
      if (this.isVisible(ctx, thread, participants)) return thread
    }
    return undefined
  }

  async create(
    ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
    operatorId?: string | null,
  ): Promise<Thread> {
    requireOperatorScope(ctx)
    if (idempotencyKey) {
      for (const existing of this.threads.values()) {
        if (existing.idempotencyKey === idempotencyKey) {
          const err = new Error('unique_idempotency_key violation') as Error & { code: string }
          err.code = PG_ERROR.UNIQUE_VIOLATION
          throw err
        }
      }
    }

    const now = new Date()
    const thread: Thread = {
      id: crypto.randomUUID(),
      bookingId,
      operatorId: operatorId ?? null,
      operatorUnreadCount: 0,
      idempotencyKey: idempotencyKey ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.threads.set(thread.id, thread)

    for (const userId of participantIds) {
      const participant: ThreadParticipant = {
        id: crypto.randomUUID(),
        threadId: thread.id,
        userId,
        unreadCount: 0,
      }
      this.participants.set(participant.id, participant)
    }

    return thread
  }

  async markAsRead(ctx: CallerContext, threadId: string): Promise<void> {
    requireOperatorScope(ctx)
    const scope = threadReadScope(ctx)
    if (scope.kind === 'participant') {
      // Renter side: zero only the caller's own participation.
      for (const [key, p] of this.participants) {
        if (p.threadId === threadId && p.userId === ctx.userId) {
          this.participants.set(key, { ...p, unreadCount: 0 })
        }
      }
      return
    }
    // Operator/admin side: zero the thread's tenant-level unread. An operator may
    // only clear its own tenant's thread; admin (`all`) clears any.
    const thread = this.threads.get(threadId)
    if (!thread) return
    if (scope.kind === 'operator' && thread.operatorId !== scope.operatorId) return
    this.threads.set(thread.id, { ...thread, operatorUnreadCount: 0 })
  }

  // Is a single thread visible to the caller under its read scope? Exhaustive on
  // the union (#1205) so a new scope kind can't silently leak another tenant's
  // thread: admin sees all, an operator only its tenant, a renter only threads
  // it participates in, a tokenless operator nothing.
  private isVisible(
    ctx: CallerContext,
    thread: Thread,
    participants: ThreadParticipant[],
  ): boolean {
    const scope = threadReadScope(ctx)
    if (scope.kind === 'none') return false
    if (scope.kind === 'all') return true
    if (scope.kind === 'operator') return thread.operatorId === scope.operatorId
    if (scope.kind === 'participant') return participants.some((p) => p.userId === scope.userId)
    scope satisfies never
    return false
  }

  // Exposed for InMemoryMessageRepository to add messages. Returns the post-bump
  // operator-unread state when a renter send raised a booking+operator thread's
  // tenant counter (#1205 slice 4) — the 0->1 email trigger signal — else null.
  _addMessage(message: Message, isRenterSend = false): OperatorUnreadTransition | null {
    this.messages.set(message.id, message)
    // Increment unread count for all participants except sender
    for (const [key, p] of this.participants) {
      if (p.threadId === message.threadId && p.userId !== message.senderId) {
        this.participants.set(key, { ...p, unreadCount: p.unreadCount + 1 })
      }
    }
    // Only a renter send bumps the operator's tenant-level unread (#1205 slice 3).
    if (!isRenterSend) return null
    const thread = this.threads.get(message.threadId)
    if (!thread) return null
    const unreadCount = thread.operatorUnreadCount + 1
    this.threads.set(thread.id, { ...thread, operatorUnreadCount: unreadCount })
    // The email needs both notNull keys; a bookingless thread bumps but never fires.
    if (!thread.operatorId || !thread.bookingId) return null
    return { operatorId: thread.operatorId, bookingId: thread.bookingId, unreadCount }
  }

  _getMessage(id: string): Message | undefined {
    return this.messages.get(id)
  }

  _updateMessage(id: string, patch: Partial<Message>): Message | undefined {
    const existing = this.messages.get(id)
    if (!existing) return undefined
    const updated = { ...existing, ...patch }
    this.messages.set(id, updated)
    return updated
  }
}
