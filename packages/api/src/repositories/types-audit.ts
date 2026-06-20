// Audit-log persistence contract (#930): the durable append-only audit ledger's
// data-access interface. Extracted from ./types to keep that barrel under the
// file-size cap (#837); re-exported there so callers keep importing from ../types.
import type { AuditLogEntry } from '../stores'

export type { AuditLogEntry }

// Insert-only: the audit ledger is append-only by design (see db/audit.ts), so no
// update/delete/read surface exists yet; reads (a tenant's own trail) arrive with
// the consuming feature.
export interface AuditLogRepository {
  insert(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry>
}
