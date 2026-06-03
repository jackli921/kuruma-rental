import type { Operator } from '../../stores'
import type { OperatorRepository } from '../types'

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

  async findSoleId(): Promise<string | null> {
    if (this.store.size !== 1) return null
    const [id] = this.store.keys()
    return id ?? null
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
}
