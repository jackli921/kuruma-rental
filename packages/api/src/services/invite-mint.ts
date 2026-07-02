import { randomToken } from '../auth/google'
import { sha256Hex } from '../auth/token-hash'

// Invites are short-lived: a leaked link is only useful for a week, and the
// recipient is expected to accept promptly during onboarding.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface MintedInvite {
  readonly token: string
  readonly tokenHash: string
  readonly expiresAt: Date
  readonly inviteUrl: string
}

// Single source for invite token/TTL/hash/URL derivation (#1277), shared by the
// provider-invite service and the operator-approval flow. Pure given `now` — the
// clock is injectable so the tx path and tests stay deterministic.
export function mintInvite(opts: { webBaseUrl: string; ttlMs?: number; now?: Date }): MintedInvite {
  const token = randomToken(32)
  const now = opts.now ?? new Date()
  const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? INVITE_TTL_MS))
  const base = opts.webBaseUrl.replace(/\/$/, '')
  return {
    token,
    tokenHash: sha256Hex(token),
    expiresAt,
    inviteUrl: `${base}/provider/invite/${token}`,
  }
}
