import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import {
  InMemoryAddOnRepository,
  InMemoryAddOnTemplateRepository,
} from '../../src/repositories/in-memory'
import { createAddOnTemplateRoutes } from '../../src/routes/add-on-templates'
import { AddOnTemplateService } from '../../src/services/add-on-template'
import { testAuthMiddleware } from '../helpers/auth'

const OP = 'operator-aaaaaaaa'

function routes() {
  // The route resolves a target operator (a management caller reads its own
  // tenant), so the picker service needs the add-on repo to exclude already-offered
  // templates. An empty add-on repo offers nothing, so the full catalog shows.
  return createAddOnTemplateRoutes(
    new AddOnTemplateService(new InMemoryAddOnTemplateRepository(), new InMemoryAddOnRepository()),
  )
}

function mountFor(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', routes())
  return app
}

type PickerRow = { id: string; key: string; resolvedName: string }
const childSeatOf = (data: PickerRow[]) => data.find((t) => t.key === 'child_seat')

describe('Add-on template routes — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    setupGlobalHandlers(app)
    app.route('/', routes())
    expect((await app.request('/add-on-templates')).status).toBe(401)
  })

  it('403 for a RENTER — rejects with no picker data in the body', async () => {
    const res = await mountFor('RENTER').request('/add-on-templates')
    expect(res.status).toBe(403)
    const json = (await res.json()) as { success: boolean; data?: unknown }
    expect(json.success).toBe(false)
    expect(json.data).toBeUndefined()
  })

  it('403 for a PARTNER (management-only picker)', async () => {
    expect((await mountFor('PARTNER').request('/add-on-templates')).status).toBe(403)
  })
})

describe('Add-on template routes — picker read', () => {
  it('returns the resolved-name picker to a management caller (default en)', async () => {
    const res = await mountFor('OPERATOR_OWNER', OP).request('/add-on-templates')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: PickerRow[] }
    expect(childSeatOf(data)).toEqual({
      id: expect.any(String),
      key: 'child_seat',
      resolvedName: 'Child seat',
    })
  })

  it('resolves names to ?locale=ja', async () => {
    const res = await mountFor('OPERATOR_OWNER', OP).request('/add-on-templates?locale=ja')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: PickerRow[] }
    expect(childSeatOf(data)?.resolvedName).toBe('チャイルドシート')
  })

  it('rejects an unknown ?locale with 400 (no coercion — §334 cache-flood guard)', async () => {
    const res = await mountFor('OPERATOR_OWNER', OP).request('/add-on-templates?locale=xx')
    expect(res.status).toBe(400)
  })
})
