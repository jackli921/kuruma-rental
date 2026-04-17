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
    return [...this.store.values()].filter((u) => {
      const nameMatch = u.name?.toLowerCase().includes(lower) ?? false
      const emailMatch = u.email.toLowerCase().includes(lower)
      const phoneMatch = u.phone?.toLowerCase().includes(lower) ?? false
      return nameMatch || emailMatch || phoneMatch
    })
  }

  async quickCreate(data: {
    name: string
    email: string | null
    phone: string | null
    language: string
  }): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email ?? '',
      phone: data.phone,
      language: data.language,
    }
    this.store.set(user.id, user)
    return user
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return [...this.store.values()].find((u) => u.email === email)
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    return [...this.store.values()].find((u) => u.phone === phone)
  }
}
