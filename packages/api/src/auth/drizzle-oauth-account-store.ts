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
import { emailVerifiedAt } from './email-verification'
import type { GoogleProfile, OAuthAccountStore } from './google'

// Derived from the canonical connection factory (same as repositories/drizzle's
// `Db`), kept local so the auth adapter doesn't import a repository module.
type Db = ReturnType<typeof getDb>

const GOOGLE_PROVIDER = 'google'

export class DrizzleOAuthAccountStore implements OAuthAccountStore {
  private readonly adapter: ReturnType<typeof DrizzleAdapter>

  constructor(
    private readonly db: Db,
    // Defaulted, but injectable so the concurrent first-login race path can be
    // unit-tested without a live Postgres.
    adapter: ReturnType<typeof DrizzleAdapter> = DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
    }),
  ) {
    this.adapter = adapter
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
      // Record Google's email_verified claim (was hard-coded null) so the stored
      // row reflects whether the email was actually verified — a signal the
      // provider-grant path already trusts on the live claim (#auth-review).
      const created = await createUser({
        id: crypto.randomUUID(),
        email: profile.email ?? '',
        emailVerified: emailVerifiedAt(profile.email_verified, new Date()),
        name: profile.name ?? null,
        image: profile.picture ?? null,
      })
      try {
        await linkAccount({
          userId: created.id,
          type: 'oidc',
          provider: GOOGLE_PROVIDER,
          providerAccountId: profile.sub,
        })
        userId = created.id
      } catch (err) {
        // A concurrent first-login for the same Google account won the race and
        // already linked it: the accounts PK is (provider, providerAccountId), so
        // our linkAccount hit a unique violation. Re-resolve to the winner and
        // drop the orphan user our createUser left behind, so the race yields one
        // user + a successful login instead of a duplicate + a failed callback.
        // (A db.transaction() can't fence this — neon-http can't run interactive
        // transactions on Workers, #493 — so the unique index is the race fence.)
        const winner = await getUserByAccount({
          provider: GOOGLE_PROVIDER,
          providerAccountId: profile.sub,
        })
        if (!winner) throw err
        await this.db.delete(users).where(eq(users.id, created.id))
        userId = winner.id
      }
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
