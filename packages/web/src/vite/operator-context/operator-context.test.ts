import { describe, expect, it } from 'vitest'
import { buildScopeParam } from './operator-context'

describe('buildScopeParam', () => {
  it('scopes to the picked operator', () => {
    expect(buildScopeParam('op_9')).toBe('operatorId=op_9')
  })
  it('falls back to includeAll when no operator is picked (cross-operator read)', () => {
    expect(buildScopeParam(undefined)).toBe('includeAll=true')
  })
  it('url-encodes the operator id', () => {
    expect(buildScopeParam('a b/c')).toBe('operatorId=a%20b%2Fc')
  })
})
