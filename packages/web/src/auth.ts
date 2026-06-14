// #722 carve-out: auth.ts is the sanctioned Auth.js DB toucher (Drizzle adapter +
// session lookup). lint-module-boundaries exempts it from the "web has no direct
// DB access" rule; all other web code must route through the Hono API.
import { getDb } from '@/lib/db'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { accounts, users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import NextAuth from 'next-auth'
import type { NextAuthResult } from 'next-auth'
import authConfig from './auth.config'

// Lazy singleton: NextAuth is initialized on first use, not at module scope.
// CF Workers require this because getDb() needs getCloudflareContext()
// which is only available during request handling.
let _auth: NextAuthResult | undefined

function getAuthResult(): NextAuthResult {
  if (!_auth) {
    _auth = NextAuth({
      ...authConfig,
      adapter: DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
      }),
      session: { strategy: 'jwt' },
      pages: {
        signIn: '/en/login',
      },
      callbacks: {
        async jwt({ token, user }) {
          if (user) {
            // First sign-in: populate role + tenant from the user object
            token.role = (user as { role?: string }).role ?? 'RENTER'
            token.operatorId = (user as { operatorId?: string | null }).operatorId ?? null
            token.roleRefreshedAt = Date.now()
          } else if (token.sub) {
            // Subsequent refreshes: re-fetch role from DB at most every 5 minutes
            const ROLE_REFRESH_MS = 5 * 60 * 1000
            const lastRefresh = (token.roleRefreshedAt as number) ?? 0
            if (!token.role || Date.now() - lastRefresh > ROLE_REFRESH_MS) {
              try {
                const db = getDb()
                const [dbUser] = await db
                  .select({ role: users.role, operatorId: users.operatorId })
                  .from(users)
                  .where(eq(users.id, token.sub))
                  .limit(1)
                if (dbUser) {
                  token.role = dbUser.role
                  token.operatorId = dbUser.operatorId
                }
                token.roleRefreshedAt = Date.now()
              } catch {
                // DB timeout (Neon cold start) — keep cached role, retry next request
                if (!token.role) token.role = 'RENTER'
              }
            }
          }
          return token
        },
        session({ session, token }) {
          if (session.user) {
            session.user.id = token.sub!
            ;(session.user as { role?: string }).role = token.role as string
            session.user.operatorId = token.operatorId ?? null
          }
          return session
        },
      },
    })
  }
  return _auth
}

export const handlers = {
  GET: (...args: Parameters<NextAuthResult['handlers']['GET']>) =>
    getAuthResult().handlers.GET(...args),
  POST: (...args: Parameters<NextAuthResult['handlers']['POST']>) =>
    getAuthResult().handlers.POST(...args),
}

export async function auth(): Promise<import('next-auth').Session | null> {
  const result = getAuthResult()
  // Auth.js auth() is overloaded: 0 args = get session, 1+ args = middleware.
  // We only use the 0-arg form in server components.
  return (result.auth as () => Promise<import('next-auth').Session | null>)()
}

export function signIn(...args: Parameters<NextAuthResult['signIn']>) {
  return getAuthResult().signIn(...args)
}

export function signOut(...args: Parameters<NextAuthResult['signOut']>) {
  return getAuthResult().signOut(...args)
}
