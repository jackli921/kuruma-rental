import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import { createOperatorTermsRoutes } from '../../src/routes/operator-terms'
import { OperatorTermsService } from '../../src/services/operator-terms'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
const draft = { en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' } }

function mountFor(repo: InMemoryConsentRepository, role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route(
    '/',
    createOperatorTermsRoutes(new OperatorTermsService(repo), testResolveWriteOperatorId()),
  )
  return app
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('operator-terms authoring routes', () => {
  it('operator saves a draft, publishes it, and lists it', async () => {
    const repo = new InMemoryConsentRepository([])
    const app = mountFor(repo, 'OPERATOR_OWNER', OP_A)

    const create = await app.request('/operator-terms', post(draft))
    expect(create.status).toBe(201)
    expect((await create.json()).data.version).toBe('v1')

    const pub = await app.request('/operator-terms/v1/publish', { method: 'POST' })
    expect(pub.status).toBe(200)
    expect((await pub.json()).data.status).toBe('PUBLISHED')

    const list = await app.request('/operator-terms')
    expect((await list.json()).data).toHaveLength(1)
  })

  it('an operator cannot see another operator’s terms', async () => {
    const repo = new InMemoryConsentRepository([])
    await mountFor(repo, 'OPERATOR_OWNER', OP_A).request('/operator-terms', post(draft))
    const list = await mountFor(repo, 'OPERATOR_OWNER', OP_B).request('/operator-terms')
    expect((await list.json()).data).toHaveLength(0)
  })

  it('a platform admin writing without ?operatorId= is 422', async () => {
    const repo = new InMemoryConsentRepository([])
    const res = await mountFor(repo, 'PLATFORM_ADMIN').request('/operator-terms', post(draft))
    expect(res.status).toBe(422)
  })

  it('a renter is forbidden from the authoring surface (the FLEET_WRITE gate rejects reads and writes)', async () => {
    const repo = new InMemoryConsentRepository([])
    const renter = mountFor(repo, 'RENTER', OP_A)
    expect((await renter.request('/operator-terms')).status).toBe(403)
    expect((await renter.request('/operator-terms', post(draft))).status).toBe(403)
  })
})
