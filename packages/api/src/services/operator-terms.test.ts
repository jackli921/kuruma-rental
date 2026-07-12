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

  it('maps a concurrent-save unique violation to a 409, not a raw 500', async () => {
    // Two tabs first-save at once: both compute v1, the loser trips
    // consent_documents_operator_tvl_unique. The service must translate it.
    repo.replaceOperatorDraftRows = async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint_name: 'consent_documents_operator_tvl_unique',
      })
    }
    const r = await svc.saveDraft(OP, draft, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.error).toMatch(/already exists/)
  })

  it('re-throws a non-unique repo failure instead of swallowing it as a 409', async () => {
    repo.replaceOperatorDraftRows = async () => {
      throw new Error('connection terminated unexpectedly')
    }
    await expect(svc.saveDraft(OP, draft, NOW)).rejects.toThrow('connection terminated')
  })

  // #877 Slice B: the renter-facing read. getPublished resolves the operator's
  // latest PUBLISHED+effective terms in the requested locale (en fallback) —
  // the SAME resolver the booking tx uses, so the modal shows exactly what the
  // server will seal (no display/enforcement drift).
  describe('getPublished', () => {
    const multi = {
      en: { title: 'Terms EN', body: 'Agree EN', acceptanceLabel: 'I agree' },
      ja: { title: '規約', body: '同意します', acceptanceLabel: '同意する' },
    }

    async function publishTerms(
      operatorId: string,
      input: Parameters<typeof svc.saveDraft>[1],
      version = 'v1',
    ): Promise<void> {
      await svc.saveDraft(operatorId, input, NOW)
      await svc.publish(operatorId, version, NOW)
    }

    it('resolves the latest published doc in the requested locale', async () => {
      await publishTerms(OP, multi)
      const r = await svc.getPublished(OP, 'ja', NOW)
      expect(r).toMatchObject({
        ok: true,
        doc: { version: 'v1', locale: 'ja', title: '規約', acceptanceLabel: '同意する' },
      })
    })

    it('falls back to en when the requested locale is missing', async () => {
      await publishTerms(OP, { en: multi.en })
      const r = await svc.getPublished(OP, 'zh', NOW)
      expect(r).toMatchObject({ ok: true, doc: { version: 'v1', locale: 'en', title: 'Terms EN' } })
    })

    it('returns the highest published version, not a stale one', async () => {
      await publishTerms(OP, multi)
      await svc.saveDraft(OP, { en: { ...multi.en, body: 'v2 body' } }, NOW) // v2 draft
      await svc.publish(OP, 'v2', NOW)
      const r = await svc.getPublished(OP, 'en', NOW)
      expect(r).toMatchObject({ ok: true, doc: { version: 'v2', body: 'v2 body' } })
    })

    it('404 NO_PUBLISHED_TERMS when the operator has no published terms', async () => {
      await svc.saveDraft(OP, multi, NOW) // draft only, never published
      const r = await svc.getPublished(OP, 'en', NOW)
      expect(r).toEqual({ ok: false, status: 404, error: 'NO_PUBLISHED_TERMS' })
    })

    it('404 for an operator that does not exist', async () => {
      const r = await svc.getPublished('op_absent', 'en', NOW)
      expect(r).toEqual({ ok: false, status: 404, error: 'NO_PUBLISHED_TERMS' })
    })
  })
})
