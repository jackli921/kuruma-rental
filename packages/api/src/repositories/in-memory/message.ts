import { type CallerContext, PRIVILEGED_ROLES, requireOperatorScope } from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Message } from '../../stores'
import { threadReadScope } from '../../tenancy'
import type { MessageRepository } from '../types'
import type { InMemoryThreadRepository } from './thread'

export class InMemoryMessageRepository implements MessageRepository {
  private readonly idempotencyIndex = new Map<string, Message>()

  constructor(private readonly threadRepo: InMemoryThreadRepository) {}

  async findById(ctx: CallerContext, id: string): Promise<Message | undefined> {
    const msg = this.threadRepo._getMessage(id)
    if (!msg) return undefined
    // A message is visible iff its thread is — delegate scoping (admin/operator/
    // participant) to the thread repo (#1205) rather than re-deriving it here.
    const thread = await this.threadRepo.findById(ctx, msg.threadId)
    return thread ? msg : undefined
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Message | undefined> {
    // CallerContext scoping (issue #328): the key is sender-owned, so
    // non-privileged callers only match messages they themselves sent.
    const msg = this.idempotencyIndex.get(key)
    if (!msg) return undefined
    if (PRIVILEGED_ROLES.has(ctx.role)) return msg
    return msg.senderId === ctx.userId ? msg : undefined
  }

  async updateTranslation(
    messageId: string,
    language: string,
    translatedText: string,
    detectedSourceLanguage: string | null,
  ): Promise<Message | undefined> {
    const existing = this.threadRepo._getMessage(messageId)
    if (!existing) return undefined

    const translations = { ...existing.translations, [language]: translatedText }

    const patch: Partial<Message> = { translations }
    if (detectedSourceLanguage && !existing.sourceLanguage) {
      patch.sourceLanguage = detectedSourceLanguage
    }
    return this.threadRepo._updateMessage(messageId, patch)
  }

  async create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<Message> {
    requireOperatorScope(ctx)
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
      translations: {},
      idempotencyKey: idempotencyKey ?? null,
      createdAt: new Date(),
    }
    // A renter send (participant scope) bumps the operator's tenant-level unread;
    // an operator/admin reply does not. The renter's own per-participant unread is
    // bumped for all non-sender participants inside _addMessage.
    const isRenterSend = threadReadScope(ctx).kind === 'participant'
    this.threadRepo._addMessage(message, isRenterSend)

    if (idempotencyKey) {
      this.idempotencyIndex.set(idempotencyKey, message)
    }

    return message
  }

  async findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]> {
    const thread = await this.threadRepo.findById(ctx, threadId)
    return thread?.messages ?? []
  }
}
