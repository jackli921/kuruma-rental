import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import type { AppOverrides } from '../app-overrides'
import type { GoogleOAuthConfig } from '../auth/google'
import type { EmailSender } from '../services/email/email-sender'
import { ResendEmailSender } from '../services/email/resend-email-sender'
import { CachingGeocoder } from '../services/geocoding/caching-geocoder'
import { InMemoryGeocodeCache } from '../services/geocoding/geocode-cache'
import { KvGeocodeCache, type KvStore } from '../services/geocoding/kv-geocode-cache'
import { NominatimGeocoder } from '../services/geocoding/nominatim-geocoder'
import { ThrottledGeocoder } from '../services/geocoding/throttled-geocoder'
import type { GeocodeCache, Geocoder } from '../services/geocoding/types'
import type { PaymentGateway } from '../services/payment/payment-gateway'
import { StripePaymentGateway } from '../services/payment/stripe-payment-gateway'

/**
 * Infra-resolution policy for the composition root (#1115, audit L3). Decides
 * HOW each env/secret-backed collaborator is built — real vendor adapter when
 * the secret is present, a throwing sentinel in production when it is absent (so
 * unrelated tests still construct the app), a navigable dev stub otherwise, and
 * an injected override always winning. createApp (index.ts) and the Workers
 * `scheduled` cron seams call these so the resolution lives in one tested place
 * instead of inline in the wiring. Mirrors composition/repositories.ts.
 */

const DEV_WEB_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001']

export function resolveAllowedOrigins(envValue: string | undefined): string[] {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // Only include dev origins outside production so `bun run dev` works
  // out of the box without leaking localhost to prod.
  const devOrigins = process.env.NODE_ENV === 'production' ? [] : DEV_WEB_ORIGINS
  return [...new Set([...devOrigins, ...fromEnv])]
}

/**
 * Resolve Google OAuth config from env, or undefined when unconfigured (local
 * dev / CI without secrets) — the /auth/google/* routes then return 503 rather
 * than crashing at boot. redirect_uri is derived from AUTH_URL so it always
 * matches the deployed origin; the post-login target defaults to the first
 * allowed web origin.
 */
export function resolveGoogleOAuthConfig(): GoogleOAuthConfig | undefined {
  const clientId = process.env.AUTH_GOOGLE_ID
  const clientSecret = process.env.AUTH_GOOGLE_SECRET
  const authUrl = process.env.AUTH_URL
  if (!clientId || !clientSecret || !authUrl) return undefined

  const base = authUrl.replace(/\/$/, '')
  const postLoginRedirect =
    process.env.WEB_POST_LOGIN_URL ?? resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? base
  return {
    clientId,
    clientSecret,
    redirectUri: `${base}/auth/google/callback`,
    postLoginRedirect,
  }
}

/**
 * Resolve the outbound email port (#916 DRY): an injected override wins (tests),
 * else real Resend when RESEND_API_KEY is set, else a throwing sentinel in
 * production and a console stub in dev — so flows work end-to-end without a
 * vendor account. Shared by createApp's dispatcher and buildComplianceDigestService.
 */
export function resolveEmailSender(overrides?: AppOverrides): EmailSender {
  if (overrides?.emailSender) return overrides.emailSender
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? ''
  if (key) return new ResendEmailSender(key, from)
  if (process.env.NODE_ENV === 'production') {
    return {
      send: async () => {
        throw new Error('RESEND_API_KEY not configured')
      },
    }
  }
  return {
    send: async (m) => {
      console.info('[email:dev]', m.to, m.subject)
      return { providerMessageId: 'dev' }
    },
  }
}

/**
 * Resolve the Stripe gateway (#461), shared by createApp and the #851 refund-
 * reconciler cron. Real gateway when BOTH secrets are set; an override (tests)
 * wins; in production without secrets a sentinel throws on first use (not at
 * boot); in dev a stub yields the success URL but every Stripe op throws so
 * nothing is recorded without real wiring. Mirrors resolveEmailSender.
 */
