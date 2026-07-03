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
