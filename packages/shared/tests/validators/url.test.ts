import { describe, expect, it } from 'vitest'
import { HTTP_URL_MESSAGE, httpUrlMax } from '../../src/validators/url'

function firstError(schema: ReturnType<typeof httpUrlMax>, value: unknown): string {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('expected a validation failure')
  return result.error.issues[0]?.message ?? ''
}

describe('httpUrlMax(maxLen)', () => {
  it('accepts an https URL within the length cap', () => {
    expect(httpUrlMax(2048).safeParse('https://cdn.example.com/car.jpg')).toMatchObject({
      success: true,
    })
  })

  it('accepts a plain http URL', () => {
    expect(httpUrlMax(2048).safeParse('http://example.com/x').success).toBe(true)
  })

  it('rejects a non-http(s) scheme with the shared http(s) message (the #967 refine rides)', () => {
    // r2:/data:/javascript: are the photo-spoof / XSS vectors bare .url() admits.
    expect(firstError(httpUrlMax(2048), 'r2://bucket/key')).toBe(HTTP_URL_MESSAGE)
    expect(firstError(httpUrlMax(2048), 'javascript:alert(1)')).toBe(HTTP_URL_MESSAGE)
  })

  it('rejects a URL longer than the cap — the .max() applies before the refine', () => {
    const tooLong = `https://example.com/${'a'.repeat(2100)}`
    expect(tooLong.length).toBeGreaterThan(2048)
    expect(httpUrlMax(2048).safeParse(tooLong).success).toBe(false)
  })

  it('honours a custom cap independent of the refine', () => {
    expect(httpUrlMax(10).safeParse('https://example.com/still-valid-url').success).toBe(false)
  })

  it('rejects a non-URL string', () => {
    expect(httpUrlMax(2048).safeParse('not a url').success).toBe(false)
  })
})
