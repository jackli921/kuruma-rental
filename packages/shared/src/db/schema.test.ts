import { describe, expect, it } from 'vitest'
import { consentDocStatusEnum, consentMethodEnum, consentTypeEnum } from './consent'

describe('schema pgEnum tripwires', () => {
  it('registers the consent pg enums', () => {
    expect(consentTypeEnum.enumValues).toEqual([
      'RENTER_TOS',
      'PRIVACY_POLICY',
      'RENTER_LIABILITY',
      'OPERATOR_AGREEMENT',
    ])
    expect(consentDocStatusEnum.enumValues).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
    expect(consentMethodEnum.enumValues).toEqual(['CLICKWRAP', 'ESIGN', 'IMPORTED'])
  })
})
