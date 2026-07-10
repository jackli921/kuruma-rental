import { describe, expect, it } from 'vitest'
import { buildTermsBundle } from './name-bundle'

// Slice A: the self-authored rental-terms form holds three locale fieldsets
// (en/ja/zh); buildTermsBundle collapses them into a SaveOperatorTermsDraftInput
// for the wire. en is the required floor; a locale is only included when ALL
// THREE of its fields (title, body, acceptanceLabel) are non-blank — a partial
// locale is dropped so the server never stores an incomplete set.
describe('buildTermsBundle', () => {
  describe('en-only input', () => {
    it('returns only the en locale when ja/zh are all blank', () => {
      expect(
        buildTermsBundle({
          titleEn: 'Terms',
          bodyEn: 'Body text',
          labelEn: 'I agree',
          titleJa: '',
          bodyJa: '',
          labelJa: '',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toEqual({ en: { title: 'Terms', body: 'Body text', acceptanceLabel: 'I agree' } })
    })
  })

  describe('partial ja (some fields blank) — locale is omitted', () => {
    it('drops ja when title is filled but body and label are blank', () => {
      expect(
        buildTermsBundle({
          titleEn: 'Terms',
          bodyEn: 'Body text',
          labelEn: 'I agree',
          titleJa: 'タイトル',
          bodyJa: '',
          labelJa: '',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toEqual({ en: { title: 'Terms', body: 'Body text', acceptanceLabel: 'I agree' } })
    })
  })

  describe('full en + full ja', () => {
    it('returns both en and ja in the bundle', () => {
      expect(
        buildTermsBundle({
          titleEn: 'Terms',
          bodyEn: 'Body text',
          labelEn: 'I agree',
          titleJa: 'タイトル',
          bodyJa: '本文',
          labelJa: '同意します',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toEqual({
        en: { title: 'Terms', body: 'Body text', acceptanceLabel: 'I agree' },
        ja: { title: 'タイトル', body: '本文', acceptanceLabel: '同意します' },
      })
    })
  })

  describe('missing en', () => {
    it('throws when all en fields are blank', () => {
      expect(() =>
        buildTermsBundle({
          titleEn: '',
          bodyEn: '',
          labelEn: '',
          titleJa: '',
          bodyJa: '',
          labelJa: '',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toThrow('English terms are required')
    })

    it('throws when en title is present but body and label are blank', () => {
      expect(() =>
        buildTermsBundle({
          titleEn: 'Terms',
          bodyEn: '',
          labelEn: '',
          titleJa: '',
          bodyJa: '',
          labelJa: '',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toThrow('English terms are required')
    })
  })

  describe('en present but ja partial (title + body, no label) — ja omitted', () => {
    it('drops ja when label is blank even when title and body are filled', () => {
      expect(
        buildTermsBundle({
          titleEn: 'Terms',
          bodyEn: 'Body text',
          labelEn: 'I agree',
          titleJa: 'タイトル',
          bodyJa: '本文',
          labelJa: '',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toEqual({ en: { title: 'Terms', body: 'Body text', acceptanceLabel: 'I agree' } })
    })
  })

  describe('trimming', () => {
    it('trims whitespace from each field', () => {
      expect(
        buildTermsBundle({
          titleEn: '  Terms  ',
          bodyEn: '  Body text  ',
          labelEn: '  I agree  ',
          titleJa: '  タイトル  ',
          bodyJa: '  本文  ',
          labelJa: '  同意します  ',
          titleZh: '',
          bodyZh: '',
          labelZh: '',
        }),
      ).toEqual({
        en: { title: 'Terms', body: 'Body text', acceptanceLabel: 'I agree' },
        ja: { title: 'タイトル', body: '本文', acceptanceLabel: '同意します' },
      })
    })
  })
})
