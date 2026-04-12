import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'

describe('CORS env gating', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('rejects dev origins when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production'
    const app = createApp()

    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:3001' },
    })

    expect(res.status).toBe(200)
    const acao = res.headers.get('Access-Control-Allow-Origin')
    expect(acao).not.toBe('http://localhost:3001')
  })

  it('rejects 127.0.0.1 dev origin when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production'
    const app = createApp()

    const res = await app.request('/health', {
      headers: { Origin: 'http://127.0.0.1:3001' },
    })

    const acao = res.headers.get('Access-Control-Allow-Origin')
    expect(acao).not.toBe('http://127.0.0.1:3001')
  })

  it('allows dev origins when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development'
    const app = createApp()

    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:3001' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001')
  })

  it('allows configured WEB_ORIGIN in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.WEB_ORIGIN = 'https://kuruma.example.com'
    const app = createApp()

    const res = await app.request('/health', {
      headers: { Origin: 'https://kuruma.example.com' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://kuruma.example.com')
    process.env.WEB_ORIGIN = undefined
  })
})
