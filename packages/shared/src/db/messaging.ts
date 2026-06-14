import { integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { bookings } from './booking'

export const threads = pgTable('threads', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  bookingId: text('bookingId').references(() => bookings.id),
  idempotencyKey: text('idempotencyKey'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

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
  (t) => [unique('thread_participants_thread_user').on(t.threadId, t.userId)],
)

export const messages = pgTable('messages', {
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
})