export function resolvePaymentGateway(overrides?: AppOverrides): PaymentGateway {
  if (overrides?.paymentGateway) return overrides.paymentGateway
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (secretKey && webhookSecret) return new StripePaymentGateway(secretKey, webhookSecret)
  if (process.env.NODE_ENV === 'production') {
    const notConfigured = () => {
      throw new Error('STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not configured')
    }
    return {
      createCheckoutSession: async () => notConfigured(),
      parseWebhookEvent: async () => notConfigured(),
      refundPayment: async () => notConfigured(),
      retrieveRefund: async () => notConfigured(),
      listRefundsByPaymentIntent: async () => notConfigured(),
    }
  }
  const devUnsupported = (op: string) => () => {
    throw new Error(`Stripe not configured (dev): cannot ${op}`)
  }
  return {
    createCheckoutSession: async (p) => {
      console.info('[payment:dev] checkout session for', p.bookingCode)
      return { sessionId: 'dev', url: p.successUrl }
    },
    parseWebhookEvent: async () => devUnsupported('verify webhook')(),
    refundPayment: async () => devUnsupported('refund')(),
    retrieveRefund: async () => devUnsupported('retrieve refund')(),
    listRefundsByPaymentIntent: async () => devUnsupported('list refunds')(),
  }
}

/**
 * The shared envelope fields (from/reply-to) read from one env in two places —
 * createApp's notification dispatcher and buildComplianceDigestService (#982 DRY).
 */
export function resolveEmailConfig(): { emailFrom: string; emailReplyTo: string | undefined } {
  return {
    emailFrom: process.env.EMAIL_FROM ?? '',
    emailReplyTo: process.env.EMAIL_REPLY_TO,
  }
}

/**
 * The operator-alert fallback inbox (#960): the address the notification
 * dispatcher falls back to when no operator-specific recipient resolves. Prefers
 * an explicit OPERATOR_ALERT_FALLBACK_EMAIL, then the reply-to, then the from
 * envelope — undefined only when none is set (the dispatcher then has no inbox).
 */
export function resolveOperatorAlertEmail(): string | undefined {
  return (
    process.env.OPERATOR_ALERT_FALLBACK_EMAIL ??
    process.env.EMAIL_REPLY_TO ??
    process.env.EMAIL_FROM
  )
}

/**
 * Resolve the forward geocoder stack (#531/#574/#601): disabled by default (a
 * null stub that reports every address un-geocodable) unless BOTH a User-Agent
 * and an endpoint are set; prod = LocationIQ (Nominatim-compatible, +
 * NOMINATIM_API_KEY) or self-host. The provider is wrapped in a ThrottledGeocoder
 * keyed off GEOCODE_LIMITER (best-effort global 1 req/s cap), then a
 * CachingGeocoder OUTSIDE the throttle (a cache HIT spends neither the provider
 * call nor the budget) backed by Workers KV when the GEOCODE_CACHE binding is
 * present, else an in-process map. A test override wins outright.
 */
export function resolveGeocoder(overrides?: AppOverrides): Geocoder {
  const innerGeocoder: Geocoder =
    overrides?.geocoder ??
    (() => {
      const userAgent = process.env.NOMINATIM_USER_AGENT
      const baseUrl = process.env.NOMINATIM_API_URL
      // Disabled: every address is "un-geocodable" (no provider), so a save
      // persists with null coords — never PENDING (nothing will ever resolve it).
      if (!userAgent || !baseUrl) return { geocode: async () => ({ status: 'notFound' as const }) }
      return new NominatimGeocoder(baseUrl, userAgent, undefined, process.env.NOMINATIM_API_KEY)
    })()
  // Adapt the native binding's `limit({ key })` to the RateLimiter port here.
  const geocodeLimiter =
    overrides?.geocodeLimiter ??
    ((globalThis as Record<string, unknown>).GEOCODE_LIMITER as RateLimitBinding | undefined)
  const geocoder: Geocoder = geocodeLimiter
    ? new ThrottledGeocoder(innerGeocoder, { limit: (key) => geocodeLimiter.limit({ key }) })
    : innerGeocoder
  const geocodeCache: GeocodeCache =
    overrides?.geocodeCache ??
    (() => {
      const kv = (globalThis as Record<string, unknown>).GEOCODE_CACHE as KvStore | undefined
      return kv ? new KvGeocodeCache(kv) : new InMemoryGeocodeCache()
    })()
  return new CachingGeocoder(geocoder, geocodeCache)
}
