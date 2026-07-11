// Consent data-access contract (#877, extends epic #613). Extracted so types.ts stays under
// the file-size cap; re-exported from that barrel for callers.
import type { ConsentDocStatus, ConsentType } from '@kuruma/shared/enums'
import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentAcceptance, ConsentDocument } from '../stores'

export interface NewConsentDocument {
  operatorId: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
  status: ConsentDocStatus
  effectiveFrom: Date
  publishedAt: Date | null
}

export interface NewConsentAcceptance {
  documentId: string
  consentType: ConsentType
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  actorRole: string | null
  bookingId: string | null
  acceptedAt: Date
  context: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  method: ConsentAcceptance['method']
  recordSignature: string | null
  signingKeyId: string | null
  signatureCanonicalVersion: string | null
  documentSnapshot: DocumentSnapshot | null
}

/** Filters for the platform-admin governance ledger browse (#1091). All optional;
 *  an empty query returns the whole ledger. `acceptedFrom`/`acceptedTo` inclusively
 *  bound `acceptedAt`. */
export interface ConsentAcceptanceQuery {
  userId?: string
  consentType?: ConsentType
  version?: string
  acceptedFrom?: Date
  acceptedTo?: Date
}

/**
 * Defensive hard cap on a single ledger browse (#1091). v1 ships no cursor
 * pagination, and `consent_acceptances` grows per-booking (every booking seals a
 * RENTER_LIABILITY acceptance), so an uncapped default browse balloons into a
 * multi-MB response at 2000+ users. Both repo impls slice newest-first to this;
 * real cursor pagination on `(acceptedAt, id)` is a later slice.
 */
export const CONSENT_ACCEPTANCE_LIST_LIMIT = 200

/** A ledger row joined to its document for the accepted `version` label (#1091).
 *  Read-only projection — carries no computed compliance status. */
export interface ConsentAcceptanceListRow {
  id: string
  userId: string
  consentType: ConsentType
  version: string
  operatorId: string | null
  bookingId: string | null
  acceptedAt: Date
}

export interface ConsentRepository {
  findDocumentById(id: string): Promise<ConsentDocument | undefined>
  /** Latest PUBLISHED+effective version string for a type, independent of locale (§7 cohort). */
  findLatestPublishedVersion(type: ConsentType, now: Date): Promise<string | undefined>
  /** Resolve the document row for a (type, version) in the subject's locale, else `en` fallback (Q4). */
  findPublishedDocument(
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined>
  /** Any accepted locale of this (type, version) by this user counts as current (§7). */
  hasAcceptedVersion(userId: string, type: ConsentType, version: string): Promise<boolean>
  /** Idempotency lookups — return the existing sealed row if present. */
  findUserDocumentAcceptance(
    userId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined>
  /** A booking can hold two per-booking (PER_EVENT) acceptances (liability + operator-terms),
   *  so the idempotency lookup is keyed on (bookingId, consentType), not bookingId alone (§6 H3). */
  findBookingAcceptance(
    bookingId: string,
    consentType: ConsentType,
  ): Promise<ConsentAcceptance | undefined>
  findOperatorDocumentAcceptance(
    operatorId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined>
  createAcceptance(data: NewConsentAcceptance): Promise<ConsentAcceptance>
  findAcceptanceById(id: string): Promise<ConsentAcceptance | undefined>
  findAcceptancesByUser(userId: string): Promise<ConsentAcceptance[]>
  findAcceptancesByBooking(bookingId: string): Promise<ConsentAcceptance[]>
  /** Cross-user governance browse (#1091): one batch read of the ledger, joined to
   *  documents for the accepted version, filtered + newest-first. Constant queries. */
  findAcceptances(query: ConsentAcceptanceQuery): Promise<ConsentAcceptanceListRow[]>

  // --- Operator-authored rental-terms (§5.3 resolution + authoring) ---
  findLatestPublishedVersionForOperator(
    operatorId: string,
    type: ConsentType,
    now: Date,
  ): Promise<string | undefined>
  findPublishedOperatorDocument(
    operatorId: string,
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined>
  /** Every row this operator authored for a type (any status) — the service groups by version. */
  findOperatorDocuments(operatorId: string, type: ConsentType): Promise<ConsentDocument[]>
  /**
   * Atomically rewrite an operator's DRAFT of one version: delete the prior draft
   * rows of (operatorId, type, version) and insert `rows` in a single transaction
   * (#1498), so a mid-op failure can't destroy the existing draft with nothing to
   * replace it. Throws the 23505 `consent_documents_operator_tvl_unique` when a
   * concurrent save already claimed the version — the service maps that to 409.
   */
  replaceOperatorDraftRows(
    operatorId: string,
    type: ConsentType,
    version: string,
    rows: NewConsentDocument[],
  ): Promise<ConsentDocument[]>
  setOperatorVersionStatus(params: {
    operatorId: string
    type: ConsentType
    version: string
    from: ConsentDocStatus
    to: ConsentDocStatus
    publishedAt: Date | null
    now: Date
  }): Promise<ConsentDocument[]>
}
