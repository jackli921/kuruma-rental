import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { operators, users } from './auth'
import { bookings } from './booking'

// FK-covering and partial idempotency indexes — declared inline so the module
// describes the real table (audit M7 / #1112). Migrations 0010 + 0022 already
// created them in prod; 0078 codifies that state into the drizzle snapshot with
// `IF NOT EXISTS` so the apply is a no-op everywhere it has already run.
export const threads = pgTable(
  'threads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    bookingId: text('bookingId').references(() => bookings.id),
    // Tenant owner — denormalized from the booking's operator so the operator
    // portal can read-scope threads by operatorId without a thread->booking
    // join (#1205, mirrors notification_log.operatorId). Nullable because
    // bookingId is nullable (a bookingless thread has no operator and is
    // invisible to operators). Set by ensureThread; backfilled in this migration.
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    // Operator-side unread counter (#1205, slice 3). Tenant-level, not per-user:
    // operators are NOT thread participants (they read-scope by operatorId), and
    // the inbox is one shared surface, so operator unread lives on the thread
    // rather than a thread_participants row. Bumped on a renter send, zeroed when
    // the operator reads. The renter side keeps its own per-participant unreadCount.
    operatorUnreadCount: integer('operatorUnreadCount').notNull().default(0),
    idempotencyKey: text('idempotencyKey'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_threads_bookingId').on(t.bookingId),
    index('idx_threads_operatorId').on(t.operatorId),
    uniqueIndex('threads_idempotency_key')
      .on(t.idempotencyKey)
      .where(sql`"idempotencyKey" is not null`),
  ],
)

export const threadParticipants = pgTable(
  'thread_participants',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    threadId: text('threadId')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => users.id),
    unreadCount: integer('unreadCount').notNull().default(0),
  },
  (t) => [
    unique('thread_participants_thread_user').on(t.threadId, t.userId),
    index('idx_thread_participants_threadId').on(t.threadId),
    index('idx_thread_participants_userId').on(t.userId),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    threadId: text('threadId')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    senderId: text('senderId')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    sourceLanguage: text('sourceLanguage'),
    translations: jsonb('translations').$type<Record<string, string>>().notNull().default({}),
    idempotencyKey: text('idempotencyKey'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_messages_threadId').on(t.threadId),
    index('idx_messages_senderId').on(t.senderId),
    uniqueIndex('messages_idempotency_key')
      .on(t.idempotencyKey)
      .where(sql`"idempotencyKey" is not null`),
  ],
)
