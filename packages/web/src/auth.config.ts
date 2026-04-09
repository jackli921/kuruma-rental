import type { NextAuthConfig } from 'next-auth'
import Apple from 'next-auth/providers/apple'
import Google from 'next-auth/providers/google'

// Edge-safe auth config -- NO DB imports (Drizzle/postgres-js are Node.js only).
// Used by middleware for route protection. The full auth.ts adds the DB adapter
// and re-fetches role from DB on token refresh.
//
// These callbacks ensure the role survives from JWT token → session.user
// so the middleware can check business roles without hitting the DB.
export default {
  providers: [Google, Apple],
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
        ;(session.user as { role?: string }).role = (token.role as string) ?? 'RENTER'
      }
      return session
    },
  },
} satisfies NextAuthConfig
