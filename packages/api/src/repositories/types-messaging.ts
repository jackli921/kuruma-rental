// Messaging bounded-context data-access interfaces (#1032 threads/messages,
// #1205 operator un-gate). Extracted from ./types to keep that barrel under the
// file-size cap (#837/#978, same split as types-notification / types-review);
// re-exported there so callers keep importing from ../types.
import type { CallerContext } from '../middleware/auth'
import type { Message, Thread, ThreadParticipant } from '../stores'

export interface ThreadRepository {
  findAll(
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>>
  findById(
    ctx: CallerContext,
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined>
  /**
   * Look up a thread by idempotency key scoped to the caller. Non-privileged
   * callers only match threads where they are a participant. Prevents
   * cross-tenant leakage when a client replays a key observed from another
   * tenant (issue #328).
   */
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Thread | undefined>
  create(
    ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
    // Server-derived tenant owner (#1205). ensureThread passes booking.operatorId;
    // the caller-facing path leaves it null — operatorId is NEVER read from a
    // request body, so a caller can't assign a thread's tenant scope.
    operatorId?: string | null,
  ): Promise<Thread>
  markAsRead(ctx: CallerContext, threadId: string): Promise<void>
}

/**
 * #1205 slice 4: the post-bump operator-unread state a renter send produced,
 * surfaced from create() so the service fires the OPERATOR_NEW_MESSAGE email on
 * the 0->1 transition without a read-then-check race (two concurrent renter sends
 * would both read the settled count and miss the window). Non-null ONLY when the
 * send bumped a booking+operator thread's tenant unread; `unreadCount` is the
 * post-bump value and `=== 1` is exactly the 0->1 transition. bookingId/operatorId
 * are both required (notification_log needs both notNull), so a thread missing
 * either yields null even though the counter still incremented.
 */
export interface OperatorUnreadTransition {
  operatorId: string
  bookingId: string
  unreadCount: number
}

export interface MessageCreateResult {
  message: Message
  operatorUnread: OperatorUnreadTransition | null
}

export interface MessageRepository {
  /**
   * Find a message by id, scoped to the caller. Non-privileged callers
   * only see messages in threads they participate in; others get
   * `undefined`. Privileged roles (STAFF/ADMIN) bypass the scope.
   */
  findById(ctx: CallerContext, id: string): Promise<Message | undefined>
  /**
   * Look up a message by idempotency key scoped to the caller. The key is
   * sender-owned: the lookup matches only messages where `senderId = ctx.userId`
   * for non-privileged callers. Prevents cross-tenant leakage when a client
   * replays a key observed from another sender (issue #328).
   */
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Message | undefined>
  create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<MessageCreateResult>
  findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]>
  /**
   * Merge a single language translation into the message's `translations`
   * JSON map. If `detectedSourceLanguage` is provided, also update the
   * message's `sourceLanguage` column (used when the original language
   * was unknown at send time and the provider auto-detected it).
   */
  updateTranslation(
    messageId: string,
    language: string,
    translatedText: string,
    detectedSourceLanguage: string | null,
  ): Promise<Message | undefined>
}
