import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'

describe('rate limiting wiring', () => {
  it('app starts without rate limit binding (local dev)', async () => {
    const app = createApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('all endpoints respond when no rate limit binding is present', async () => {
    const app = createApp()

    const vehicles = await app.request('/vehicles')
    expect(vehicles.status).toBe(200)

    const health = await app.request('/health')
    expect(health.status).toBe(200)
  })
})
