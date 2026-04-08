import { auth } from '@/auth'
import { classifyRoute, getLocaleFromPath, stripLocale } from '@/lib/route-helpers'
import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import { routing } from './i18n/routing'

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

  // Redirect non-business users away from business paths
  if (route.type === 'business' && session) {
    const role = (session.user as { role?: string }).role
    if (!role || !BUSINESS_ROLES.has(role)) {
      return NextResponse.redirect(new URL(`/${locale}`, req.url))
    }
  }

  return intlMiddleware(req)
})

export const config = {
  matcher: ['/', '/(en|ja|zh)/:path*'],
}
