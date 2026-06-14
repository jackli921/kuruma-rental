import { date, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '../enums'
import { users } from './auth'

// Renter identity documents (#459, §1.3/§4). Metadata ONLY — the scan lives in
// Cloudflare R2; we keep the verdict (status + expiry), never the bytes or a URL
// (data minimization, §4.1). An approved, non-expired IDP gates booking confirm
// behind a feature flag (see BookingService verification seam). Auto-retention
// (app-delete + R2 lifecycle) is a follow-up (#466) — the metadata is enough to
// support a future purge, which is why we store storageKey.
//
// Lives in its own module (not schema.ts) so the aggregate schema file stays
// under the 800-line cap; re-exported from schema.ts so drizzle-kit (which reads
// schema.ts) still discovers the table. The `users` FK uses lazy `() =>` thunks,
// so the schema.ts ⇄ renter-documents circular import resolves cleanly.
export const documentTypeEnum = pgEnum('document_type', DOCUMENT_TYPES)
export const documentStatusEnum = pgEnum('document_status', DOCUMENT_STATUSES)

export const renterDocuments = pgTable(
  'renter_documents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    renterId: text('renterId')
      .notNull()
      .references(() => users.id),
    type: documentTypeEnum('type').notNull(),
    // R2 object key — the only pointer to the bytes. Never store the image or a URL.
    storageKey: text('storageKey').notNull(),
    status: documentStatusEnum('status').notNull().default('PENDING'),
    // Recorded by the verifier at approval; gates booking when < rental return.
    expiryDate: date('expiryDate', { mode: 'string' }),
    verifiedAt: timestamp('verifiedAt', { withTimezone: true }),
    verifierId: text('verifierId').references(() => users.id),
    rejectionReason: text('rejectionReason'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Gate + list-mine query the renter's docs on every booking attempt.
    index('idx_renter_documents_renterId').on(t.renterId),
    // Covers the verifierId FK (lint-fk-indexes) + "docs I reviewed" lookups.
    index('idx_renter_documents_verifierId').on(t.verifierId),
    // Admin pending-review queue filters on status.
    index('idx_renter_documents_status').on(t.status),
  ],
)
