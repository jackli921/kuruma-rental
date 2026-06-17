import { users } from '@kuruma/shared/db/schema'
import { and, eq, ilike, inArray, or } from 'drizzle-orm'
import type { User } from '../../stores'
import type { UserRepository } from '../types'
import type { Db } from './shared'

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  language: users.language,
  country: users.country,
  role: users.role,
}

const PLACEHOLDER_EMAIL_SUFFIX = '@placeholder.kuruma.local'

// Auth.js requires users.email NOT NULL, so phone-only customers need a synthetic email.
// The sentinel is never surfaced to API callers — the repo maps it back to null on read.
function maskPlaceholderEmail<T extends { email: string | null }>(row: T): T {
  if (row.email?.endsWith(PLACEHOLDER_EMAIL_SUFFIX)) {
    return { ...row, email: null }
  }
  return row
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []
    const rows = await this.db.select(userColumns).from(users).where(inArray(users.id, ids))
    return rows.map(maskPlaceholderEmail) as User[]
  }

  async search(query: string): Promise<User[]> {
    const pattern = `%${query}%`
    const rows = await this.db
      .select(userColumns)
      .from(users)
      .where(
        and(
          eq(users.role, 'RENTER'),
          or(
            ilike(users.name, pattern),
            ilike(users.email, pattern),
            ilike(users.phone, pattern),
          ),
        ),
      )
      .limit(20)
    return rows.map(maskPlaceholderEmail) as User[]
  }

  async quickCreate(data: {
    name: string
    email: string | null
    phone: string | null
    language: string
  }): Promise<User> {
    // Insert with ON CONFLICT for email AND phone so concurrent walk-in requests
    // with the same contact info resolve to the same row instead of duplicating.
    // The placeholder email is only used when caller supplied no email.
    const insertEmail = data.email
      ? data.email.toLowerCase()
      : `phone-${crypto.randomUUID()}${PLACEHOLDER_EMAIL_SUFFIX}`

    const [inserted] = await this.db
      .insert(users)
      .values({
        name: data.name,
        email: insertEmail,
        phone: data.phone,
        language: data.language,
      })
      .onConflictDoNothing()
      .returning(userColumns)

    if (inserted) return maskPlaceholderEmail(inserted) as User

    // Conflict happened — fetch the existing row by whichever field caused it.
    const existing = data.email
      ? await this.findByEmail(data.email)
      : data.phone
        ? await this.findByPhone(data.phone)
        : undefined

    if (!existing) {
      throw new Error('quickCreate: insert conflicted but existing row not found')
    }
    return existing
  }

  async createWalkInRenter(data: { name: string; phone: string }): Promise<User> {
    // #589 1c: ALWAYS a fresh renter — never dedup by phone, so an operator can't
    // attach a booking to (or probe the existence of) another tenant's customer
    // (#396/#475). The placeholder email is random (never collides → no
    // ON CONFLICT path); phone is stored as-is (not a unique column); role
    // defaults to RENTER so the customer is findable in the operator's later
    // scoped search (#589 1a).
    const [inserted] = await this.db
      .insert(users)
      .values({
        name: data.name,
        email: `walkin-${crypto.randomUUID()}${PLACEHOLDER_EMAIL_SUFFIX}`,
        phone: data.phone,
        language: 'en',
      })
      .returning(userColumns)
    if (!inserted) {
      throw new Error('createWalkInRenter: insert returned no row')
    }
    return maskPlaceholderEmail(inserted) as User
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.db
      .select(userColumns)
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)
    return row ? (maskPlaceholderEmail(row) as User) : undefined
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    const [row] = await this.db
      .select(userColumns)
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1)
    return row ? (maskPlaceholderEmail(row) as User) : undefined
  }

  // #521 §6: the operator-grant projection write. Runs tx-bound inside the grant
  // transaction (membership INSERT first is the race fence). The OperatorRole
  // subset maps 1:1 onto the `role` enum, so no widening cast is needed.
  async setOperatorAccess(
    userId: string,
    access: { role: 'OPERATOR_OWNER' | 'OPERATOR_STAFF'; operatorId: string },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ role: access.role, operatorId: access.operatorId, updatedAt: new Date() })
      .where(eq(users.id, userId))
  }

  // #904 slice 2: tear the operator projection back down on deactivate. Sets the
  // FK column null (not a dangling operatorId) and the role to RENTER so the next
  // renter-door sign-in mints a plain renter session, not a stale operator one.
  async clearOperatorAccess(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ role: 'RENTER', operatorId: null, updatedAt: new Date() })
      .where(eq(users.id, userId))
  }
}
