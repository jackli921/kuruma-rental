import { Route } from '@/routes/$locale/provider/login'
import { describe, expect, it } from 'vitest'

// The OAuth callback bounces a failed provider attempt to this page with a
// server-controlled `?error=` discriminant (auth.ts §6). validateSearch is the
// trust boundary: only the two known literals survive; anything else is dropped
// so the page can never be steered into an arbitrary error state.
const validateSearch = Route.options.validateSearch as (search: Record<string, unknown>) => {
  error?: 'access_not_found' | 'invite_invalid'
}

describe('/$locale/provider/login validateSearch', () => {
  it('keeps a known provider access error', () => {
    expect(validateSearch({ error: 'access_not_found' })).toEqual({ error: 'access_not_found' })
    expect(validateSearch({ error: 'invite_invalid' })).toEqual({ error: 'invite_invalid' })
  })

  it('drops unknown, malformed, or absent error values', () => {
    expect(validateSearch({ error: 'nope' })).toEqual({})
    expect(validateSearch({ error: 123 })).toEqual({})
    expect(validateSearch({ error: '' })).toEqual({})
    expect(validateSearch({})).toEqual({})
  })
})
