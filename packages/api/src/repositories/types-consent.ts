// Consent data-access contract (#877, extends epic #613). Extracted so types.ts stays under
// the file-size cap; re-exported from that barrel for callers.
import type { ConsentType } from '@kuruma/shared/enums'
import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentAcceptance, ConsentDocument } from '../stores'

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
  findBookingAcceptance(bookingId: string): Promise<ConsentAcceptance | undefined>
  findOperatorDocumentAcceptance(
    operatorId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined>
  createAcceptance(data: NewConsentAcceptance): Promise<ConsentAcceptance>
  findAcceptanceById(id: string): Promise<ConsentAcceptance | undefined>
  findAcceptancesByUser(userId: string): Promise<ConsentAcceptance[]>
  findAcceptancesByBooking(bookingId: string): Promise<ConsentAcceptance[]>
}
