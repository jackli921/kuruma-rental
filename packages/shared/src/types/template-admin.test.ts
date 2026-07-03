import { describe, expect, it } from 'vitest'
import { templateCreateSchema } from './template-admin'

describe('templateCreateSchema', () => {
  it('defaults description to null and status to ACTIVE when omitted', () => {
    const parsed = templateCreateSchema.parse({ name: { en: 'Baby seat' } })

    expect(parsed).toEqual({
      name: { en: 'Baby seat' },
      description: null,
      status: 'ACTIVE',
    })
  })

  it('keeps a provided description bundle and status', () => {
    const parsed = templateCreateSchema.parse({
      name: { en: 'Full cover', ja: '全補償' },
      description: { en: 'Zero deductible' },
      status: 'ARCHIVED',
    })

    expect(parsed.description).toEqual({ en: 'Zero deductible' })
    expect(parsed.status).toBe('ARCHIVED')
  })

  it('rejects a name without the en fallback', () => {
    const result = templateCreateSchema.safeParse({ name: { ja: 'ベビーシート' } })

    expect(result.success).toBe(false)
  })
})
