import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AppOverrides } from '../app-overrides'
import { ResendEmailSender } from '../services/email/resend-email-sender'
import type { CreateCheckoutParams } from '../services/payment/payment-gateway'
import { StripePaymentGateway } from '../services/payment/stripe-payment-gateway'
import {
  resolveAllowedOrigins,
  resolveEmailConfig,
  resolveEmailSender,
  resolveGeocoder,
  resolveGoogleOAuthConfig,
  resolveOperatorAlertEmail,
  resolvePaymentGateway,
} from './services'

// The resolvers read process.env at call time. Each test gets a private copy
// with every resolver-relevant key stripped, so a key is absent unless the test
// sets it (no `delete` needed, and no dev-shell secret leaks into a test).
const RESOLVER_ENV_KEYS = [
  'NODE_ENV',
  'WEB_ORIGIN',
  'WEB_POST_LOGIN_URL',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
  'AUTH_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
  'OPERATOR_ALERT_FALLBACK_EMAIL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NOMINATIM_USER_AGENT',
  'NOMINATIM_API_URL',
  'NOMINATIM_API_KEY',
]
const ORIGINAL_ENV = process.env
beforeEach(() => {
  process.env = Object.fromEntries(
    Object.entries(ORIGINAL_ENV).filter(([key]) => !RESOLVER_ENV_KEYS.includes(key)),
  )
})
afterEach(() => {
  process.env = ORIGINAL_ENV
})

// AppOverrides requires the in-memory repo trio; tests only exercise the infra
// seams, so a partial cast keeps the fixtures to the fields under test.
const ov = (o: Partial<AppOverrides>): AppOverrides => o as unknown as AppOverrides
const checkoutParams = {
  bookingCode: 'BK1',
  successUrl: 'https://web/success',
} as CreateCheckoutParams

describe('resolveAllowedOrigins', () => {
  test('outside production, prepends the dev origins and dedupes', () => {
    process.env.NODE_ENV = 'test'
    expect(resolveAllowedOrigins(undefined)).toEqual([
      'http://localhost:3001',
      'http://127.0.0.1:3001',
    ])
  })

  test('in production, parses + trims the comma list and omits dev origins', () => {
    process.env.NODE_ENV = 'production'
    expect(resolveAllowedOrigins(' https://a.com , https://b.com ')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })

  test('dedupes repeated origins', () => {
    process.env.NODE_ENV = 'production'
    expect(resolveAllowedOrigins('https://a.com,https://a.com')).toEqual(['https://a.com'])
  })
})

describe('resolveGoogleOAuthConfig', () => {
  test('returns undefined when any of id/secret/url is missing', () => {
    process.env.AUTH_GOOGLE_SECRET = 'secret'
    process.env.AUTH_URL = 'https://api.example.com'
    expect(resolveGoogleOAuthConfig()).toBeUndefined()
  })

  test('derives redirectUri from AUTH_URL (trailing slash stripped) and defaults postLogin to first web origin', () => {
    process.env.NODE_ENV = 'production'
    process.env.AUTH_GOOGLE_ID = 'id'
    process.env.AUTH_GOOGLE_SECRET = 'secret'
    process.env.AUTH_URL = 'https://api.example.com/'
    process.env.WEB_ORIGIN = 'https://web.example.com'
    expect(resolveGoogleOAuthConfig()).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://api.example.com/auth/google/callback',
      postLoginRedirect: 'https://web.example.com',
    })
  })
})

describe('resolveEmailSender', () => {
  test('an injected override wins outright', () => {
    const fake = { send: vi.fn() }
    expect(resolveEmailSender(ov({ emailSender: fake }))).toBe(fake)
  })

  test('a present RESEND_API_KEY yields the real Resend sender', () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM = 'from@example.com'
    expect(resolveEmailSender()).toBeInstanceOf(ResendEmailSender)
  })

  test('production without a key yields a sentinel that throws on send', async () => {
    process.env.NODE_ENV = 'production'
    const sender = resolveEmailSender()
    await expect(sender.send({} as never)).rejects.toThrow('RESEND_API_KEY not configured')
  })

  test('dev without a key yields a console stub returning the dev id', async () => {
    process.env.NODE_ENV = 'test'
    await expect(resolveEmailSender().send({} as never)).resolves.toEqual({
      providerMessageId: 'dev',
    })
  })
})

