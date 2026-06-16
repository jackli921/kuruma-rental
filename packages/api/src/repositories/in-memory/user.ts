import type { User } from '../../stores'
import type { UserRepository } from '../types'

export class InMemoryUserRepository implements UserRepository {
  private readonly store: Map<string, User>

  constructor(store?: Map<string, User>) {
    this.store = store ?? new Map()
  }

  async findByIds(ids: string[]): Promise<User[]> {
    return ids.flatMap((id) => {
      const u = this.store.get(id)
      return u ? [u] : []
    })
  }

  async search(query: string): Promise<User[]> {
    const lower = query.toLowerCase()
    return [...this.store.values()]
      .filter((u) => (u.role ?? 'RENTER') === 'RENTER')
      .filter((u) => {
        const nameMatch = u.name?.toLowerCase().includes(lower) ?? false
        const emailMatch = u.email?.toLowerCase().includes(lower) ?? false
        const phoneMatch = u.phone?.toLowerCase().includes(lower) ?? false
        return nameMatch || emailMatch || phoneMatch
      })
      .slice(0, 20)
  }

  async quickCreate(data: {
    name: string
    email: string | null
    phone: string | null
    language: string
  }): Promise<User> {
    // Idempotency at the repo level for the in-memory impl — mirrors the
    // ON CONFLICT guarantee of the Drizzle impl so concurrent calls with the
    // same email/phone resolve to the same row.
    if (data.email) {
      const existing = await this.findByEmail(data.email)
      if (existing) return existing
    }
    if (data.phone) {
      const existing = await this.findByPhone(data.phone)
      if (existing) return existing
    }

    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email?.toLowerCase() ?? null,
      phone: data.phone,
      language: data.language,
      country: null,
      role: 'RENTER',
    }
    this.store.set(user.id, user)
    return user
  }

  async createWalkInRenter(data: { name: string; phone: string }): Promise<User> {
    // #589 1c: ALWAYS a fresh renter — never dedup (mirrors the Drizzle impl's
    // random-placeholder-email insert). See UserRepository for the security note.
    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: null,
      phone: data.phone,
      language: 'en',
      country: null,
      role: 'RENTER',
    }
    this.store.set(user.id, user)
    return user
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const target = email.toLowerCase()
    return [...this.store.values()].find((u) => u.email?.toLowerCase() === target)
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    return [...this.store.values()].find((u) => u.phone === phone)
  }

  async setOperatorAccess(
    userId: string,
    access: { role: 'OPERATOR_OWNER' | 'OPERATOR_STAFF'; operatorId: string },
  ): Promise<void> {
    const user = this.store.get(userId)
    if (!user) return
    this.store.set(userId, { ...user, role: access.role, operatorId: access.operatorId })
  }
}
