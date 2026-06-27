import type { CreateThreadInput } from '@kuruma/shared/validators/message'
import type { CallerContext } from '../middleware/auth'
import { PRIVILEGED_ROLES } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import type { Message, Thread } from '../stores'

type ThreadListItem = Awaited<ReturnType<ThreadRepository['findAll']>>[number]
type ThreadDetail = NonNullable<Awaited<ReturnType<ThreadRepository['findById']>>>

/** A thread create either fails the participant gate or produces a record with
 *  its HTTP-meaningful status (201 fresh insert / 200 idempotent replay). */
export type CreateThreadResult =
  | { kind: 'forbidden' }
  | { kind: 'created'; thread: Thread; status: 200 | 201 }

export type MarkReadResult = { kind: 'thread_not_found' } | { kind: 'ok' }

/**
 * Messaging business logic, Hono-free: thread/message creation with idempotent
 * replay handling and the participant-authz gate. The route stays a thin shell
 * that parses input, maps these results to HTTP, and owns the 404-before-400
 * ordering by calling {@link MessageService.getThread} before parsing the body.
 */
export class MessageService {
  constructor(
    private readonly threadRepo: ThreadRepository,
    private readonly messageRepo: MessageRepository,
  ) {}

  async listThreads(
    ctx: CallerContext,
    limit: number,
    offset: number,
  ): Promise<{ threads: ThreadListItem[]; total: number }> {
    const all = await this.threadRepo.findAll(ctx)
    return { threads: all.slice(offset, offset + limit), total: all.length }
  }

  async getThread(ctx: CallerContext, id: string): Promise<ThreadDetail | undefined> {
    return this.threadRepo.findById(ctx, id)
  }

  async createThread(ctx: CallerContext, input: CreateThreadInput): Promise<CreateThreadResult> {
    if (!PRIVILEGED_ROLES.has(ctx.role) && !input.participantIds.includes(ctx.userId)) {
      return { kind: 'forbidden' }
    }
    const idempotencyKey = input.idempotencyKey ?? null
    const { record, status } = await idempotentCreate(
      idempotencyKey,
      (k) => this.threadRepo.findByIdempotencyKey(ctx, k),
      () =>
        // operatorId is intentionally NOT passed (#1205, review finding 1): the
        // caller-facing path must never derive tenant scope from a request body.
        // It stays null here; only ensureThread stamps it, from the booking.
        this.threadRepo.create(
          ctx,
          input.bookingId ?? null,
          input.participantIds,
          idempotencyKey,
          null,
        ),
    )
    return { kind: 'created', thread: record, status }
  }

  /**
   * Create a message in a thread the caller has already been confirmed to reach
   * (the route guards existence + scope via {@link getThread} first, preserving
   * the original 404-before-400 order).
   */
  async createMessage(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey: string | null,
  ): Promise<{ message: Message; status: 200 | 201 }> {
    const { record, status } = await idempotentCreate(
      idempotencyKey,
      (k) => this.messageRepo.findByIdempotencyKey(ctx, k),
      () => this.messageRepo.create(ctx, threadId, content, idempotencyKey),
    )
    return { message: record, status }
  }

  async markRead(ctx: CallerContext, threadId: string): Promise<MarkReadResult> {
    const thread = await this.threadRepo.findById(ctx, threadId)
    if (!thread) return { kind: 'thread_not_found' }
    await this.threadRepo.markAsRead(ctx, thread.id)
    return { kind: 'ok' }
  }
}

/**
 * Idempotent create: check for an existing record by key, attempt insert, catch
 * the UNIQUE_VIOLATION race and re-fetch. Returns { record, status } where 201
 * is a fresh insert and 200 an idempotent replay.
 */
async function idempotentCreate<T>(
  key: string | null,
  find: (k: string) => Promise<T | undefined>,
  insert: () => Promise<T>,
): Promise<{ record: T; status: 200 | 201 }> {
  if (key) {
    const existing = await find(key)
    if (existing) return { record: existing, status: 200 }
  }

  try {
    const record = await insert()
    return { record, status: 201 }
  } catch (err) {
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && key) {
      const existing = await find(key)
      if (existing) return { record: existing, status: 200 }
    }
    throw err
  }
}
