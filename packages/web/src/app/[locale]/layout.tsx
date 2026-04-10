import '@/app/globals.css'
import { Navbar } from '@/components/nav/Navbar'
import { Providers } from '@/components/providers'
import { routing } from '@/i18n/routing'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  const messages = await getMessages()

  return (
    <div lang={locale} className="min-h-dvh flex flex-col">
      <NextIntlClientProvider messages={messages}>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </NextIntlClientProvider>
    </div>
  )
}
