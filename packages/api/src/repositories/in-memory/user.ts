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
}
