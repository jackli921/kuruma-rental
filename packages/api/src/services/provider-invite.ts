import type { CreateProviderInviteInput } from '@kuruma/shared/validators/provider-invite'
import { randomToken } from '../auth/google'
import { sha256Hex } from '../auth/token-hash'
import type { OperatorRepository, ProviderInviteRepository } from '../repositories/types'

// Invites are short-lived: a leaked link is only useful for a week, and the
// recipient is expected to accept promptly during onboarding.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Raised when an invite is minted against an operatorId with no matching row.
 *  The route maps this to a 404 so a bad target reads as a client error, not a
 *  500 from the FK violation (#563). */
export class OperatorNotFoundError extends Error {
  constructor(readonly operatorId: string) {
    super(`Operator not found: ${operatorId}`)
    this.name = 'OperatorNotFoundError'
  }
}

export interface ProviderInviteAuditEvent {
  readonly type: 'PROVIDER_INVITE_CREATED'
  readonly invitedByUserId: string
  readonly operatorId: string
  readonly email: string
}

// Injected so the privilege-grant trail is assertable in tests and the service
// stays free of a hardcoded sink. index.ts wires a console-backed default.
export type RecordProviderInviteAudit = (event: ProviderInviteAuditEvent) => void

export interface ProviderInviteServiceConfig {
  /** Public web origin; the invite link is `${webBaseUrl}/provider/invite/<token>`. */
  readonly webBaseUrl: string
  /** Override the default TTL (tests). */
  readonly ttlMs?: number
}

/** Returned once at creation. The plaintext token is never persisted (only its
 *  hash) and never logged, so this is the sole moment it exists in cleartext. */
export interface CreatedInvite {
  readonly token: string
  readonly inviteUrl: string
  readonly expiresAt: Date
}

/** Public preview of an invite (#521 §7). Deliberately omits the invited
 *  `email`: a leaked link must not disclose the target address or aid a phish —
 *  the email is verified server-side at accept, so the page never needs it. */
export interface ProviderInvitePreview {
  readonly valid: boolean
  readonly operatorName?: string
  readonly expiresAt?: Date
}

export class ProviderInviteService {
  constructor(
    private readonly repo: ProviderInviteRepository,
    private readonly operatorRepo: OperatorRepository,
    private readonly config: ProviderInviteServiceConfig,
    private readonly recordAudit: RecordProviderInviteAudit,
  ) {}

  // A 256-bit token makes a tokenHash collision astronomically impossible, so we
  // deliberately don't add a regenerate-on-23505 retry loop (YAGNI — it would be
  // unreachable branches). The input is already validated + email-lowercased by
  // createProviderInviteSchema at the route boundary.
  async createInvite(
    input: CreateProviderInviteInput,
    invitedByUserId: string,
  ): Promise<CreatedInvite> {
    // Validate the target exists before the insert so an unknown operatorId is a
    // clean 404 rather than a 500 from the FK constraint (#563).
    const operator = await this.operatorRepo.findById(input.operatorId)
    if (!operator) throw new OperatorNotFoundError(input.operatorId)

    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + (this.config.ttlMs ?? INVITE_TTL_MS))
    await this.repo.create({
      email: input.email,
      operatorId: input.operatorId,
      role: input.role,
      tokenHash: sha256Hex(token),
      status: 'PENDING',
      expiresAt,
      invitedByUserId,
      acceptedByUserId: null,
    })
    this.recordAudit({
      type: 'PROVIDER_INVITE_CREATED',
      invitedByUserId,
      operatorId: input.operatorId,
      email: input.email,
    })
    const base = this.config.webBaseUrl.replace(/\/$/, '')
    return { token, inviteUrl: `${base}/provider/invite/${token}`, expiresAt }
  }

  // Public, unauthenticated invite preview for the acceptance page. Looked up by
  // hash only (never plaintext). An unknown token reveals nothing; a real invite
  // names its operator + expiry so the page can render both the live "You're
  // invited to <Operator>" and the expired/used states — `valid` gates the CTA.
  async preview(token: string): Promise<ProviderInvitePreview> {
    const invite = await this.repo.findByTokenHash(sha256Hex(token))
    if (!invite) return { valid: false }
    const operator = await this.operatorRepo.findById(invite.operatorId)
    const valid = invite.status === 'PENDING' && invite.expiresAt.getTime() > Date.now()
    return {
      valid,
      ...(operator ? { operatorName: operator.name } : {}),
      expiresAt: invite.expiresAt,
    }
  }
}
