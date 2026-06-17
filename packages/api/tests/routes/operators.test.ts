import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory'
import { createOperatorRoutes } from '../../src/routes/operators'
import { OperatorService } from '../../src/services/operator'
import { testAuthMiddleware } from '../helpers/auth'

let repo: InMemoryOperatorRepository
let opA: { id: string; slug: string }
let opB: { id: string; slug: string }

beforeEach(async () => {
  repo = new InMemoryOperatorRepository()
  opA = await repo.create({
    name: 'Best Car Rental',
    slug: 'best-car-rental',
    preAuthHandoffUrl: null,
  })
  opB = await repo.create({ name: 'Acme Cars', slug: 'acme-cars', preAuthHandoffUrl: null })
})

function mountFor(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createOperatorRoutes(new OperatorService(repo, () => {})))
  return app
}

describe('GET /operators (list)', () => {
  it('returns name-sorted {id,name,slug} for a STAFF caller', async () => {
    const res = await mountFor('STAFF').request('/operators')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual([
      { id: opB.id, name: 'Acme Cars', slug: 'acme-cars' },
      { id: opA.id, name: 'Best Car Rental', slug: 'best-car-rental' },
    ])
  })

  it('lets a PLATFORM_ADMIN see every operator', async () => {
    const { data } = await (await mountFor('PLATFORM_ADMIN').request('/operators')).json()
    expect(data.map((o: { id: string }) => o.id).sort()).toEqual([opA.id, opB.id].sort())
  })

  it('scopes an OPERATOR_STAFF to its own operator only', async () => {
    const res = await mountFor('OPERATOR_STAFF', opA.id).request('/operators')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual([{ id: opA.id, name: 'Best Car Rental', slug: 'best-car-rental' }])
  })

  it('returns 403 for a RENTER', async () => {
    expect((await mountFor('RENTER').request('/operators')).status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = new Hono()
    setupGlobalHandlers(app)
    app.route('/', createOperatorRoutes(new OperatorService(repo, () => {})))
    expect((await app.request('/operators')).status).toBe(401)
  })
})

describe('GET /operators/:id', () => {
  it('lets an OPERATOR_STAFF read its own operator', async () => {
    const res = await mountFor('OPERATOR_STAFF', opA.id).request(`/operators/${opA.id}`)
    expect(res.status).toBe(200)
    expect((await res.json()).data.slug).toBe('best-car-rental')
  })

  it('returns the operator profile projection — same shape as PATCH, no raw timestamps', async () => {
    const res = await mountFor('OPERATOR_STAFF', opA.id).request(`/operators/${opA.id}`)
    const { data } = await res.json()
    // One resource, one wire shape: the read must match the PATCH projection
    // exactly (#903 arch review) — never the full row with createdAt/updatedAt.
    expect(data).toEqual({
      id: opA.id,
      name: 'Best Car Rental',
      slug: 'best-car-rental',
      preAuthHandoffUrl: null,
    })
    expect(data).not.toHaveProperty('createdAt')
    expect(data).not.toHaveProperty('updatedAt')
  })

  it('returns 404 when an OPERATOR_STAFF reads another operator', async () => {
    const res = await mountFor('OPERATOR_STAFF', opA.id).request(`/operators/${opB.id}`)
    expect(res.status).toBe(404)
  })

  it('lets a PLATFORM_ADMIN read any operator', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request(`/operators/${opB.id}`)
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe(opB.id)
  })

  it('returns 403 for a RENTER', async () => {
    expect((await mountFor('RENTER').request(`/operators/${opA.id}`)).status).toBe(403)
  })

  it('returns 404 for a valid-but-unknown id (admin)', async () => {
    expect(
      (await mountFor('PLATFORM_ADMIN').request('/operators/00000000-0000-4000-8000-0000000000ff'))
        .status,
    ).toBe(404)
  })

  it('returns 400 for a malformed (non-uuid) id (admin)', async () => {
    expect((await mountFor('PLATFORM_ADMIN').request('/operators/nope')).status).toBe(400)
  })
})

