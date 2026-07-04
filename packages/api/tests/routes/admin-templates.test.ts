import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryAddOnTemplateRepository } from '../../src/repositories/in-memory/add-on-template'
import { InMemoryInsuranceTemplateRepository } from '../../src/repositories/in-memory/insurance-template'
import { createAdminTemplateRoutes } from '../../src/routes/admin-templates'
import { TemplateLibraryService } from '../../src/services/template-library'
import type { AddOnTemplate, InsuranceTemplate } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const now = new Date()
const ARCHIVED_ADD_ON: AddOnTemplate = {
  id: 'a_archived',
  key: 'baby-seat',
  name: { en: 'Baby seat' },
  description: null,
  status: 'ARCHIVED',
  createdAt: now,
  updatedAt: now,
}
const ACTIVE_INSURANCE: InsuranceTemplate = {
  id: 'i_active',
  key: 'normal',
  name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
  description: null,
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
}

function service() {
  return new TemplateLibraryService(
    new InMemoryAddOnTemplateRepository(new Map([[ARCHIVED_ADD_ON.id, ARCHIVED_ADD_ON]])),
    new InMemoryInsuranceTemplateRepository(new Map([[ACTIVE_INSURANCE.id, ACTIVE_INSURANCE]])),
  )
}

function mount(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAdminTemplateRoutes(service()))
  return app
}

describe('GET /admin/templates', () => {
  it('returns both catalogs with raw bundles, including ARCHIVED, for a platform admin', async () => {
    const app = mount('PLATFORM_ADMIN')
    const res = await app.request('/admin/templates')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.addOns).toEqual([
      {
        id: 'a_archived',
        key: 'baby-seat',
        name: { en: 'Baby seat' },
        description: null,
        status: 'ARCHIVED',
      },
    ])
    expect(body.data.insurance).toEqual([
      {
        id: 'i_active',
        key: 'normal',
        name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
        description: null,
        status: 'ACTIVE',
      },
    ])
  })

  it('rejects an operator owner with 403 (platform-only surface)', async () => {
    const app = mount('OPERATOR_OWNER', 'op_1')
    const res = await app.request('/admin/templates')
    expect(res.status).toBe(403)
  })

  it('rejects a renter with 403', async () => {
    const app = mount('RENTER')
    const res = await app.request('/admin/templates')
    expect(res.status).toBe(403)
  })
})

// parseId validates a uuid path param, so the write fixtures use uuid-shaped ids
// (seedId derives v4-shaped uuids in production).
const ADDON_UUID = '11111111-1111-4111-8111-111111111111'
const INS_UUID = '22222222-2222-4222-8222-222222222222'

function writeService() {
  const addOn: AddOnTemplate = {
    id: ADDON_UUID,
    key: 'baby-seat',
    name: { en: 'Baby seat' },
    description: null,
    status: 'ARCHIVED',
    createdAt: now,
    updatedAt: now,
  }
  const insurance: InsuranceTemplate = {
    id: INS_UUID,
    key: 'normal',
    name: { en: 'Normal', ja: 'ノーマル', zh: '标准' },
    description: { en: 'Standard cover.' },
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  }
  return new TemplateLibraryService(
    new InMemoryAddOnTemplateRepository(new Map([[addOn.id, addOn]])),
    new InMemoryInsuranceTemplateRepository(new Map([[insurance.id, insurance]])),
  )
}

function mountWrite(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAdminTemplateRoutes(writeService()))
  return app
}

function patch(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /admin/templates/add-ons/:id', () => {
  it('translates + promotes an ARCHIVED add-on for a platform admin', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await patch(app, `/admin/templates/add-ons/${ADDON_UUID}`, {
      name: { en: 'Baby seat', ja: 'ベビーシート', zh: '婴儿座椅' },
      status: 'ACTIVE',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({
      id: ADDON_UUID,
      key: 'baby-seat',
      name: { en: 'Baby seat', ja: 'ベビーシート', zh: '婴儿座椅' },
      description: null,
      status: 'ACTIVE',
    })
  })

  it('rejects an operator owner with 403', async () => {
    const app = mountWrite('OPERATOR_OWNER', 'op_1')
    const res = await patch(app, `/admin/templates/add-ons/${ADDON_UUID}`, { status: 'ACTIVE' })
    expect(res.status).toBe(403)
  })

  it('404s for a valid-uuid id with no matching row', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await patch(app, '/admin/templates/add-ons/33333333-3333-4333-8333-333333333333', {
      status: 'ACTIVE',
    })
    expect(res.status).toBe(404)
  })

  it('400s an empty patch body (no-op guard) with a surfaced message', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await patch(app, `/admin/templates/add-ons/${ADDON_UUID}`, {})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.status).toContain('at least one of name, description, status is required')
  })

  it('400s a malformed (non-uuid) id', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await patch(app, '/admin/templates/add-ons/not-a-uuid', { status: 'ACTIVE' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /admin/templates/insurance/:id', () => {
  it('edits the insurance bundle for a platform admin', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await patch(app, `/admin/templates/insurance/${INS_UUID}`, {
      description: { en: 'Updated cover.' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.description).toEqual({ en: 'Updated cover.' })
    expect(body.data.status).toBe('ACTIVE')
  })

  it('rejects a renter with 403', async () => {
    const app = mountWrite('RENTER')
    const res = await patch(app, `/admin/templates/insurance/${INS_UUID}`, { status: 'ARCHIVED' })
    expect(res.status).toBe(403)
  })
})

function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /admin/templates/add-ons', () => {
  it('mints a template for a platform admin (201), deriving key + defaulting status/description', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await post(app, '/admin/templates/add-ons', {
      name: { en: 'Ski rack', ja: 'スキーラック' },
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toMatchObject({
      key: 'ski_rack',
      name: { en: 'Ski rack', ja: 'スキーラック' },
      description: null,
      status: 'ACTIVE',
    })
    expect(body.data.id).toEqual(expect.any(String))
  })

  it('rejects an operator owner with 403 (requirePlatformAdmin)', async () => {
    const app = mountWrite('OPERATOR_OWNER', 'op_1')
    const res = await post(app, '/admin/templates/add-ons', { name: { en: 'Ski rack' } })
    expect(res.status).toBe(403)
  })

  it('409s a duplicate name (same derived key)', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    await post(app, '/admin/templates/add-ons', { name: { en: 'Ski rack' } })

    const res = await post(app, '/admin/templates/add-ons', { name: { en: 'Ski rack' } })
    expect(res.status).toBe(409)
  })

  it('400s a body with no name', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await post(app, '/admin/templates/add-ons', { description: { en: 'orphan' } })
    expect(res.status).toBe(400)
  })
})

describe('POST /admin/templates/insurance', () => {
  it('mints an insurance template for a platform admin (201)', async () => {
    const app = mountWrite('PLATFORM_ADMIN')
    const res = await post(app, '/admin/templates/insurance', {
      name: { en: 'Premium cover' },
      description: { en: 'Zero deductible' },
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toMatchObject({
      key: 'premium_cover',
      description: { en: 'Zero deductible' },
      status: 'ACTIVE',
    })
  })

  it('rejects a renter with 403', async () => {
    const app = mountWrite('RENTER')
    const res = await post(app, '/admin/templates/insurance', { name: { en: 'Premium cover' } })
    expect(res.status).toBe(403)
  })
})
