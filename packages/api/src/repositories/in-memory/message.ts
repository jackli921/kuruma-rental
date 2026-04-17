import type { CallerContext } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import type { InMemoryThreadRepository } from './thread'

export class InMemoryMessageRepository implements MessageRepository {
  private readonly idempotencyIndex = new Map<string, Message>()

  constructor(private readonly threadRepo: InMemoryThreadRepository) {}

  async findByIdempotencyKey(key: string): Promise<Message | undefined> {
    return this.idempotencyIndex.get(key)
  }

  async create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<Message> {
    if (idempotencyKey && this.idempotencyIndex.has(idempotencyKey)) {
      const err = new Error('unique_idempotency_key violation') as Error & { code: string }
      err.code = PG_ERROR.UNIQUE_VIOLATION
      throw err
    }

    const message: Message = {
      id: crypto.randomUUID(),
      threadId,
      senderId: ctx.userId,
      content,
      sourceLanguage: null,
      translations: '{}',
      idempotencyKey: idempotencyKey ?? null,
      createdAt: new Date(),
    }
    this.threadRepo._addMessage(message)

    if (idempotencyKey) {
      this.idempotencyIndex.set(idempotencyKey, message)
    }

    return message
  }

  async findByThreadId(_ctx: CallerContext, threadId: string): Promise<Message[]> {
    const thread = await this.threadRepo.findById(_ctx, threadId)
    return thread?.messages ?? []
  }
}
