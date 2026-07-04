import { seedId } from '@kuruma/shared/db/seed-id'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryFeatureFlagRepository } from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// Wiring guard for the SHARED_CATALOG kill-switch (#1437). The service unit tests
// inject a hand-written thunk, so they cannot catch a composition-root regression:
// the gate is an OPTIONAL constructor arg defaulting to catalog-ON, so DROPPING the
// `isSharedCatalogEnabled` argument from `new AddOnService(...)` / `new
// AddOnTemplateService(...)` in index.ts compiles clean and passes every unit test
// while silently disabling server enforcement. This boots the real composed app,
// flips the flag off via the real FeatureFlagRepository, and proves BOTH the picker
// read and the create path actually observe the switch end-to-end.
const CHILD_SEAT = seedId('tmpl_child_seat')

function appWithCatalog(enabled: boolean) {
  setupAuthEnv()
  const featureFlagRepo = new InMemoryFeatureFlagRepository()
  // Default is ON in code (registry serverDefault); only write a row to turn it OFF.
  const seed = enabled
    ? Promise.resolve()
    : featureFlagRepo.setOverride('SHARED_CATALOG', false, 'admin-1')
  return seed.then(() => createApp({ featureFlagRepo }))
}

describe('SHARED_CATALOG kill-switch is wired into the composed app (#1437)', () => {
  it('serves the seeded picker when the catalog is ON (control)', async () => {
    const app = await appWithCatalog(true)
    const res = await app.request('/add-on-templates', { headers: await authHeaders() })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { key: string }[] }
    expect(data.map((t) => t.key)).toContain('child_seat')
  })

  it('empties the picker when the catalog is OFF (AddOnTemplateService is wired)', async () => {
    const app = await appWithCatalog(false)
    const res = await app.request('/add-on-templates', { headers: await authHeaders() })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: unknown[] }
    expect(data).toEqual([])
  })

  it('rejects a template-picked create when the catalog is OFF (AddOnService is wired)', async () => {
    const app = await appWithCatalog(false)
    // Platform admin so the admin create schema (operatorId required) validates; the
    // OFF gate returns 422 before any operator/template lookup, so a synthetic
    // operatorId is fine — this asserts the switch, not ownership.
    const res = await app.request('/add-ons', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: CHILD_SEAT,
        priceJpy: 1500,
        operatorId: seedId('op_killswitch_wiring'),
      }),
    })
    expect(res.status).toBe(422)
  })
})
