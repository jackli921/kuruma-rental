import { LayoutPreferenceProvider } from '@/vite/LayoutPreferenceProvider'
import { ViewModeProvider } from '@/vite/ViewModeProvider'
import { FeatureFlagsProvider } from '@/vite/config'
import { CurrencyProvider } from '@/vite/currency'
import { isLocale } from '@/vite/i18n/locale'
import { messagesQueryOptions } from '@/vite/i18n/messages'
import { Navbar } from '@/vite/nav/Navbar'
import { RouteAnnouncer } from '@/vite/nav/RouteAnnouncer'
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
      <FeatureFlagsProvider>
        <CurrencyProvider>
          <ViewModeProvider>
            <LayoutPreferenceProvider>
              <Navbar />
              {/* #1489/#1508: app-wide focus-on-navigate anchor; mounted here (a stable parent
                  that survives child route + pendingComponent swaps) so a navigation never
                  strands screen-reader focus on <body>. It WRAPS <Outlet> (not a preceding
                  sibling) so its restore effect fires AFTER any per-component restorer nested
                  inside — the announcer is the fallback, the more-specific restorer wins. */}
              <RouteAnnouncer>
                <Outlet />
              </RouteAnnouncer>
            </LayoutPreferenceProvider>
          </ViewModeProvider>
        </CurrencyProvider>
      </FeatureFlagsProvider>
    </IntlProvider>
  )
}
