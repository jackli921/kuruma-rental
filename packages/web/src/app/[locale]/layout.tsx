import '@/app/globals.css'
import { Navbar } from '@/components/nav/Navbar'
import { Providers } from '@/components/providers'
import { routing } from '@/i18n/routing'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { Geist, Geist_Mono } from 'next/font/google'
import { notFound } from 'next/navigation'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

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
    <div
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased font-sans`}
    >
      <NextIntlClientProvider messages={messages}>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </NextIntlClientProvider>
    </div>
  )
}