describe('resolvePaymentGateway', () => {
  test('an injected override wins outright', () => {
    const fake = { createCheckoutSession: vi.fn() } as never
    expect(resolvePaymentGateway(ov({ paymentGateway: fake }))).toBe(fake)
  })

  test('both Stripe secrets present yields the real gateway', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    expect(resolvePaymentGateway()).toBeInstanceOf(StripePaymentGateway)
  })

  test('production without secrets yields a sentinel where every method throws', async () => {
    process.env.NODE_ENV = 'production'
    const gateway = resolvePaymentGateway() as unknown as Record<string, () => Promise<unknown>>
    const methods = Object.values(gateway)
    expect(methods).toHaveLength(5)
    for (const call of methods) {
      await expect(call()).rejects.toThrow(
        'STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not configured',
      )
    }
  })

  test('dev without secrets stubs checkout (echoes successUrl) but throws on refund', async () => {
    process.env.NODE_ENV = 'test'
    const gateway = resolvePaymentGateway()
    await expect(gateway.createCheckoutSession(checkoutParams)).resolves.toEqual({
      sessionId: 'dev',
      url: 'https://web/success',
    })
    await expect(gateway.refundPayment({} as never)).rejects.toThrow(
      'Stripe not configured (dev): cannot refund',
    )
  })
})

describe('resolveGeocoder', () => {
  test('an injected geocoder override is the inner geocoder behind the cache', async () => {
    const inner = vi.fn(async () => ({ status: 'notFound' as const }))
    await resolveGeocoder(ov({ geocoder: { geocode: inner } })).geocode('Osaka')
    expect(inner).toHaveBeenCalledWith('Osaka')
  })

  test('a present geocode limiter is consulted (keyed global) before delegating the lookup', async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const inner = vi.fn(async () => ({ status: 'notFound' as const }))
    await resolveGeocoder(ov({ geocoder: { geocode: inner }, geocodeLimiter: { limit } })).geocode(
      'Osaka',
    )
    expect(limit).toHaveBeenCalledWith({ key: 'geocode:global' })
    expect(inner).toHaveBeenCalledWith('Osaka')
  })

  test('no provider env yields a disabled geocoder that reports every address un-geocodable', async () => {
    await expect(resolveGeocoder().geocode('Osaka')).resolves.toEqual({ status: 'notFound' })
  })
})

describe('resolveOperatorAlertEmail', () => {
  test('prefers the explicit fallback inbox over the envelope addresses', () => {
    process.env.OPERATOR_ALERT_FALLBACK_EMAIL = 'alerts@op.com'
    process.env.EMAIL_REPLY_TO = 'reply@op.com'
    process.env.EMAIL_FROM = 'from@op.com'
    expect(resolveOperatorAlertEmail()).toBe('alerts@op.com')
  })

  test('falls back to reply-to, then from, then undefined', () => {
    expect(resolveOperatorAlertEmail()).toBeUndefined()
    process.env.EMAIL_FROM = 'from@op.com'
    expect(resolveOperatorAlertEmail()).toBe('from@op.com')
    process.env.EMAIL_REPLY_TO = 'reply@op.com'
    expect(resolveOperatorAlertEmail()).toBe('reply@op.com')
  })
})

describe('resolveEmailConfig', () => {
  test('reads the envelope envs, defaulting from to empty string', () => {
    expect(resolveEmailConfig()).toEqual({ emailFrom: '', emailReplyTo: undefined })
  })

  test('passes through configured from/reply-to', () => {
    process.env.EMAIL_FROM = 'from@example.com'
    process.env.EMAIL_REPLY_TO = 'reply@example.com'
    expect(resolveEmailConfig()).toEqual({
      emailFrom: 'from@example.com',
      emailReplyTo: 'reply@example.com',
    })
  })
})
