import { type SigningKey, signAcceptanceRecord } from '../packages/api/src/services/consent-signing'
import type { ConsentAcceptance, ConsentDocument } from '../packages/api/src/stores'
import {
  type DocumentSnapshot,
  computeContentHash,
} from '../packages/shared/src/lib/consent-canonical'

export type BackfillAction =
  | 'backfill'
  | 'skipped-current-doc-hash-mismatch'
  | 'skipped-hash-mismatch'
  | 'skipped-unsigned'

export interface BackfillDecision {
  action: BackfillAction
  snapshot?: DocumentSnapshot
  timestampDrift?: boolean
}

export function decideBackfill(
  a: ConsentAcceptance,
  doc: ConsentDocument,
  getKey: (keyId: string) => SigningKey | undefined,
): BackfillDecision {
  // Gate 1 (MUST be first): the current doc's text must hash to its OWN contentHash, else the
  // artifact is internally inconsistent and the HMAC (computed over the stored hash) could pass
  // while the displayed text is wrong.
  if (computeContentHash(doc) !== doc.contentHash)
    return { action: 'skipped-current-doc-hash-mismatch' }
  // Gate 3: no crypto proof for unsigned rows (or rows whose key we no longer hold).
  if (!a.recordSignature) return { action: 'skipped-unsigned' }
  const key = a.signingKeyId ? getKey(a.signingKeyId) : undefined
  if (!key) return { action: 'skipped-unsigned' }
  // Gate 2: does the CURRENT doc's hash, signed under this row's fields, reproduce recordSignature?
  const recomputed = signAcceptanceRecord(
    {
      documentId: a.documentId,
      contentHash: doc.contentHash,
      consentType: a.consentType,
      version: doc.version,
      locale: doc.locale,
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
  if (recomputed !== a.recordSignature) return { action: 'skipped-hash-mismatch' }
  const snapshot: DocumentSnapshot = {
    version: doc.version,
    locale: doc.locale,
    title: doc.title,
    body: doc.body,
    acceptanceLabel: doc.acceptanceLabel,
    contentHash: doc.contentHash,
  }
  return { action: 'backfill', snapshot, timestampDrift: doc.updatedAt > a.acceptedAt }
}
