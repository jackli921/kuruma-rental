import type {
  ConsentGovernanceFilters,
  ConsentGovernanceResponse,
} from '@kuruma/shared/types/consent-governance'
import { type CallerContext, requirePlatformAdmin } from '../middleware/auth'
import type { ConsentAcceptanceQuery, ConsentRepository } from '../repositories/types'

/**
 * Platform-admin consent-acceptance governance browser (#1091, epic #1075 slice 5).
 *
 * Imperative shell over the append-only `consent_acceptances` ledger: it re-asserts
 * `requirePlatformAdmin` (defence-in-depth — the gate travels with the business
 * logic, since the consent repo's reads are unscoped), converts the validated
 * string filters into a typed repo query, and projects the rows onto the wire DTO.
 *
 * v1 is READ-ONLY: no computed `current | outdated | missing` status (that needs a
 * subject cohort + current-document baseline and is a later slice) and no re-consent
 * action. Each row carries the `acceptanceId` linking to the existing evidence
 * export (#877) — this service never re-implements proof logic.
 */
export class ConsentGovernanceService {
  constructor(private readonly consent: ConsentRepository) {}

  async list(
    ctx: CallerContext,
    filters: ConsentGovernanceFilters,
  ): Promise<ConsentGovernanceResponse> {
    requirePlatformAdmin(ctx)
    const rows = await this.consent.findAcceptances(toQuery(filters))
    return {
      acceptances: rows.map((r) => ({
        acceptanceId: r.id,
        userId: r.userId,
        consentType: r.consentType,
        version: r.version,
        acceptedAt: r.acceptedAt.toISOString(),
        operatorId: r.operatorId,
        bookingId: r.bookingId,
      })),
    }
  }
}

/** Validated wire filters (strings) -> typed repo query. Only present keys are set
 *  so `exactOptionalPropertyTypes` never sees an explicit `undefined`. */
function toQuery(f: ConsentGovernanceFilters): ConsentAcceptanceQuery {
  const q: ConsentAcceptanceQuery = {}
  if (f.userId !== undefined) q.userId = f.userId
  if (f.consentType !== undefined) q.consentType = f.consentType
  if (f.version !== undefined) q.version = f.version
  if (f.acceptedFrom !== undefined) q.acceptedFrom = new Date(f.acceptedFrom)
  if (f.acceptedTo !== undefined) q.acceptedTo = new Date(f.acceptedTo)
  return q
}
