import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { getDb } from '@kuruma/shared/db'
import { accounts, users } from '@kuruma/shared/db/schema'
import NextAuth from 'next-auth'
import type { NextAuthResult } from 'next-auth'
import authConfig from './auth.config'

// Lazy initialization: NextAuth + DrizzleAdapter must be created during
// request handling on CF Workers, because getDb() needs getCloudflareContext()
// which is only available at request time, not at module load time.
let _authResult: NextAuthResult | undefined

function getAuth(): NextAuthResult {
  if (!_authResult) {
    _authResult = NextAuth({
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
  return _authResult
}

export const handlers = new Proxy({} as NextAuthResult['handlers'], {
  get(_, prop) {
    return Reflect.get(getAuth().handlers, prop)
  },
})

export function auth(...args: Parameters<NextAuthResult['auth']>) {
  return getAuth().auth(...args)
}

export function signIn(...args: Parameters<NextAuthResult['signIn']>) {
  return getAuth().signIn(...args)
}

export function signOut(...args: Parameters<NextAuthResult['signOut']>) {
  return getAuth().signOut(...args)
}
