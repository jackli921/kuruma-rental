import {
  type CallerContext,
  PRIVILEGED_ROLES,
  rejectOperatorContextUntilScoped,
} from '../../middleware/auth'
import { PG_ERROR } from '../../pg-errors'
import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import type { InMemoryThreadRepository } from './thread'

function parseJson(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  private readonly idempotencyIndex = new Map<string, Message>()

  constructor(private readonly threadRepo: InMemoryThreadRepository) {}

  async findById(ctx: CallerContext, id: string): Promise<Message | undefined> {
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
    const msg = this.threadRepo._getMessage(id)
    if (!msg) return undefined
    if (PRIVILEGED_ROLES.has(ctx.role)) return msg
    // Non-privileged: verify the caller is a participant of the message's thread.
    const thread = await this.threadRepo.findById(ctx, msg.threadId)
    return thread ? msg : undefined
  }

  async findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Message | undefined> {
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
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

    const translations = parseJson(existing.translations)
    translations[language] = translatedText

    const patch: Partial<Message> = { translations: JSON.stringify(translations) }
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
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
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

  async findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]> {
    rejectOperatorContextUntilScoped(ctx, 'MessageRepository')
    const thread = await this.threadRepo.findById(ctx, threadId)
    return thread?.messages ?? []
  }
}
