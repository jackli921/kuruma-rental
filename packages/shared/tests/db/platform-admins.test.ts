import { describe, expect, test } from 'vitest'
import { parsePlatformAdminEmails } from '../../src/db/platform-admins'

describe('parsePlatformAdminEmails', () => {
  test('returns [] for undefined or empty', () => {
    expect(parsePlatformAdminEmails(undefined)).toEqual([])
    expect(parsePlatformAdminEmails('')).toEqual([])
    expect(parsePlatformAdminEmails('   ')).toEqual([])
  })

  test('splits on comma, trims, and lowercases', () => {
    expect(parsePlatformAdminEmails('A@x.com, B@Y.COM ')).toEqual(['a@x.com', 'b@y.com'])
  })

  test('drops empty segments and de-duplicates', () => {
    expect(parsePlatformAdminEmails('a@x.com,,a@x.com, ,c@x.com')).toEqual(['a@x.com', 'c@x.com'])
  })
})