describe('GET /operators/by-slug/:slug', () => {
  it('resolves the slug route (not captured by :id) for the owning operator', async () => {
    const res = await mountFor('OPERATOR_STAFF', opA.id).request(
      '/operators/by-slug/best-car-rental',
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe(opA.id)
  })

  it('returns 404 when an operator reads another operator slug', async () => {
    const res = await mountFor('OPERATOR_STAFF', opA.id).request('/operators/by-slug/acme-cars')
    expect(res.status).toBe(404)
  })

  it('lets a PLATFORM_ADMIN resolve any slug', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/by-slug/acme-cars')
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe(opB.id)
  })

  it('returns 403 for a RENTER', async () => {
    expect((await mountFor('RENTER').request('/operators/by-slug/best-car-rental')).status).toBe(
      403,
    )
  })
})

describe('Operator routes — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    app.route('/', createOperatorRoutes(new OperatorService(repo, () => {})))
    expect((await app.request(`/operators/${opA.id}`)).status).toBe(401)
  })
})

function patchReq(app: Hono, id: string, body: unknown) {
  return app.request(`/operators/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /operators/:id', () => {
  it('lets an owner rename its own operator and returns the projection', async () => {
    const res = await patchReq(mountFor('OPERATOR_OWNER', opA.id), opA.id, { name: 'Renamed' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      id: opA.id,
      name: 'Renamed',
      slug: 'best-car-rental',
      preAuthHandoffUrl: null,
    })
  })

  it('lets an owner set the preAuthHandoffUrl', async () => {
    const res = await patchReq(mountFor('OPERATOR_OWNER', opA.id), opA.id, {
      preAuthHandoffUrl: 'https://pay.best.example/h',
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.preAuthHandoffUrl).toBe('https://pay.best.example/h')
  })

  it('lets an OPERATOR_STAFF edit the display name', async () => {
    const res = await patchReq(mountFor('OPERATOR_STAFF', opA.id), opA.id, { name: 'Staff Edit' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.name).toBe('Staff Edit')
  })

  it('forbids an OPERATOR_STAFF from changing preAuthHandoffUrl (403)', async () => {
    const res = await patchReq(mountFor('OPERATOR_STAFF', opA.id), opA.id, {
      preAuthHandoffUrl: 'https://evil.example',
    })
    expect(res.status).toBe(403)
    expect((await repo.findById(opA.id))?.preAuthHandoffUrl).toBeNull()
  })

  it('returns 404 for a cross-tenant patch AND leaves the target row unchanged', async () => {
    const res = await patchReq(mountFor('OPERATOR_OWNER', opA.id), opB.id, { name: 'Hijacked' })
    expect(res.status).toBe(404)
    expect((await repo.findById(opB.id))?.name).toBe('Acme Cars')
  })

  it('rejects a javascript: scheme handoff URL with 400', async () => {
    const res = await patchReq(mountFor('OPERATOR_OWNER', opA.id), opA.id, {
      preAuthHandoffUrl: 'javascript:alert(1)',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an empty patch with 400', async () => {
    const res = await patchReq(mountFor('OPERATOR_OWNER', opA.id), opA.id, {})
    expect(res.status).toBe(400)
  })

  it('returns 403 for a RENTER', async () => {
    const res = await patchReq(mountFor('RENTER'), opA.id, { name: 'X' })
    expect(res.status).toBe(403)
  })

  it('returns 400 for a malformed (non-uuid) id', async () => {
    const res = await patchReq(mountFor('PLATFORM_ADMIN'), 'nope', { name: 'X' })
    expect(res.status).toBe(400)
  })

  it('returns 404 for a valid-but-unknown id (admin)', async () => {
    const res = await patchReq(mountFor('PLATFORM_ADMIN'), '00000000-0000-4000-8000-0000000000ff', {
      name: 'X',
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = new Hono()
    setupGlobalHandlers(app)
    app.route('/', createOperatorRoutes(new OperatorService(repo, () => {})))
    expect((await patchReq(app, opA.id, { name: 'X' })).status).toBe(401)
  })
})
