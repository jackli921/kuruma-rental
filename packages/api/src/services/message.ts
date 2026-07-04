import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  MessageCreateResult,
  MessageRepository,
  ThreadRepository,
} from '../repositories/types'
import type { Message } from '../stores'

type ThreadListItem = Awaited<ReturnType<ThreadRepository['findAll']>>[number]
type ThreadDetail = NonNullable<Awaited<ReturnType<ThreadRepository['findById']>>>

export type MarkReadResult = { kind: 'thread_not_found' } | { kind: 'ok' }

/**
 * #1205 slice 4: alert the operator that a renter opened a new unread window (the
 * operator-unread 0->1 transition). Injected as a single function (ISP) so
 * MessageService never depends on the notification dispatcher directly — the
 * composition root wires it to NotificationDispatcher.dispatchOperatorNewMessage.
 * Resolves void; the service treats a rejection as non-fatal (the message is
 * authoritative, an alert outage must never fail the send).
 */
export type NotifyOperatorNewMessage = (args: {
  threadId: string
  bookingId: string
  operatorId: string
  messageId: string
  senderUserId: string
}) => Promise<void>

/**
 * Messaging business logic, Hono-free: message creation with idempotent replay
 * handling and the participant-authz gate. The route stays a thin shell
 * that parses input, maps these results to HTTP, and owns the 404-before-400
 * ordering by calling {@link MessageService.getThread} before parsing the body.
 */
export class MessageService {
  constructor(
    private readonly threadRepo: ThreadRepository,
    private readonly messageRepo: MessageRepository,
    private readonly notifyOperatorNewMessage: NotifyOperatorNewMessage,
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
    // create() returns the message plus the post-bump operator-unread state; an
    // idempotent replay (the find arm) has no transition, so wrap it as null.
    const { record, status } = await idempotentCreate<MessageCreateResult>(
      idempotencyKey,
      async (k) => {
        const found = await this.messageRepo.findByIdempotencyKey(ctx, k)
        return found ? { message: found, operatorUnread: null } : undefined
      },
      () => this.messageRepo.create(ctx, threadId, content, idempotencyKey),
    )

    // #1205: a renter's FIRST unread message to the operator alerts them. The
    // transition is non-null only for a renter send on a booking+operator thread,
    // and unreadCount === 1 is exactly the 0->1 edge — so 1->2 (already unread), an
    // operator's own reply (no transition), and an idempotent replay (status 200,
    // null transition) all skip it. It re-arms once the operator reads the thread.
    const transition = record.operatorUnread
    if (status === 201 && transition?.unreadCount === 1) {
      // Awaited like the booking post-commit dispatch, but self-caught: the message
      // is authoritative, so an alert outage must never propagate into the send.
      await this.notifyOperatorNewMessage({
        threadId,
        bookingId: transition.bookingId,
        operatorId: transition.operatorId,
        messageId: record.message.id,
        senderUserId: ctx.userId,
      }).catch((err) => {
        console.error('[message:operator-alert] failed', {
          messageId: record.message.id,
          reason: err instanceof Error ? err.message : String(err),
        })
      })
    }

    return { message: record.message, status }
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
