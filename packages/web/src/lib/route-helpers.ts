const LOCALES = new Set(['en', 'ja', 'zh'])
const DEFAULT_LOCALE = 'en'

const RENTER_PATHS = ['/bookings', '/messages']
const BUSINESS_PATHS = ['/dashboard', '/manage/']

type RouteClassification = { type: 'public' } | { type: 'renter' } | { type: 'business' }

export function stripLocale(pathname: string): string {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  if (maybeLocale && LOCALES.has(maybeLocale)) {
    const rest = segments.slice(2).join('/')
    return rest ? `/${rest}` : '/'
  }
  return pathname
}

export function getLocaleFromPath(pathname: string): string {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  if (maybeLocale && LOCALES.has(maybeLocale)) {
    return maybeLocale
  }
  return DEFAULT_LOCALE
}

export function classifyRoute(path: string): RouteClassification {
  if (BUSINESS_PATHS.some((p) => path.startsWith(p))) {
    return { type: 'business' }
  }
  if (RENTER_PATHS.some((p) => path.startsWith(p))) {
    return { type: 'renter' }
  }
  return { type: 'public' }
}
