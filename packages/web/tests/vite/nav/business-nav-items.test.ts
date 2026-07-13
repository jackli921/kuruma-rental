import {
  type BusinessNavFlags,
  businessNavGroupOrder,
  businessNavItems,
  visibleBusinessNavGroups,
  visibleBusinessNavItems,
} from '@/vite/nav/business-nav-items'
import type { UserRole } from '@kuruma/shared/auth/roles'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import zh from '../../../messages/zh.json'

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
      '/$locale/manage/combo-deals',
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

  // The sidebar renders these three group headers; a renamed key or a locale that
  // dropped one would surface a raw key (e.g. `groupCatalog`) in the UI with nothing
  // else to catch it. The missing list is `locale.nav.key` strings so a failure names
  // exactly which locale/key is absent.
  it('pairs every nav group header with an i18n key present in en, ja, and zh', () => {
    const navByLocale: Record<string, Record<string, unknown>> = {
      en: en.nav,
      ja: ja.nav,
      zh: zh.nav,
    }
    const missing = Object.entries(navByLocale).flatMap(([locale, nav]) =>
      businessNavGroupOrder.filter((key) => !nav[key]).map((key) => `${locale}.nav.${key}`),
    )
    expect(missing).toEqual([])
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

// The nine always-on operator items, in render order (dashboard through add-ons).
// `terms` is flag-gated (OPERATOR_TERMS, dark until Slice B) and sits inline after
// insurance, so it is absent here and appears mid-list only when its flag is on.
// combo-deals (#464) is unflagged, so it sits inline after fees here.
const BASE = [
  '/$locale/dashboard',
  '/$locale/manage/bookings',
  '/$locale/manage/fleet',
  '/$locale/manage/classes',
  '/$locale/manage/locations',
  '/$locale/manage/insurance',
  '/$locale/manage/fees',
  '/$locale/manage/combo-deals',
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
      '/$locale/manage/combo-deals',
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

// The sidebar renders the same routes as labelled sections; grouping is derived from
// the flat list + navGroupOf, so these guard the section taxonomy and that grouping
// can never drop, duplicate, or empty a section as flags flip.
const ALL_ON: BusinessNavFlags = {
  messaging: true,
  operatorTeam: true,
  operatorSettings: true,
  operatorTerms: true,
}

const labelsByGroup = (
  role: UserRole | undefined,
  flags: BusinessNavFlags,
): Record<string, readonly string[]> =>
  Object.fromEntries(
    visibleBusinessNavGroups(role, flags).map((group) => [
      group.labelKey,
      group.items.map((item) => item.labelKey),
    ]),
  )

describe('visibleBusinessNavGroups', () => {
  it('sorts every route into operations / catalog / setup, in that section order', () => {
    const groups = visibleBusinessNavGroups('PLATFORM_ADMIN', ALL_ON)
    expect(groups.map((group) => group.labelKey)).toEqual([
      'groupOperations',
      'groupCatalog',
      'groupSetup',
    ])
    const byGroup = labelsByGroup('PLATFORM_ADMIN', ALL_ON)
    expect(byGroup.groupOperations).toEqual(['dashboard', 'bookings', 'messages'])
    expect(byGroup.groupCatalog).toEqual(['fleet', 'classes', 'locations'])
    expect(byGroup.groupSetup).toEqual([
      'insurance',
      'terms',
      'fees',
      'comboDeals',
      'addOns',
      'team',
      'settings',
    ])
  })

  it('drops gated items from a section but keeps the section (beta operator)', () => {
    const byGroup = labelsByGroup('OPERATOR_OWNER', ALL_OFF)
    // messaging off -> Messages leaves Operations, which keeps Dashboard + Bookings.
    expect(byGroup.groupOperations).toEqual(['dashboard', 'bookings'])
    // terms/team/settings off -> Setup keeps only its always-on items.
    expect(byGroup.groupSetup).toEqual(['insurance', 'fees', 'comboDeals', 'addOns'])
  })

  it('previews Messages under Operations for the platform admin with messaging off', () => {
    expect(labelsByGroup('PLATFORM_ADMIN', ALL_OFF).groupOperations).toEqual([
      'dashboard',
      'bookings',
      'messages',
    ])
  })

  it('never emits an empty section and never drops or duplicates a visible route', () => {
    const cases: ReadonlyArray<readonly [UserRole | undefined, BusinessNavFlags]> = [
      ['OPERATOR_OWNER', ALL_OFF],
      ['PLATFORM_ADMIN', ALL_ON],
      [undefined, ALL_OFF],
    ]
    for (const [role, flags] of cases) {
      const groups = visibleBusinessNavGroups(role, flags)
      for (const group of groups) expect(group.items.length).toBeGreaterThan(0)
      const grouped = groups.flatMap((group) => group.items.map((item) => item.to))
      const flat = visibleBusinessNavItems(role, flags).map((item) => item.to)
      expect(new Set(grouped)).toEqual(new Set(flat))
      expect(grouped).toHaveLength(flat.length)
    }
  })

  it('assigns a section to every route so grouping can never silently drop one', () => {
    const grouped = visibleBusinessNavGroups('PLATFORM_ADMIN', ALL_ON).flatMap((group) =>
      group.items.map((item) => item.to),
    )
    expect(new Set(grouped)).toEqual(new Set(businessNavItems.map((item) => item.to)))
  })
})
