import type { ConsentMethod, ConsentType } from '@kuruma/shared/enums'
import { CANONICAL_VERSION } from '@kuruma/shared/lib/consent-canonical'
import type { NewConsentAcceptance } from '../repositories/types'
import { type SigningKey, signAcceptanceRecord } from './consent-signing'

/** The published document snapshot an acceptance row seals (spec §5). */
export interface AcceptanceDoc {
  id: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
}

/** Who accepted, how, and against which booking/operator — the mutable half of the row. */
export interface AcceptanceSubject {
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  actorRole: string | null
  bookingId: string | null
  method: ConsentMethod
  acceptedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Pure: HMAC-signs the canonical field set and packs the persisted row (spec §5).
 * Extracted from ConsentService.buildRow so the self-serve accept path and the
 * booking-create tx path build the identical signed row (#877 Slice B, M2). The
 * signed payload and the stored row MUST carry the identical fields (esp. method),
 * or the signature wouldn't cover what's persisted.
 */
export function buildAcceptanceRow(
  doc: AcceptanceDoc,
  subject: AcceptanceSubject,
  signingKey: SigningKey | undefined,
): NewConsentAcceptance {
  const signed = signingKey
    ? signAcceptanceRecord(
        {
          documentId: doc.id,
          contentHash: doc.contentHash,
          consentType: doc.type,
          version: doc.version,
          locale: doc.locale,
          userId: subject.userId,
          operatorId: subject.operatorId,
          operatorMembershipId: subject.operatorMembershipId,
          bookingId: subject.bookingId,
          method: subject.method,
          acceptedAt: subject.acceptedAt,
          ipAddress: subject.ipAddress,
          userAgent: subject.userAgent,
        },
        signingKey,
      )
    : undefined
  return {
    documentId: doc.id,
    consentType: doc.type,
    userId: subject.userId,
    operatorId: subject.operatorId,
    operatorMembershipId: subject.operatorMembershipId,
    actorRole: subject.actorRole,
    bookingId: subject.bookingId,
    acceptedAt: subject.acceptedAt,
    context: null,
    ipAddress: subject.ipAddress,
    userAgent: subject.userAgent,
    method: subject.method,
    recordSignature: signed?.signature ?? null,
    signingKeyId: signed?.signingKeyId ?? null,
    signatureCanonicalVersion: signed ? CANONICAL_VERSION : null,
    documentSnapshot: {
      version: doc.version,
      locale: doc.locale,
      title: doc.title,
      body: doc.body,
      acceptanceLabel: doc.acceptanceLabel,
      contentHash: doc.contentHash,
    },
  }
}
