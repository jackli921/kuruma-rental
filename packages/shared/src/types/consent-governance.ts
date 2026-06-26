import { z } from 'zod'
import { CONSENT_TYPES, type ConsentType } from '../enums'

/**
 * Platform-admin consent-acceptance governance browser (#1091, epic #1075 slice 5).
 *
 * v1 is a READ-ONLY ledger browse + filter. `consent_acceptances` is append-only
 * with no status column, so the computed `current | outdated | missing` compliance
 * projection (which needs a defined subject cohort + current-document baseline) is
 * deliberately DEFERRED to a later slice — there is no status field on this wire.
 * Each row carries the `acceptanceId` that links to the existing evidence export
 * (`GET /admin/consent/acceptances/:id/evidence`, #877); the list never
 * re-implements proof logic.
 */

/** One acceptance-ledger row, joined to its document for the version label. */
export interface ConsentAcceptanceListItem {
  /** PK of the `consent_acceptances` row — the evidence-export link target. */
  acceptanceId: string
  /** Subject who accepted (the user the acceptance was sealed for). */
  userId: string
  consentType: ConsentType
  /** Version of the document the subject accepted (the join target). */
  version: string
  /** ISO-8601 UTC instant the acceptance was sealed. */
  acceptedAt: string
  /** Tenant the agreement binds — set only for `OPERATOR_AGREEMENT` rows. */
  operatorId: string | null
  /** Booking the liability waiver covers — set only for `RENTER_LIABILITY` rows. */
  bookingId: string | null
}

/** The list response. No pagination/status in v1 — a flat, newest-first ledger. */
export interface ConsentGovernanceResponse {
  /** Matching acceptances, newest accepted first. */
  acceptances: ConsentAcceptanceListItem[]
}

/**
 * Query filters for the ledger browse. Every field is optional (an empty filter
 * returns the whole ledger). `acceptedFrom`/`acceptedTo` are ISO-8601 instants;
 * the server inclusively bounds `acceptedAt` by them. Anchors `consentType` to the
 * enum SSoT so the parse can't drift from the DB pgEnum.
 */
export const consentGovernanceFiltersSchema = z.object({
  userId: z.string().min(1).optional(),
  consentType: z.enum(CONSENT_TYPES).optional(),
  version: z.string().min(1).optional(),
  acceptedFrom: z.string().datetime().optional(),
  acceptedTo: z.string().datetime().optional(),
})

export type ConsentGovernanceFilters = z.infer<typeof consentGovernanceFiltersSchema>
