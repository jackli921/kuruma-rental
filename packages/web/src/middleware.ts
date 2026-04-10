import {
  classifyRoute,
  extractSessionRole,
  getLocaleFromPath,
  stripLocale,
} from '@/lib/route-helpers'
import NextAuth from 'next-auth'
import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import authConfig from './auth.config'
import { routing } from './i18n/routing'

// Use edge-safe auth config (no Drizzle/DB imports).
// The full auth() from auth.ts imports postgres-js which is Node.js only.
// Cloudflare Workers require Edge runtime for middleware/proxy.
const { auth } = NextAuth(authConfig)

const intlMiddleware = createIntlMiddleware(routing)

const BUSINESS_ROLES = new Set(['STAFF', 'ADMIN'])

export default auth((req) => {
  const { pathname } = req.nextUrl
  const path = stripLocale(pathname)
  const locale = getLocaleFromPath(pathname)
  const session = req.auth
  const route = classifyRoute(path)

  // Redirect unauthenticated users to login
  if ((route.type === 'renter' || route.type === 'business') && !session) {
    const loginUrl = new URL(`/${locale}/login`, req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect non-business users away from business paths.
  // extractSessionRole guards against session.user being undefined, which
  // can happen on CF Workers when auth() fails silently.
  if (route.type === 'business' && session) {
    const role = extractSessionRole(session as { user?: { role?: unknown } | null })
    if (!role || !BUSINESS_ROLES.has(role)) {
      return NextResponse.redirect(new URL(`/${locale}`, req.url))
    }
  }

  return intlMiddleware(req)
})

export const config = {
  matcher: ['/', '/(en|ja|zh)/:path*'],
}
