import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('smoke test', () => {
  it('cn utility merges classnames', () => {
    const result = cn('text-red-500', 'text-blue-500')
    expect(result).toBe('text-blue-500')
  })
})
