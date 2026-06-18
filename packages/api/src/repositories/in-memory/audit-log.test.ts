import { describe, expect, it } from 'vitest'
import type { AuditLogEntry } from '../types'
import { InMemoryAuditLogRepository } from './audit-log'

function newEntry(overrides: Partial<Omit<AuditLogEntry, 'id' | 'createdAt'>> = {}) {
  return {
    kind: 'OPERATOR_PROFILE_UPDATED' as const,
    actorUserId: 'user-owner',
    operatorId: 'op-1',
    targetId: null,
    field: 'preAuthHandoffUrl',
    oldValue: 'https://old.example',
    newValue: 'https://new.example',
    ...overrides,
  }
}

describe('InMemoryAuditLogRepository', () => {
  it('persists a row, assigning id + createdAt and preserving the diff fields', async () => {
    const repo = new InMemoryAuditLogRepository()
    const saved = await repo.insert(newEntry())

    expect(saved.id).toMatch(/[0-9a-f-]{36}/)
    expect(saved.createdAt).toBeInstanceOf(Date)
    expect(saved.kind).toBe('OPERATOR_PROFILE_UPDATED')
    expect(saved.actorUserId).toBe('user-owner')
    expect(saved.operatorId).toBe('op-1')
    expect(saved.field).toBe('preAuthHandoffUrl')
    expect(saved.oldValue).toBe('https://old.example')
    expect(saved.newValue).toBe('https://new.example')
  })

  it('passes nullable scope/diff fields through unchanged', async () => {
    const repo = new InMemoryAuditLogRepository()
    const saved = await repo.insert(
      newEntry({
        kind: 'PROVIDER_INVITE_CREATED',
        targetId: 'invitee@example.com',
        operatorId: 'op-9',
        field: null,
        oldValue: null,
        newValue: null,
      }),
    )

    expect(saved.kind).toBe('PROVIDER_INVITE_CREATED')
    expect(saved.targetId).toBe('invitee@example.com')
    expect(saved.field).toBeNull()
    expect(saved.oldValue).toBeNull()
    expect(saved.newValue).toBeNull()
  })

  it('assigns a distinct id per insert (append-only, no dedup)', async () => {
    const repo = new InMemoryAuditLogRepository()
    const a = await repo.insert(newEntry())
    const b = await repo.insert(newEntry())

    expect(a.id).not.toBe(b.id)
  })

  it('shares state through an injected store (composition-root wiring)', async () => {
    const store = new Map<string, AuditLogEntry>()
    const repo = new InMemoryAuditLogRepository(store)
    const saved = await repo.insert(newEntry())

    expect(store.get(saved.id)).toEqual(saved)
  })
})
