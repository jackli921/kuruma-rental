import { auditLog } from '@kuruma/shared/db/schema'
import type { AuditLogEntry } from '../../stores'
import type { AuditLogRepository } from '../types'
import type { Db } from './shared'

type Row = typeof auditLog.$inferSelect

function toAuditLogEntry(r: Row): AuditLogEntry {
  return {
    id: r.id,
    kind: r.kind,
    actorUserId: r.actorUserId,
    operatorId: r.operatorId,
    targetId: r.targetId,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    createdAt: r.createdAt,
  }
}

// Insert-only: the audit ledger is append-only (see db/audit.ts). id + createdAt
// are DB defaults; everything else comes from the caller's event row.
export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Db) {}

  async insert(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const [inserted] = await this.db.insert(auditLog).values(entry).returning()
    if (!inserted) throw new Error('Failed to insert audit log entry')
    return toAuditLogEntry(inserted)
  }
}
