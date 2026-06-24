import { describe, expect, it } from 'vitest'
import { ConsentGateService } from './consent-gate'

function svc(missing: string[]) {
  return new ConsentGateService({
    getRequiredReconsents: async () => missing as never,
  } as never)
}
const NOW = new Date('2026-06-15Z')

describe('ConsentGateService.assertSubjectCurrent', () => {
  it('allows a current subject', async () => {
    expect(await svc([]).assertSubjectCurrent('user_1', 'RENTER', NOW)).toEqual({ allowed: true })
  })

  it('denies with CONSENT_REQUIRED + the missing types', async () => {
    expect(await svc(['RENTER_TOS']).assertSubjectCurrent('user_1', 'RENTER', NOW)).toEqual({
      allowed: false,
      code: 'CONSENT_REQUIRED',
      status: 403,
      missing: ['RENTER_TOS'],
    })
  })
})
