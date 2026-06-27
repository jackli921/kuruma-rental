import { type DocumentSnapshot, computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentAcceptance } from '../stores'
import { type SigningKey, signAcceptanceRecord } from './consent-signing'

export type ConsentVerificationStatus =
  | 'VERIFIED'
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_HASH_MISMATCH'
  | 'UNSIGNED'
  | 'KEY_UNAVAILABLE'
  | 'SIGNATURE_MISMATCH'

export interface ConsentVerification {
  status: ConsentVerificationStatus
  detail?: string | undefined
}

/** Gate chain — first failing gate is the status. `getKey` resolves a keyId to its
 *  SigningKey (undefined when we no longer hold it). Pure; no I/O. */
export function verifyAcceptance(
  a: ConsentAcceptance,
  getKey: (keyId: string) => SigningKey | undefined,
): ConsentVerification {
  const snap: DocumentSnapshot | null = a.documentSnapshot
  if (!snap) return { status: 'SNAPSHOT_MISSING' }
  if (computeContentHash(snap) !== snap.contentHash) return { status: 'SNAPSHOT_HASH_MISMATCH' }
  if (!a.recordSignature) return { status: 'UNSIGNED' }
  const key = a.signingKeyId ? getKey(a.signingKeyId) : undefined
  if (!key) return { status: 'KEY_UNAVAILABLE', detail: a.signingKeyId ?? undefined }
  // TODO(#1050): when multiple canonical versions exist, dispatch on a.signatureCanonicalVersion.
  const recomputed = signAcceptanceRecord(
    {
      documentId: a.documentId,
      contentHash: snap.contentHash,
      consentType: a.consentType,
      version: snap.version,
      locale: snap.locale,
      userId: a.userId,
      operatorId: a.operatorId,
      operatorMembershipId: a.operatorMembershipId,
      bookingId: a.bookingId,
      method: a.method,
      acceptedAt: a.acceptedAt,
      ipAddress: a.ipAddress,
      userAgent: a.userAgent,
    },
    key,
  ).signature
  return recomputed === a.recordSignature
    ? { status: 'VERIFIED' }
    : { status: 'SIGNATURE_MISMATCH' }
}
