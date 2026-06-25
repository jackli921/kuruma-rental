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
    // Bind the key identity into the signature so a rotated/relabelled keyId
    // can't be swapped onto an existing record without invalidating it.
    ['signingKeyId', signingKey.keyId],
  ])
  const signature = createHmac('sha256', signingKey.key).update(canonical, 'utf8').digest('hex')
  return { signature, signingKeyId: signingKey.keyId }
}

/**
 * Reads the CF secret. Returns undefined when unconfigured so IMPORTED-row
 * flows (the only legitimate "skip signing" caller) keep working — those rows
 * are signed by their imported provenance, not this service. In production,
 * however, an absent secret means a real renter accept endpoint would silently
 * write `recordSignature: null` and call it consent — so we fail closed and
 * throw at first use, mirroring the Stripe sentinel in index.ts:208-217. The
 * throw bubbles to a 500 at the route boundary, which a deploy will catch
 * loudly; the `rotate-secrets.yml` entry added with this fix is the cure (#1048).
 */
export function resolveSigningKey(): SigningKey | undefined {
  const key = process.env.CONSENT_SIGNING_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CONSENT_SIGNING_KEY not configured in production. Set it via .github/workflows/rotate-secrets.yml (CONSENT_SIGNING_KEY GitHub Secret) — see #1048.',
      )
    }
    return undefined
  }
  // `||` (not `??`) so an explicitly-empty CONSENT_SIGNING_KEY_ID is treated
  // as unset and falls back to v1 — matches how the `!key` guard above treats
  // an explicitly-empty CONSENT_SIGNING_KEY as unset (and what vi.stubEnv
  // does in tests, which has no API to truly delete an env var).
  return { key, keyId: process.env.CONSENT_SIGNING_KEY_ID || 'v1' }
}
