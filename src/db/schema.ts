import { pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

export const roleEnum = pgEnum('role', ['RENTER', 'STAFF', 'ADMIN'])

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  supabaseAuthId: text('supabase_auth_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('RENTER'),
  language: text('language').notNull().default('en'),
  country: text('country'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
