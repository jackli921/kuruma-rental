import { users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import type { User } from '../../stores'
import type { UserRepository } from '../types'
import type { Db } from './shared'

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  language: users.language,
  country: users.country,
  role: users.role,
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select(userColumns)
      .from(users)
      .where(inArray(users.id, ids))
    return rows as User[]
  }
}
