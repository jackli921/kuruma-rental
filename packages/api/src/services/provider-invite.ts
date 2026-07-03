import type { CreateProviderInviteInput } from '@kuruma/shared/validators/provider-invite'
import { ConflictError, NotFoundError } from '../auth/guards'
import { sha256Hex } from '../auth/token-hash'
import {
  PG_ERROR,
  PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { OperatorRepository, ProviderInviteRepository } from '../repositories/types'
import { mintInvite } from './invite-mint'
import { type ProviderInviteAuditEvent, buildProviderInviteRecord } from './provider-invite-record'
// Re-export so existing importers (tests, etc.) keep working without touching their imports.
export { INVITE_TTL_MS } from './invite-mint'
export type { ProviderInviteAuditEvent }

/** Raised when an invite is minted against an operatorId with no matching row.
 *  Extends NotFoundError so the global handler maps it to 404 (#563, #1230 c1);
 *  the platform-admin team path can now supply an arbitrary operatorId, so this
 *  is reachable for the first time. The admin.ts:47 local catch is KEPT — it pins
 *  the suffix-free 'Operator not found' message provider-invites.test.ts asserts.
 *  Note: `name` is not overridden here because NotFoundError declares it as the
 *  literal type 'NotFoundError'; a subclass override would be a TS2416 type error.
 *  Identity is preserved via `instanceof OperatorNotFoundError` (the admin.ts catch)
 *  and `instanceof NotFoundError` (the global handler's 404 branch). */
export class OperatorNotFoundError extends NotFoundError {
  constructor(readonly operatorId: string) {
    super(`Operator not found: ${operatorId}`)
  }
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

    const minted = mintInvite({
      webBaseUrl: this.config.webBaseUrl,
      // exactOptionalPropertyTypes: spread only when defined, not as `ttlMs: undefined`
      ...(this.config.ttlMs !== undefined ? { ttlMs: this.config.ttlMs } : {}),
    })
    const { row, event } = buildProviderInviteRecord(minted, {
      email: input.email,
      operatorId: input.operatorId,
      role: input.role,
      invitedByUserId,
    })
    try {
      await this.repo.create(row)
    } catch (err) {
      // The owner re-invited an email that already has a live invite. The partial-
      // unique index is the race fence; translate its 23505 to a 409 ConflictError
      // (matched by name so a tokenHash collision still surfaces as the original
      // unexpected error). A revoke frees the slot, so the message points there.
      if (
        pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION &&
        pgConstraintName(err) === PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT
      ) {
        throw new ConflictError('an invite for this email is already pending; revoke it first')
      }
      throw err
    }
    this.recordAudit(event)
    return { token: minted.token, inviteUrl: minted.inviteUrl, expiresAt: minted.expiresAt }
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
