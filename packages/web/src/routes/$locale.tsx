import { LayoutPreferenceProvider } from '@/vite/LayoutPreferenceProvider'
import { ViewModeProvider } from '@/vite/ViewModeProvider'
import { CurrencyProvider } from '@/vite/currency'
import { isLocale } from '@/vite/i18n/locale'
import { messagesQueryOptions } from '@/vite/i18n/messages'
import { Navbar } from '@/vite/nav/Navbar'
import { Outlet, createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect } from 'react'
import { IntlProvider } from 'use-intl'

// Locale layout (spec §4.2). Validates the param (invalid -> 404) and prefetches
// the locale's messages so navigation is held until they resolve — no FOUC (§4.5).
export const Route = createFileRoute('/$locale')({
  loader: ({ context, params }) => {
    const { locale } = params
    if (!isLocale(locale)) throw notFound()
    return context.queryClient.ensureQueryData(messagesQueryOptions(locale))
  },
  component: LocaleLayout,
})

function LocaleLayout() {
  const { locale } = Route.useParams()
  const messages = Route.useLoaderData()

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <IntlProvider locale={locale} messages={messages}>
      <CurrencyProvider>
        <ViewModeProvider>
          <LayoutPreferenceProvider>
            <Navbar />
            <Outlet />
          </LayoutPreferenceProvider>
        </ViewModeProvider>
      </CurrencyProvider>
    </IntlProvider>
  )
}
