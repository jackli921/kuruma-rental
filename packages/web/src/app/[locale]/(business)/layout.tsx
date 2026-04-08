import { auth } from '@/auth'
import { BusinessSidebar } from '@/components/nav/BusinessSidebar'
import { routing } from '@/i18n/routing'
import { redirect } from 'next/navigation'

const BUSINESS_ROLES = new Set(['STAFF', 'ADMIN'])

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const [session, { locale }] = await Promise.all([auth(), params])
  const safeLocale = routing.locales.includes(locale as 'en' | 'ja' | 'zh')
    ? locale
    : routing.defaultLocale

  if (!session?.user) {
    redirect(`/${safeLocale}/login`)
  }

  const role = session.user.role
  if (!BUSINESS_ROLES.has(role)) {
    redirect(`/${safeLocale}`)
  }

  return (
    <div className="flex flex-1">
      <BusinessSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
