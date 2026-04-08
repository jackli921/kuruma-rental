import { auth } from '@/auth'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

export default auth((req) => {
  return intlMiddleware(req)
})

export const config = {
  matcher: ['/', '/(en|ja|zh)/:path*'],
}
