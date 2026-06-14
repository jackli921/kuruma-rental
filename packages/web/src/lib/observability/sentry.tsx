import * as Sentry from '@sentry/react'
import type { ReactNode } from 'react'
import {
  type BrowserSentryEnv,
  type ResolvedSentryOptions,
  resolveBrowserSentryOptions,
} from './sentry-options'

/**
 * Browser Sentry init (#765, web slice of #361). Thin shell over the pure
 * `resolveBrowserSentryOptions` so the gating logic stays unit-testable.
 *
 * When no `VITE_SENTRY_DSN` is set we skip `Sentry.init` entirely — a true
 * no-op for local dev / CI / DSN-less builds. Returns the resolved options so
 * callers (and tests) can observe the gate without a live client.
 */
export function initBrowserSentry(env: BrowserSentryEnv | undefined): ResolvedSentryOptions {
  const options = resolveBrowserSentryOptions(env)
  if (!options.enabled) return options
  Sentry.init({
    dsn: options.dsn,
    enabled: true,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    sendDefaultPii: options.sendDefaultPii,
  })
  return options
}

/**
 * Reports a route-level error to Sentry. TanStack Router catches loader/render
 * throws in its own error boundaries (route `errorComponent`s), so they never
 * propagate to the React `SentryErrorBoundary` at the router root. Wiring this
 * as the router's `defaultOnCatch` is the seam that captures them (#765). The
 * SDK no-ops when Sentry is disabled (no DSN).
 */
export function captureRouteError(error: Error) {
  Sentry.captureException(error)
}

/**
 * Minimal crash fallback rendered when the React tree throws above the router.
 * Inline-styled (no Tailwind/i18n dependency) so it still renders if CSS or the
 * locale provider is what failed. `Sentry.ErrorBoundary` reports the error to
 * Sentry when initialised and no-ops otherwise.
 */
function RootErrorFallback() {
  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ color: '#555' }}>The app hit an unexpected error. Please reload the page.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: '0.5rem 1rem',
          borderRadius: '0.5rem',
          border: '1px solid #ccc',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  )
}

/** Router-root error boundary (#765 AC). Captures render crashes to Sentry. */
export function SentryErrorBoundary({ children }: { children: ReactNode }) {
  return <Sentry.ErrorBoundary fallback={<RootErrorFallback />}>{children}</Sentry.ErrorBoundary>
}
