import type { Message, Thread, ThreadParticipant } from '../../stores'
import type { ThreadRepository } from '../types'

export class InMemoryThreadRepository implements ThreadRepository {
  private readonly threads = new Map<string, Thread>()
  private readonly participants = new Map<string, ThreadParticipant>()
  private readonly messages = new Map<string, Message>()

  async findAll(
    userId: string,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>> {
    const userParticipations = [...this.participants.values()].filter((p) => p.userId === userId)
    const threadIds = new Set(userParticipations.map((p) => p.threadId))

    return [...this.threads.values()]
      .filter((t) => threadIds.has(t.id))
      .map((thread) => {
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
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined> {
    const thread = this.threads.get(id)
    if (!thread) return undefined

    const threadParticipants = [...this.participants.values()].filter((p) => p.threadId === id)
    const threadMessages = [...this.messages.values()]
      .filter((m) => m.threadId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return { ...thread, participants: threadParticipants, messages: threadMessages }
  }

  async create(bookingId: string | null, participantIds: string[]): Promise<Thread> {
    const now = new Date()
    const thread: Thread = {
      id: crypto.randomUUID(),
      bookingId,
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

  async markAsRead(threadId: string, userId: string): Promise<void> {
    for (const [key, p] of this.participants) {
      if (p.threadId === threadId && p.userId === userId) {
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
}
