import {
  type BusinessNavFlags,
  businessNavItems,
  visibleBusinessNavItems,
} from '@/vite/nav/business-nav-items'
import type { UserRole } from '@kuruma/shared/auth/roles'
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
      '/$locale/manage/terms',
      '/$locale/manage/fees',
      '/$locale/manage/add-ons',
      '/$locale/manage/messages',
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

// The visibility filter is a pure function (#1322): effective flags are injected, so
// this is a provider-free truth table; the runtime-override wiring is proven at the
// component/route layer. Beta default = every gated flag off.
const ALL_OFF: BusinessNavFlags = {
  messaging: false,
  operatorTeam: false,
  operatorSettings: false,
  operatorTerms: false,
}

// The eight always-on operator items, in render order (dashboard through add-ons).
// `terms` is flag-gated (OPERATOR_TERMS, dark until Slice B) and sits inline after
// insurance, so it is absent here and appears mid-list only when its flag is on.
const BASE = [
  '/$locale/dashboard',
  '/$locale/manage/bookings',
  '/$locale/manage/fleet',
  '/$locale/manage/classes',
  '/$locale/manage/locations',
  '/$locale/manage/insurance',
  '/$locale/manage/fees',
  '/$locale/manage/add-ons',
]

const tos = (role: UserRole | undefined, flags: BusinessNavFlags = ALL_OFF): readonly string[] =>
  visibleBusinessNavItems(role, flags).map((item) => item.to)

describe('visibleBusinessNavItems', () => {
  it('shows an operator only the always-on items in beta (messages/team/settings flags off)', () => {
    expect(tos('OPERATOR_OWNER')).toEqual(BASE)
  })

  it('shows every operator item once all four gated flags are on', () => {
    expect(
      tos('OPERATOR_OWNER', {
        messaging: true,
        operatorTeam: true,
        operatorSettings: true,
        operatorTerms: true,
      }),
    ).toEqual(businessNavItems.map((item) => item.to))
  })

  it('reveals Terms inline after insurance when just the terms flag is on', () => {
    expect(
      tos('OPERATOR_OWNER', {
        messaging: false,
        operatorTeam: false,
        operatorSettings: false,
        operatorTerms: true,
      }),
    ).toEqual([
      '/$locale/dashboard',
      '/$locale/manage/bookings',
      '/$locale/manage/fleet',
      '/$locale/manage/classes',
      '/$locale/manage/locations',
      '/$locale/manage/insurance',
      '/$locale/manage/terms',
      '/$locale/manage/fees',
      '/$locale/manage/add-ons',
    ])
  })

  it('shows the platform admin Messages via the bypass but NOT team/settings (flag-only, no bypass)', () => {
    expect(tos('PLATFORM_ADMIN')).toEqual([...BASE, '/$locale/manage/messages'])
  })

  it('reveals only Team when just the team flag is on', () => {
    expect(
      tos('OPERATOR_OWNER', {
        messaging: false,
        operatorTeam: true,
        operatorSettings: false,
        operatorTerms: false,
      }),
    ).toEqual([...BASE, '/$locale/manage/team'])
  })

  it('reveals only Settings when just the settings flag is on', () => {
    expect(
      tos('OPERATOR_OWNER', {
        messaging: false,
        operatorTeam: false,
        operatorSettings: true,
        operatorTerms: false,
      }),
    ).toEqual([...BASE, '/$locale/manage/settings'])
  })

  it('reveals Messages to an operator once the messaging flag is on', () => {
    expect(
      tos('OPERATOR_OWNER', {
        messaging: true,
        operatorTeam: false,
        operatorSettings: false,
        operatorTerms: false,
      }),
    ).toEqual([...BASE, '/$locale/manage/messages'])
  })
})
