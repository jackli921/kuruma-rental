import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryConsentRepository } from '../repositories/in-memory/consent'
import { OperatorTermsService } from './operator-terms'

const OP = 'op_1'
const NOW = new Date('2026-06-01T00:00:00Z')
const draft = { en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' } }

describe('OperatorTermsService', () => {
  let repo: InMemoryConsentRepository
  let svc: OperatorTermsService
  beforeEach(() => {
    repo = new InMemoryConsentRepository([])
    svc = new OperatorTermsService(repo)
  })

  it('creates a v1 DRAFT from en-only input', async () => {
    const r = await svc.saveDraft(OP, draft, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.version.version).toBe('v1')
    expect(r.version.status).toBe('DRAFT')
    expect(r.version.locales).toEqual(['en'])
  })

  it('replaces the existing draft version rather than creating v2', async () => {
    await svc.saveDraft(OP, draft, NOW)
    const r = await svc.saveDraft(
      OP,
      { en: { title: 'Terms 2', body: 'b', acceptanceLabel: 'ok' } },
      NOW,
    )
    expect(r.ok && r.version.version).toBe('v1')
    const list = await svc.list(OP)
    expect(list.ok && list.versions).toHaveLength(1)
    expect(list.ok && list.versions[0]?.title).toBe('Terms 2')
  })

  it('publish flips DRAFT→PUBLISHED and stamps publishedAt', async () => {
    await svc.saveDraft(OP, draft, NOW)
    const r = await svc.publish(OP, 'v1', NOW)
    expect(r.ok && r.version.status).toBe('PUBLISHED')
    expect(r.ok && r.version.publishedAt).toEqual(NOW)
  })

  it('publishing a nonexistent/non-draft version is 404', async () => {
    const r = await svc.publish(OP, 'v9', NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(404)
  })

  it('a fresh draft after publish becomes v2', async () => {
    await svc.saveDraft(OP, draft, NOW)
    await svc.publish(OP, 'v1', NOW)
    const r = await svc.saveDraft(OP, draft, NOW)
    expect(r.ok && r.version.version).toBe('v2')
  })

  it('archive flips PUBLISHED→ARCHIVED', async () => {
    await svc.saveDraft(OP, draft, NOW)
    await svc.publish(OP, 'v1', NOW)
    const r = await svc.archive(OP, 'v1', NOW)
    expect(r.ok && r.version.status).toBe('ARCHIVED')
  })
})
