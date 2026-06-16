import { createHmac } from 'node:crypto'
import type { ConsentMethod, ConsentType } from '@kuruma/shared/enums'
import { canonicalizeFields } from '@kuruma/shared/lib/consent-canonical'

export interface SignableAcceptance {
  documentId: string
  contentHash: string
  consentType: ConsentType
  version: string
  locale: string
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  bookingId: string | null
  method: ConsentMethod
  acceptedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

export interface SigningKey {
  key: string
  keyId: string
}

export interface AcceptanceSignature {
  signature: string
  signingKeyId: string
}

/** Tier-1: HMAC-SHA256 over the canonical signed-field set (spec §5). */
export function signAcceptanceRecord(
  p: SignableAcceptance,
  signingKey: SigningKey,
): AcceptanceSignature {
  const canonical = canonicalizeFields([
    ['documentId', p.documentId],
    ['contentHash', p.contentHash],
    ['consentType', p.consentType],
    ['version', p.version],
    ['locale', p.locale],
    ['userId', p.userId],
    ['operatorId', p.operatorId],
    ['operatorMembershipId', p.operatorMembershipId],
    ['bookingId', p.bookingId],
    ['method', p.method],
    ['acceptedAt', p.acceptedAt.toISOString()],
    ['ipAddress', p.ipAddress],
    ['userAgent', p.userAgent],
  ])
  const signature = createHmac('sha256', signingKey.key).update(canonical, 'utf8').digest('hex')
  return { signature, signingKeyId: signingKey.keyId }
}

/** Reads the CF secret. Returns undefined when unconfigured (caller decides: IMPORTED rows skip signing). */
export function resolveSigningKey(): SigningKey | undefined {
  const key = process.env.CONSENT_SIGNING_KEY
  if (!key) return undefined
  return { key, keyId: process.env.CONSENT_SIGNING_KEY_ID ?? 'v1' }
}
