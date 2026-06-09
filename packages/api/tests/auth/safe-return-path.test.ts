import { describe, expect, test } from 'vitest'
import { safeReturnPath } from '../../src/auth/google'

describe('safeReturnPath', () => {
  test.each([
    ['/en/bookings/new', '/en/bookings/new'],
    [
      '/en/bookings/new?from=2026-06-10T09:00&to=2026-06-12T09:00',
      '/en/bookings/new?from=2026-06-10T09:00&to=2026-06-12T09:00',
    ],
    ['/', '/'],
    ['/ja/storefronts/abc#section', '/ja/storefronts/abc#section'],
  ])('accepts local path %j', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected)
  })

  test.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative deep', '//evil.com/en/bookings'],
    ['http absolute', 'http://evil.com'],
    ['https absolute', 'https://evil.com'],
    ['slash-backslash', '/\\evil.com'],
    ['double-backslash', '\\\\evil.com'],
    ['backslash mid-path', '/en\\evil'],
    ['no leading slash', 'evil.com'],
    ['scheme-relative js', 'javascript:alert(1)'],
    ['control char (header injection)', '/en/x\r\nHost: evil'],
    ['newline', '/en/x\ny'],
    ['empty', ''],
    ['undefined', undefined],
    ['null', null],
    ['over-long', `/${'a'.repeat(600)}`],
  ])('rejects %s', (_label, input) => {
    expect(safeReturnPath(input as string | null | undefined)).toBeUndefined()
  })
})
