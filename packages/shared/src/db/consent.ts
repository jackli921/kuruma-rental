import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { CONSENT_DOC_STATUSES, CONSENT_METHODS, CONSENT_TYPES } from '../enums'
import type { DocumentSnapshot } from '../lib/consent-canonical'
import { operators, users } from './auth'
import { bookings } from './booking'
import { operatorMemberships } from './provider-access'

export const consentTypeEnum = pgEnum('consent_type', CONSENT_TYPES)
export const consentDocStatusEnum = pgEnum('consent_doc_status', CONSENT_DOC_STATUSES)
export const consentMethodEnum = pgEnum('consent_method', CONSENT_METHODS)

/** Versioned, immutable-once-PUBLISHED legal documents (the archived "what they were shown"). */
export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: text('id').primaryKey(),
    type: consentTypeEnum('type').notNull(),
    version: text('version').notNull(),
    locale: text('locale').notNull(),
    // Platform docs stay NULL; operator-authored rental-terms set it (§4.2).
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    acceptanceLabel: text('acceptanceLabel').notNull(),
    contentHash: text('contentHash').notNull(),
    status: consentDocStatusEnum('status').notNull().default('DRAFT'),
    effectiveFrom: timestamp('effectiveFrom', { withTimezone: true }).notNull(),
    publishedAt: timestamp('publishedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.3 — two partial uniques (a single nullable-column unique would let duplicate
    // platform rows in, since Postgres treats NULLs as distinct).
    uniqueIndex('consent_documents_platform_tvl_unique')
      .on(t.type, t.version, t.locale)
      .where(sql`${t.operatorId} IS NULL`),
    uniqueIndex('consent_documents_operator_tvl_unique')
      .on(t.operatorId, t.type, t.version, t.locale)
      .where(sql`${t.operatorId} IS NOT NULL`),
    // Redundant vs PK, but it is the composite-FK target that keeps acceptances' denormalized
    // `consentType` honest (§4.1 sync seal).
    unique('consent_documents_id_type_unique').on(t.id, t.type),
    // FK-covering index (lint:fk-indexes).
    index('consent_documents_operator_idx').on(t.operatorId),
  ],
)

/** Append-only acceptance ledger. */
export const consentAcceptances = pgTable(
  'consent_acceptances',
  {
    id: text('id').primaryKey(),
    documentId: text('documentId').notNull(),
    consentType: consentTypeEnum('consentType').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    operatorMembershipId: text('operatorMembershipId').references(() => operatorMemberships.id, {
      onDelete: 'restrict',
    }),
    actorRole: text('actorRole'),
    bookingId: text('bookingId').references(() => bookings.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp('acceptedAt', { withTimezone: true }).notNull(),
    context: jsonb('context').$type<Record<string, unknown>>(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    method: consentMethodEnum('method').notNull().default('CLICKWRAP'),
    recordSignature: text('recordSignature'),
    signingKeyId: text('signingKeyId'),
    signatureRef: text('signatureRef'),
    documentSnapshot: jsonb('documentSnapshot').$type<DocumentSnapshot>(),
    signatureCanonicalVersion: text('signatureCanonicalVersion'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sync seal: snapshot consentType cannot diverge from the referenced document's real type.
    foreignKey({
      columns: [t.documentId, t.consentType],
      foreignColumns: [consentDocuments.id, consentDocuments.type],
      name: 'consent_acceptances_document_type_fk',
    }).onDelete('restrict'),
    // Row-shape invariants (DB-enforced, not service-promised).
    check(
      'consent_liability_booking_chk',
      sql`(${t.consentType} = 'RENTER_LIABILITY') = (${t.bookingId} IS NOT NULL)`,
    ),
    check(
      'consent_operator_agreement_chk',
      sql`(${t.consentType} = 'OPERATOR_AGREEMENT') = (${t.operatorId} IS NOT NULL)`,
    ),
    check(
      'consent_membership_implies_operator_chk',
      sql`${t.operatorMembershipId} IS NULL OR ${t.operatorId} IS NOT NULL`,
    ),
    // Three disjoint idempotency seals (§4.1). documentId pins version+locale, so a new
    // version is a different row (re-consent history, not a dup).
    uniqueIndex('consent_unique_booking_liability')
      .on(t.bookingId)
      .where(sql`${t.bookingId} IS NOT NULL`),
    uniqueIndex('consent_unique_user_document')
      .on(t.userId, t.documentId)
      .where(sql`${t.bookingId} IS NULL AND ${t.operatorId} IS NULL`),
    uniqueIndex('consent_unique_operator_document')
      .on(t.operatorId, t.documentId)
      .where(sql`${t.operatorId} IS NOT NULL`),
    // FK-covering indexes (lint:fk-indexes). userId/operatorId/bookingId are leading in the
    // partial uniques above; these cover the composite FK + bare documentId, and membership.
    index('consent_acceptances_document_type_idx').on(t.documentId, t.consentType),
    index('consent_acceptances_membership_idx').on(t.operatorMembershipId),
    // consentType is the second column of the composite FK (documentId, consentType); it
    // needs its own covering index per lint:fk-indexes.
    index('consent_acceptances_consent_type_idx').on(t.consentType),
  ],
)
