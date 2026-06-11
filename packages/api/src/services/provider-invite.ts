import { createHash } from 'node:crypto'
import type { CreateProviderInviteInput } from '@kuruma/shared/validators/provider-invite'
import { randomToken } from '../auth/google'
import type { ProviderInviteRepository } from '../repositories/types'

// Invites are short-lived: a leaked link is only useful for a week, and the
// recipient is expected to accept promptly during onboarding.
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class ProviderInviteService {
  constructor(
    private readonly repo: ProviderInviteRepository,
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
}
