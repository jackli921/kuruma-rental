import { useFeatureFlag } from '@/vite/config'
import type { BusinessNavFlags } from './business-nav-items'
import type { RenterNavFlags } from './renter-nav-items'

// Read the effective (runtime-toggleable) nav flags via useFeatureFlag so a
// dashboard override takes effect live, then hand them to the pure
// visible*NavItems() filters. Kept as hooks (not inline in each component) so
// Navbar and BusinessSidebar share one wiring and can't drift on which flags gate
// which items (#1322).
export function useBusinessNavFlags(): BusinessNavFlags {
  return {
    messaging: useFeatureFlag('MESSAGING'),
    operatorTeam: useFeatureFlag('OPERATOR_TEAM'),
    operatorSettings: useFeatureFlag('OPERATOR_SETTINGS'),
    operatorTerms: useFeatureFlag('OPERATOR_TERMS'),
  }
}

export function useRenterNavFlags(): RenterNavFlags {
  return {
    messaging: useFeatureFlag('MESSAGING'),
    renterDocuments: useFeatureFlag('RENTER_DOCUMENTS'),
  }
}
