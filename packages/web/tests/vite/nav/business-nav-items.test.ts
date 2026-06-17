import { businessNavItems } from '@/vite/nav/business-nav-items'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

// businessNavItems is now the single source of truth for the operator nav: both
// Navbar's rendered list and MobileMenu's `NavTo` union derive from it (#603).
// These guard the two ways the array can silently break a consumer — a dropped
// /manage route, or a labelKey that has no matching `nav` i18n entry (renders a
// raw key in the navbar).
describe('businessNavItems', () => {
  it('lists every operator-portal route in display order', () => {
    expect(businessNavItems.map((item) => item.to)).toEqual([
      '/$locale/dashboard',
      '/$locale/manage/bookings',
      '/$locale/manage/fleet',
      '/$locale/manage/classes',
      '/$locale/manage/locations',
      '/$locale/manage/insurance',
      '/$locale/manage/fees',
      '/$locale/manage/add-ons',
      '/$locale/manage/team',
      '/$locale/manage/settings',
    ])
  })

  it('pairs every route with an existing `nav` i18n key', () => {
    for (const item of businessNavItems) {
      expect(en.nav[item.labelKey as keyof typeof en.nav]).toBeTruthy()
    }
  })
})
