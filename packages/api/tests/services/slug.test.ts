import { describe, expect, test } from 'vitest'
import { resolveUniqueSlug, slugify } from '../../src/services/slug'

describe('slugify', () => {
  test('lowercases and hyphenates words', () => {
    expect(slugify('Best Car Rental')).toBe('best-car-rental')
  })

  test('strips punctuation and collapses separators', () => {
    expect(slugify('Acme   Cars!! (Osaka)')).toBe('acme-cars-osaka')
  })

  test('trims leading/trailing separators', () => {
    expect(slugify('  --Hello--  ')).toBe('hello')
  })

  test('folds diacritics to ASCII', () => {
    expect(slugify('Café Cars')).toBe('cafe-cars')
  })

  test('truncates to 32 chars without a trailing hyphen', () => {
    const slug = slugify('The Quick Brown Fox Jumps Over Lazy')
    expect(slug.length).toBeLessThanOrEqual(32)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('falls back to "operator" when nothing ASCII remains', () => {
    expect(slugify('カー レンタル')).toBe('operator')
  })
})

describe('resolveUniqueSlug', () => {
  const existsIn = (taken: string[]) => (slug: string) => Promise.resolve(taken.includes(slug))

  test('returns the base slug when free', async () => {
    expect(await resolveUniqueSlug('acme', existsIn([]))).toBe('acme')
  })

  test('appends -2, then -3, on collision', async () => {
    expect(await resolveUniqueSlug('acme', existsIn(['acme']))).toBe('acme-2')
    expect(await resolveUniqueSlug('acme', existsIn(['acme', 'acme-2']))).toBe('acme-3')
  })

  test('keeps the suffixed slug within 32 chars', async () => {
    const base = 'a'.repeat(32)
    const out = await resolveUniqueSlug(base, existsIn([base]))
    expect(out.length).toBeLessThanOrEqual(32)
    expect(out.endsWith('-2')).toBe(true)
  })
})
