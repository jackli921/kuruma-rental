import { type CallerContext, PRIVILEGED_ROLES } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Message, Thread, ThreadParticipant } from '../../stores'
import type { ThreadRepository } from '../types'

export class InMemoryThreadRepository implements ThreadRepository {
  private readonly threads = new Map<string, Thread>()
  private readonly participants = new Map<string, ThreadParticipant>()
  private readonly messages = new Map<string, Message>()

  async findAll(
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    let filteredThreads: Thread[]

    if (PRIVILEGED_ROLES.has(ctx.role)) {
      filteredThreads = [...this.threads.values()]
    } else {
      const userParticipations = [...this.participants.values()].filter(
        (p) => p.userId === ctx.userId,
      )
      const threadIds = new Set(userParticipations.map((p) => p.threadId))
      filteredThreads = [...this.threads.values()].filter((t) => threadIds.has(t.id))
    }

    return filteredThreads.map((thread) => {
      const threadParticipants = [...this.participants.values()].filter(
        (p) => p.threadId === thread.id,
      )
      const threadMessages = [...this.messages.values()]
        .filter((m) => m.threadId === thread.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      const lastMessage = threadMessages.at(-1) ?? null

      return { ...thread, participants: threadParticipants, lastMessage }
    })
  }

  async findById(
    ctx: CallerContext,
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    const thread = this.threads.get(id)
    if (!thread) return undefined

    const threadParticipants = [...this.participants.values()].filter((p) => p.threadId === id)

    // CallerContext scoping: non-privileged non-participants get undefined
    const isParticipant = threadParticipants.some((p) => p.userId === ctx.userId)
    if (!isParticipant && !PRIVILEGED_ROLES.has(ctx.role)) return undefined

    const threadMessages = [...this.messages.values()]
      .filter((m) => m.threadId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return { ...thread, participants: threadParticipants, messages: threadMessages }
  }

  async findByIdempotencyKey(key: string): Promise<Thread | undefined> {
    for (const thread of this.threads.values()) {
      if (thread.idempotencyKey === key) return thread
    }
    return undefined
  }

  async create(
    _ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
  ): Promise<Thread> {
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
    for (const [key, p] of this.participants) {
      if (p.threadId === threadId && p.userId === ctx.userId) {
        this.participants.set(key, { ...p, unreadCount: 0 })
      }
    }
  }

  // Exposed for InMemoryMessageRepository to add messages
  _addMessage(message: Message): void {
    this.messages.set(message.id, message)
    // Increment unread count for all participants except sender
    for (const [key, p] of this.participants) {
      if (p.threadId === message.threadId && p.userId !== message.senderId) {
        this.participants.set(key, { ...p, unreadCount: p.unreadCount + 1 })
      }
    }
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
