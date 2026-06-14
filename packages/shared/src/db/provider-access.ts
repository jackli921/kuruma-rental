import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { OPERATOR_MEMBERSHIP_STATUSES, OPERATOR_ROLES, PROVIDER_INVITE_STATUSES } from '../enums'
import { operators, users } from './auth'

// #521 — provider authorization model. Google proves identity; these tables
// grant authority. `operator_memberships` is the source-of-truth grant ledger;
// `users.role`/`users.operatorId` are its single-active projection that the JWT
// reads (MVP, Decision 1). `provider_invites` pre-approves an email for
// first-login provisioning. See
// docs/plans/2026-06-10-issue-521-provider-login-operator-access.md.

export const operatorRoleEnum = pgEnum('operator_role', OPERATOR_ROLES)
export const operatorMembershipStatusEnum = pgEnum(
  'operator_membership_status',
  OPERATOR_MEMBERSHIP_STATUSES,
)
// PENDING -> ACCEPTED only. Expired-ness is COMPUTED from expiresAt, never
// stored (YAGNI; REVOKED/EXPIRED land with the revoke/sweep follow-up, §13).
export const providerInviteStatusEnum = pgEnum('provider_invite_status', PROVIDER_INVITE_STATUSES)

export const operatorMemberships = pgTable(
  'operator_memberships',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Delete the person -> drop their grants.
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Operator deletion is out of scope (§12): restrict fails loud rather than
    // leaving a dangling projected users.operatorId whose slug 404s.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    role: operatorRoleEnum('role').notNull(),
    status: operatorMembershipStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One ACTIVE membership per user (MVP) AND the race fence for concurrent
    // invite acceptance (§4, §6). PARTIAL: REVOKED rows free the slot. Also
    // serves the findActiveMembership(userId) lookup (query filters ACTIVE).
    uniqueIndex('operator_memberships_active_user_unique')
      .on(t.userId)
      .where(sql`status = 'ACTIVE'`),
    index('idx_operator_memberships_operatorId').on(t.operatorId),
  ],
)

export const providerInvites = pgTable(
  'provider_invites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Lowercased invited Google email (admin endpoint normalizes on insert).
    email: text('email').notNull(),
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    role: operatorRoleEnum('role').notNull(),
    // sha256(token) hex. Plaintext token shown once at creation, never stored.
    tokenHash: text('tokenHash').notNull(),
    status: providerInviteStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    // Audit actors survive their own deletion (set null, not cascade).
    invitedByUserId: text('invitedByUserId').references(() => users.id, { onDelete: 'set null' }),
    acceptedByUserId: text('acceptedByUserId').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('provider_invites_tokenHash_unique').on(t.tokenHash),
    index('idx_provider_invites_email').on(t.email),
    // FK-covering indexes (lint:fk-indexes): keep operator-scoped listing and the
    // set-null cascades on actor deletion from doing sequential scans.
    index('idx_provider_invites_operatorId').on(t.operatorId),
    index('idx_provider_invites_invitedByUserId').on(t.invitedByUserId),
    index('idx_provider_invites_acceptedByUserId').on(t.acceptedByUserId),
  ],
)
