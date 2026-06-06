// Concrete OAuthAccountStore backed by the same `users`/`accounts` tables Auth.js
// uses, via @auth/drizzle-adapter — so a renter who signed in through the old web
// app maps to the SAME row (compat). Infra adapter (like a Drizzle repository):
// it may import the adapter, schema, and drizzle-orm directly; only `db` is
// injected from index.ts (composition root). Not unit-tested — the manual
// round-trip (#378 Phase 2d) is the proof; the seam tests cover the wiring.

import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { getDb } from '@kuruma/shared/db'
import { accounts, users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import type { UserRole } from '../middleware/auth'
import type { GoogleProfile, OAuthAccountStore } from './google'

// Derived from the canonical connection factory (same as repositories/drizzle's
// `Db`), kept local so the auth adapter doesn't import a repository module.
type Db = ReturnType<typeof getDb>

const GOOGLE_PROVIDER = 'google'

export class DrizzleOAuthAccountStore implements OAuthAccountStore {
  private readonly adapter: ReturnType<typeof DrizzleAdapter>

  constructor(private readonly db: Db) {
    this.adapter = DrizzleAdapter(db, { usersTable: users, accountsTable: accounts })
  }

  async resolveUser(
    profile: GoogleProfile,
  ): Promise<{ id: string; role: UserRole; operatorId?: string }> {
    // Adapter methods are optional in the Auth.js type; DrizzleAdapter always
    // provides them. Guard once so the calls below need no non-null assertions.
    const { getUserByAccount, createUser, linkAccount } = this.adapter
    if (!getUserByAccount || !createUser || !linkAccount) {
      throw new Error('DrizzleAdapter is missing required account methods')
    }

    const existing = await getUserByAccount({
      provider: GOOGLE_PROVIDER,
      providerAccountId: profile.sub,
    })

    let userId: string
    if (existing) {
      userId = existing.id
    } else {
      // createUser writes role=RENTER + operatorId=NULL via the schema defaults.
      // emailVerified=null: Google's email_verified isn't consumed here.
      const created = await createUser({
        id: crypto.randomUUID(),
        email: profile.email ?? '',
        emailVerified: null,
        name: profile.name ?? null,
        image: profile.picture ?? null,
      })
      await linkAccount({
        userId: created.id,
        type: 'oidc',
        provider: GOOGLE_PROVIDER,
        providerAccountId: profile.sub,
      })
      userId = created.id
    }

    // The adapter's AdapterUser carries no role/operatorId — re-select the
    // app-specific fields the session JWT needs.
    const [row] = await this.db
      .select({ role: users.role, operatorId: users.operatorId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const role: UserRole = row?.role ?? 'RENTER'
    // exactOptionalPropertyTypes: attach operatorId only when present.
    return row?.operatorId != null
      ? { id: userId, role, operatorId: row.operatorId }
      : { id: userId, role }
  }
}
