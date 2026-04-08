import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { getDb } from '@kuruma/shared/db'
import { accounts, users } from '@kuruma/shared/db/schema'
import NextAuth from 'next-auth'
import authConfig from './auth.config'

const db = getDb()

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
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
