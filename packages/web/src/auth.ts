import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { getDb } from '@kuruma/shared/db'
import { accounts, users } from '@kuruma/shared/db/schema'
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
      adapter: DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
      }),
      session: { strategy: 'jwt' },
      pages: {
        signIn: '/en/login',
      },
      callbacks: {
        jwt({ token, user }) {
          if (user) {
            token.role = (user as { role?: string }).role ?? 'RENTER'
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
      ...authConfig,
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

export function auth(...args: Parameters<NextAuthResult['auth']>) {
  return getAuthResult().auth(...args)
}

export function signIn(...args: Parameters<NextAuthResult['signIn']>) {
  return getAuthResult().signIn(...args)
}

export function signOut(...args: Parameters<NextAuthResult['signOut']>) {
  return getAuthResult().signOut(...args)
}
