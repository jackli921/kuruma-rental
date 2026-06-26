// Notification-log persistence contract (#393 Slice 7, #483): the SENDING-lease
// and delivery-cap consts plus the data-access interface. Extracted from ./types
// to keep that barrel under the file-size cap (#837); re-exported there so callers
// keep importing from ../types.
import type { CallerContext } from '../middleware/auth'
import type { NotificationLog } from '../stores'

/**
 * Slice 7 (#393): how long a SENDING lease is honoured before another sender may
 * reclaim the row (§3). A crash mid-send leaves a SENDING row that is reclaimable
 * ONLY after this window — a live lease is never reclaimed (else double-send).
 */
export const SEND_LEASE_MS = 5 * 60 * 1000

/**
 * #483: after this many delivery attempts a notification is marked terminal DEAD
 * instead of FAILED. The claim predicate reclaims QUEUED / FAILED / expired
 * SENDING but NEVER DEAD — so a permanently-bad recipient (hard bounce, malformed
 * address) stops being re-sent on every booking replay and operator resend. The
 * cap counts the attempt being recorded: markFailed sees the already-incremented
 * `attempts` (claim bumped it) and flips to DEAD when `attempts >= cap`.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 5

export interface NotificationLogUpsert {
  bookingId: string
  operatorId: string
  kind: NotificationLog['kind']
  recipient: string
  locale: string
  idempotencyKey: string
}

// #681: a no-recipient skip has no resolved address or locale — only the keys.
export type NotificationLogNoRecipient = Omit<NotificationLogUpsert, 'recipient' | 'locale'>

export interface NotificationLogFilters {
  bookingId?: string
  operatorId?: string
  /**
   * Explicit platform-wide read (#1107). Set by the bypass-role route layer
   * (from `?includeAll=true`) and by the in-memory storefront double (the public
   * marketplace catalog is an explicit cross-operator read). A bypass caller
   * with NEITHER `operatorId` nor this flag reads nothing — the safe default
   * lives in the repo, so a forgotten route guard can no longer leak every
   * tenant's private config.
   */
  includeAllOperators?: boolean
}

export interface NotificationLogRepository {
  // Insert a QUEUED row keyed by idempotencyKey. If a row already exists (a
  // post-commit replay), return it UNCHANGED — the unique key seals one row per
  // (booking, kind), so a replay never creates a duplicate to double-send.
  upsertQueued(data: NotificationLogUpsert): Promise<NotificationLog>
  // #681: record a terminal NO_RECIPIENT row when no email resolves; idempotent
  // on its own key so it never blocks a later real send under the bare key.
  recordNoRecipient(data: NotificationLogNoRecipient): Promise<NotificationLog>
  // Atomic lease claim (§3): flips QUEUED / FAILED / an EXPIRED SENDING to
  // SENDING and bumps attempts, returning the row. Returns undefined when a LIVE
  // SENDING lease holds it — the concurrent-send guard. Unscoped (keyed by id;
  // the resend route scopes via findById first).
  claim(id: string): Promise<NotificationLog | undefined>
  markSent(id: string, providerMessageId: string): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  // Operator-portal list (management-read guarded, operator-scoped).
  findAll(ctx: CallerContext, filters?: NotificationLogFilters): Promise<NotificationLog[]>
  // Scoped single read (resend route: cross-operator id -> undefined -> 404).
  findById(ctx: CallerContext, id: string): Promise<NotificationLog | undefined>
}
