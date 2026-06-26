import type { Operator } from '../../stores'
import type { OperatorRepository, OperatorUpdatePatch } from '../types'

export class InMemoryOperatorRepository implements OperatorRepository {
  private readonly store: Map<string, Operator>

  constructor(store?: Map<string, Operator>) {
    this.store = store ?? new Map()
  }

  async existsBySlug(slug: string): Promise<boolean> {
    for (const op of this.store.values()) {
      if (op.slug === slug) return true
    }
    return false
  }

  async list(): Promise<Operator[]> {
    return [...this.store.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  // #1087: platform-overview COUNT(operators). TODO(#1088): filter active once
  // the deactivatedAt column lands.
  async count(): Promise<number> {
    return this.store.size
  }

  async findById(id: string): Promise<Operator | undefined> {
    return this.store.get(id)
  }

  async findBySlug(slug: string): Promise<Operator | undefined> {
    for (const op of this.store.values()) {
      if (op.slug === slug) return op
    }
    return undefined
  }

  async create(data: {
    name: string
    slug: string
    preAuthHandoffUrl: string | null
  }): Promise<Operator> {
    const now = new Date()
    const operator: Operator = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(operator.id, operator)
    return operator
  }

  async update(id: string, patch: OperatorUpdatePatch): Promise<Operator | undefined> {
    const existing = this.store.get(id)
    if (!existing) return undefined
    // New object, never a mutation of the stored row (mirrors the immutability
    // a Drizzle `UPDATE ... RETURNING` gives). Spreading `patch` only overwrites
    // the keys present, so an absent field is left at its existing value.
    const updated: Operator = { ...existing, ...patch }
    this.store.set(id, updated)
    return updated
  }
}
