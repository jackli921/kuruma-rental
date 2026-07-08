import { describe, expect, it } from 'vitest'
import { saveOperatorTermsDraftSchema } from './consent-documents'

describe('saveOperatorTermsDraftSchema', () => {
  it('requires en and accepts optional ja/zh', () => {
    const r = saveOperatorTermsDraftSchema.safeParse({
      en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' },
    })
    expect(r.success).toBe(true)
  })
  it('rejects a draft with no en locale', () => {
    const r = saveOperatorTermsDraftSchema.safeParse({
      ja: { title: '規約', body: '同意します', acceptanceLabel: '同意する' },
    })
    expect(r.success).toBe(false)
  })
  it('rejects an empty en title', () => {
    const r = saveOperatorTermsDraftSchema.safeParse({
      en: { title: '', body: 'b', acceptanceLabel: 'a' },
    })
    expect(r.success).toBe(false)
  })
})
