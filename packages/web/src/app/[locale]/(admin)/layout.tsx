import { auth } from '@/auth'
import { AdminSidebar } from '@/components/nav/AdminSidebar'
import { routing } from '@/i18n/routing'
import { isPlatformAdmin } from '@/lib/platform-roles'
import { redirect } from 'next/navigation'

export default async function AdminLayout({
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

  if (!isPlatformAdmin(session.user.role)) {
    redirect(`/${safeLocale}`)
  }

  return (
    <div className="flex flex-1">
      <AdminSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
