import type { ProviderInvite } from '../stores'
import type { MintedInvite } from './invite-mint'

// The audit event raised whenever an OWNER/team invite is minted. Its home is here
// (not provider-invite.ts) so the invite row and its paired audit event are defined
// together and cannot drift; provider-invite.ts re-exports it for existing importers.
export interface ProviderInviteAuditEvent {
  readonly type: 'PROVIDER_INVITE_CREATED'
  readonly invitedByUserId: string
  readonly operatorId: string
  readonly email: string
}

// The persisted invite row (repository create input).
type ProviderInviteRow = Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>

export interface ProviderInviteRecordInput {
  readonly email: string
  readonly operatorId: string
  readonly role: ProviderInviteRow['role']
  readonly invitedByUserId: string
}

/**
 * Single source for the "mint an invite" unit: the PENDING row to persist AND the
 * PROVIDER_INVITE_CREATED audit event that must accompany it. Both the provider-invite
 * service and the operator-approval tx build the invite through here so the row shape
 * and its audit pairing stay in lockstep. Pure — the caller decides when to persist
 * and emit (immediately, or after a transaction commit).
 */
export function buildProviderInviteRecord(
  minted: MintedInvite,
  input: ProviderInviteRecordInput,
): { readonly row: ProviderInviteRow; readonly event: ProviderInviteAuditEvent } {
  return {
    row: {
      email: input.email,
      operatorId: input.operatorId,
      role: input.role,
      tokenHash: minted.tokenHash,
      status: 'PENDING',
      expiresAt: minted.expiresAt,
      invitedByUserId: input.invitedByUserId,
      acceptedByUserId: null,
    },
    event: {
      type: 'PROVIDER_INVITE_CREATED',
      invitedByUserId: input.invitedByUserId,
      operatorId: input.operatorId,
      email: input.email,
    },
  }
}
