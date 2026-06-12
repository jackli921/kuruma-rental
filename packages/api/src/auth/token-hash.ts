import { createHash } from 'node:crypto'

/**
 * sha256(token) as lowercase hex — the only form of a provider-invite token we
 * persist or look up by (#521). The plaintext is shown once at creation and never
 * stored, so both the issue path (ProviderInviteService) and the redeem path
 * (OperatorGrantService) hash through this single helper to stay in lockstep.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
