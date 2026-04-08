import { auth } from '@/auth'
import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

const LOCALES = new Set(routing.locales)

/** Paths requiring any authenticated user (renter, staff, admin) */
const RENTER_PATHS = ['/bookings', '/messages']

/** Paths requiring STAFF or ADMIN role */
const BUSINESS_PATHS = ['/dashboard', '/customers']

const BUSINESS_ROLES = new Set(['STAFF', 'ADMIN'])

function stripLocale(pathname: string): string {
  const segments = pathname.split('/')
  if (segments.length > 1 && LOCALES.has(segments[1] as 'en' | 'ja' | 'zh')) {
    return `/${segments.slice(2).join('/')}`
  }
  return pathname
}

function getLocaleFromPath(pathname: string): string {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  if (maybeLocale && LOCALES.has(maybeLocale as 'en' | 'ja' | 'zh')) {
    return maybeLocale
  }
  return routing.defaultLocale
}

export default auth((req) => {
  const { pathname } = req.nextUrl
  const path = stripLocale(pathname)
  const locale = getLocaleFromPath(pathname)
  const session = req.auth

  const isRenterPath = RENTER_PATHS.some((p) => path.startsWith(p))
  const isBusinessPath = BUSINESS_PATHS.some((p) => path.startsWith(p))

  // Redirect unauthenticated users to login
  if ((isRenterPath || isBusinessPath) && !session) {
    const loginUrl = new URL(`/${locale}/login`, req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect non-business users away from business paths
  if (isBusinessPath && session) {
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
