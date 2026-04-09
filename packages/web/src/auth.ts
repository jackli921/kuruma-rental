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
            token.role = (user as { role?: string }).role ?? 'RENTER'
          } else if (token.sub) {
            const db = getDb()
            const [dbUser] = await db
              .select({ role: users.role })
              .from(users)
              .where(eq(users.id, token.sub))
              .limit(1)
            if (dbUser) {
              token.role = dbUser.role
            }
          }
          return token
        },
        session({ session, token }) {
          if (session.user) {
            session.user.id = token.sub!
            ;(session.user as { role?: string }).role = token.role as string
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
