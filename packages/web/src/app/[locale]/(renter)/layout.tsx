import { auth } from '@/auth'
import { routing } from '@/i18n/routing'
import { redirect } from 'next/navigation'

export default async function RenterLayout({
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

  if (!session) {
    redirect(`/${safeLocale}/login`)
  }

  return <>{children}</>
}
