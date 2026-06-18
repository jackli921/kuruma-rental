import type { AuditLogEntry } from '../../stores'
import type { AuditLogRepository } from '../types'

// Append-only in-memory audit ledger for tests and the InMemory composition.
// No unique constraints, no update/delete — every insert is a fresh row.
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly store: Map<string, AuditLogEntry>

  constructor(store?: Map<string, AuditLogEntry>) {
    this.store = store ?? new Map()
  }

  async insert(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const row: AuditLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    }
    this.store.set(row.id, row)
    return row
  }
}
