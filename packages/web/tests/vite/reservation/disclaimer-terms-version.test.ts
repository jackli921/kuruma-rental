import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import zh from '../../../messages/zh.json'

// #638: the disclaimer wording below is the consent text stamped under
// `DISCLAIMER_TERMS_VERSION` (packages/api/src/services/booking.ts, currently
// '2026-06-13'). The constant and the copy are coupled by convention only —
// editing the wording without bumping the constant silently mis-stamps
// `disclaimerTermsVersion` on every new booking.
//
// This snapshot is the forcing function: if you change the consent text, this
// test fails. When it does, BUMP `DISCLAIMER_TERMS_VERSION` in the same change
// (and update the expected string here) so the recorded version tracks the copy.
describe('disclaimer consent copy is pinned to DISCLAIMER_TERMS_VERSION (#638)', () => {
  it('canonical (en) terms wording is unchanged', () => {
    expect(en.reservation.disclaimer.terms).toBe(
      'License and International Driving Permit verification is completed in person at pickup, not online. By reserving, you confirm you hold the required documents and accept full responsibility for the vehicle during your rental.',
    )
  })

  it('ja and zh terms wording is unchanged', () => {
    expect(ja.reservation.disclaimer.terms).toBe(
      '運転免許証と国際運転免許証の確認は、オンラインではなく受け取り時に対面で行います。ご予約により、必要書類を所持していることを確認し、レンタル期間中の車両に対する全責任を負うことに同意したものとみなされます。',
    )
    expect(zh.reservation.disclaimer.terms).toBe(
      '驾驶证和国际驾驶许可证的核验将在取车时当面完成，而非在线办理。预订即表示您确认持有所需证件，并同意在租赁期间对车辆承担全部责任。',
    )
  })
})
