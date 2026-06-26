import { index, integer, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'
// Enum value sets are declared ONCE in ../enums (zero-import, no-DB subpath) so
// the DB pgEnums, the Zod validators, and the web type imports all share one
// source (#688). The pgEnum below feeds this array into `pgEnum(...)`.
import { ROLES } from '../enums'

// Marketplace tenancy (epic #385, slice 1 / #386).
// OPERATOR_* roles are tenant-scoped and NEVER bypass operator scope.
// PLATFORM_ADMIN is the only role allowed to bypass (env-gated).
// Legacy STAFF / ADMIN remain as temporary platform-admin equivalents
// during the transition — no new users get them. See proposal §6.2.
export const roleEnum = pgEnum('role', ROLES)

// Operators are the marketplace tenants (e.g. Best Car Rental). Every
// operator-owned entity (vehicles, classes, later locations/insurance/fees)
// carries an operatorId FK. See proposal §6 row 1.
export const operators = pgTable('operators', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // kebab-case ASCII, max 32 chars; powers /manage/<slug>/... routing (§9 item 15)
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // §9 item 2: external pre-auth/handoff URL (separate Stripe site, post-MVP)
  preAuthHandoffUrl: text('pre_auth_handoff_url'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  // #1088: soft-deactivation. NULL = active; set = deactivated (hidden from
  // storefront/search, blocks new bookings). `active` is derived, never stored.
  deactivatedAt: timestamp('deactivatedAt', { withTimezone: true }),
})

// Auth.js required fields + app profile fields
// Column names must be camelCase to match @auth/drizzle-adapter expectations
export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name'),
    email: text('email').unique().notNull(),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    image: text('image'),
    role: roleEnum('role').notNull().default('RENTER'),
    // NULL = renter or platform admin (both legitimate). Set for OPERATOR_*.
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    phone: text('phone'),
    language: text('language').notNull().default('en'),
    country: text('country'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_users_operatorId').on(table.operatorId)],
)

export const accounts = pgTable(
  'accounts',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
)

export type { Role } from '../enums'
