/**
 * Operator team wire contract (#904).
 *
 * The JSON shape the operator self-service team endpoints (`/operators/me/*`)
 * return and the web team client consumes. Web cannot import the Drizzle schema
 * or the API store types, so the shapes live here, drizzle-free; the role/status
 * unions come from `@kuruma/shared/enums`.
 *
 * These are hand-written PROJECTIONS, not verbatim store rows: the invite shape
 * deliberately OMITS `tokenHash`, `invitedByUserId`, and `acceptedByUserId` (a
 * leaked team page must never disclose a token or the inviter); the member shape
 * is a membership joined to its user. The API projection functions annotate their
 * return type as these DTOs and the web schemas pin to them via
 * `satisfies z.ZodType<T>`, so a field rename fails `typecheck` on both ends.
 *
 * Dates are ISO 8601 strings (JSON has no Date).
 */

import type { OperatorMembershipStatus, OperatorRole, ProviderInviteStatus } from '../enums'

/** A pending staff invite an operator owner can see (and, in slice 2, revoke). */
export interface OperatorInviteData {
  id: string
  email: string
  role: OperatorRole
  status: ProviderInviteStatus
  /** ISO 8601 (UTC). Invite expiry. */
  expiresAt: string
  /** ISO 8601 (UTC). When the invite was sent. */
  createdAt: string
}

/** An active operator member (owner or staff), joined to its user identity. */
export interface OperatorMemberData {
  /** The membership id (not the user id) — the handle for slice-2 deactivate. */
  id: string
  userId: string
  name: string | null
  email: string | null
  role: OperatorRole
  status: OperatorMembershipStatus
  /** ISO 8601 (UTC). When the member joined (membership creation). */
  joinedAt: string
}
