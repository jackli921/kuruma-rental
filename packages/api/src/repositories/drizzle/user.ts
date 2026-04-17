import { users } from '@kuruma/shared/db/schema'
import { eq, ilike, inArray, or } from 'drizzle-orm'
import type { User } from '../../stores'
import type { UserRepository } from '../types'
import type { Db } from './shared'

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  language: users.language,
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

  async search(query: string): Promise<User[]> {
    const pattern = `%${query}%`
    const rows = await this.db
      .select(userColumns)
      .from(users)
      .where(
        or(
          ilike(users.name, pattern),
          ilike(users.email, pattern),
          ilike(users.phone, pattern),
        ),
      )
      .limit(20)
    return rows as User[]
  }

  async quickCreate(data: {
    name: string
    email: string | null
    phone: string | null
    language: string
  }): Promise<User> {
    const [row] = await this.db
      .insert(users)
      .values({
        name: data.name,
        email: data.email ?? `phone-${crypto.randomUUID()}@placeholder.kuruma.local`,
        phone: data.phone,
        language: data.language,
      })
      .returning(userColumns)
    return row as User
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.db
      .select(userColumns)
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    return row as User | undefined
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    const [row] = await this.db
      .select(userColumns)
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1)
    return row as User | undefined
  }
}
