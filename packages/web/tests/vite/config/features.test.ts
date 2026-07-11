import {
  isCancellationEnabled,
  isFleetTimelineEnabled,
  isMessagingEnabled,
  isMultiCurrencyEnabled,
  isOperatorBlocksEnabled,
  isOperatorManualBookingEnabled,
  isOperatorSettingsEnabled,
  isOperatorTeamEnabled,
  isRenterDocumentsEnabled,
  isReviewsEnabled,
} from '@/vite/config/features'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Every post-MVP feature ships OFF for the beta demo and turns on only for the
// exact string 'true'. One table drives them all so a newly added flag can't skip
// the fail-safe (a billable feature leaking on by accident).
const FLAGS = [
  { name: 'VITE_FEATURE_CANCELLATION', read: isCancellationEnabled },
  { name: 'VITE_FEATURE_OPERATOR_MANUAL_BOOKING', read: isOperatorManualBookingEnabled },
  { name: 'VITE_FEATURE_OPERATOR_BLOCKS', read: isOperatorBlocksEnabled },
  { name: 'VITE_FEATURE_OPERATOR_TEAM', read: isOperatorTeamEnabled },
  { name: 'VITE_FEATURE_OPERATOR_SETTINGS', read: isOperatorSettingsEnabled },
  { name: 'VITE_FEATURE_RENTER_DOCUMENTS', read: isRenterDocumentsEnabled },
  { name: 'VITE_FEATURE_MESSAGING', read: isMessagingEnabled },
  { name: 'VITE_FEATURE_REVIEWS', read: isReviewsEnabled },
  { name: 'VITE_FEATURE_FLEET_TIMELINE', read: isFleetTimelineEnabled },
  { name: 'VITE_FEATURE_MULTI_CURRENCY', read: isMultiCurrencyEnabled },
] as const

describe('post-MVP feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  for (const { name, read } of FLAGS) {
    it(`${name} is OFF (beta MVP default) when unset`, () => {
      vi.stubEnv(name, undefined)
      expect(read()).toBe(false)
    })

    it(`${name} is ON only for the exact string "true"`, () => {
      vi.stubEnv(name, 'true')
      expect(read()).toBe(true)
    })

    it(`${name} stays OFF for a typo'd / mis-cased / empty value (fail-safe)`, () => {
      for (const value of ['false', '1', 'TRUE', 'yes', ' true ', '']) {
        vi.stubEnv(name, value)
        expect(read()).toBe(false)
      }
    })
  }
})
