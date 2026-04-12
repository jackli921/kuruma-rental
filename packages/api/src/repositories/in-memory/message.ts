import type { Message } from '../../stores'
import type { MessageRepository } from '../types'
import type { InMemoryThreadRepository } from './thread'

export class InMemoryMessageRepository implements MessageRepository {
  constructor(private readonly threadRepo: InMemoryThreadRepository) {}

  async create(threadId: string, senderId: string, content: string): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      threadId,
      senderId,
      content,
      sourceLanguage: null,
      translations: '{}',
      createdAt: new Date(),
    }
    this.threadRepo._addMessage(message)
    return message
  }

  async findByThreadId(threadId: string): Promise<Message[]> {
    const thread = await this.threadRepo.findById(threadId)
    return thread?.messages ?? []
  }
}
