import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp()
    const res = await app.request('/health')

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })
})
