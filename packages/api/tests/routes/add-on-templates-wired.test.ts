import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// Wire-up guard: the standalone route test exercises the handler, but only the
// composition root actually mounts it. Boot the full in-memory app (which seeds
// the demo catalog) and confirm the picker is reachable end-to-end — deleting
// the index.ts mount, or dropping addOnTemplateRepo from a builder, breaks this.
describe('GET /add-on-templates is mounted on the composed app', () => {
  it('serves the seeded picker to an authenticated management caller', async () => {
    setupAuthEnv()
    const app = createApp()

    const res = await app.request('/add-on-templates', { headers: await authHeaders() })

    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { key: string }[] }
    expect(data.map((t) => t.key)).toContain('child_seat')
  })
})
