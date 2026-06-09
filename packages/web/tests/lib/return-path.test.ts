import { safeReturnPath } from '@/lib/return-path'
import { describe, expect, test } from 'vitest'

describe('safeReturnPath (web boundary guard)', () => {
  test.each([
    '/en/bookings/new',
    '/en/bookings/new?from=2026-06-10T09:00&to=2026-06-12T09:00',
    '/',
    '/ja/storefronts/abc#section',
  ])('accepts local path %j', (input) => {
    expect(safeReturnPath(input)).toBe(input)
  })

  test.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative deep', '//evil.com/en'],
    ['http absolute', 'http://evil.com'],
    ['https absolute', 'https://evil.com'],
    ['slash-backslash', '/\\evil.com'],
    ['double-backslash', '\\\\evil.com'],
    ['backslash mid-path', '/en\\evil'],
    ['no leading slash', 'evil.com'],
    ['scheme js', 'javascript:alert(1)'],
    ['CRLF header injection', '/en/x\r\nHost: evil'],
    ['empty', ''],
    ['undefined', undefined],
    ['over-long', `/${'a'.repeat(600)}`],
  ])('rejects %s', (_label, input) => {
    expect(safeReturnPath(input as string | undefined)).toBeUndefined()
  })
})
