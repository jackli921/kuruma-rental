import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import {
  OPERATOR_APPLICATION_BUSINESS_TYPES,
  OPERATOR_APPLICATION_FLEET_SIZES,
  OPERATOR_APPLICATION_STATUSES,
} from '../enums'
import { operators, users } from './auth'

// Public self-serve operator registration (#1277). QUARANTINE table: untrusted
// form input lands here and NEVER touches `operators` until a platform admin
// approves. Approval provisions the operator + an OPERATOR_OWNER invite in one tx
// and links `operatorId` back here. Own module (not schema.ts) to keep the
// aggregate schema file under the size cap; re-exported from schema.ts so
// drizzle-kit discovers it. `operators` FK uses a lazy () => thunk.
export const operatorApplicationStatusEnum = pgEnum(
  'operator_application_status',
  OPERATOR_APPLICATION_STATUSES,
)
export const operatorApplicationFleetSizeEnum = pgEnum(
  'operator_application_fleet_size',
  OPERATOR_APPLICATION_FLEET_SIZES,
)
export const operatorApplicationBusinessTypeEnum = pgEnum(
  'operator_application_business_type',
  OPERATOR_APPLICATION_BUSINESS_TYPES,
)

export const operatorApplications = pgTable(
  'operator_applications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    status: operatorApplicationStatusEnum('status').notNull().default('PENDING'),
    businessName: text('businessName').notNull(),
    contactName: text('contactName').notNull(),
    // Stored lowercased at the boundary; the provider-invite target on approval.
    contactEmail: text('contactEmail').notNull(),
    contactPhone: text('contactPhone').notNull(),
    serviceArea: text('serviceArea').notNull(),
    estimatedFleetSize: operatorApplicationFleetSizeEnum('estimatedFleetSize').notNull(),
    website: text('website'),
    businessLicenseNumber: text('businessLicenseNumber'),
    businessType: operatorApplicationBusinessTypeEnum('businessType'),
    message: text('message'),
    submittedLocale: text('submittedLocale').notNull(),
    // Set in the approval tx. onDelete restrict — an approved app must not be
    // silently orphaned by an operator delete (matches memberships/invites).
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    reviewedByUserId: text('reviewedByUserId').references(() => users.id),
    reviewedAt: timestamp('reviewedAt', { withTimezone: true }),
    reviewerNotes: text('reviewerNotes'),
    rejectionReason: text('rejectionReason'),
    // Millisecond precision (#1371): createdAt is the admin-queue keyset sort key,
    // and the opaque cursor encodes it via Date.toISOString() (millisecond). A
    // plain microsecond timestamptz let two same-millisecond rows fall into the
    // seek's dead zone and be silently skipped across a page boundary. Pinning the
    // column to (3) keeps stored == read == cursor so the tiebreak always applies.
    createdAt: timestamp('createdAt', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Admin queue filters on status; ordering by createdAt.
    index('idx_operator_applications_status').on(t.status),
    // FK-covering index (lint:fk-indexes).
    index('idx_operator_applications_operatorId').on(t.operatorId),
    // Covers the reviewedByUserId FK (lint:fk-indexes) + "applications I reviewed" lookups.
    index('idx_operator_applications_reviewedByUserId').on(t.reviewedByUserId),
    // THE dedup invariant: at most one live application per email, covering BOTH
    // PENDING and APPROVED so there is no gap during the PENDING->APPROVED flip.
    // REJECTED rows leave the set, so a rejected applicant may re-apply. Emails
    // are lowercased at the boundary, so a plain column suffices.
    uniqueIndex('operator_applications_live_email_unique')
      .on(t.contactEmail)
      .where(sql`status in ('PENDING','APPROVED')`),
  ],
)
