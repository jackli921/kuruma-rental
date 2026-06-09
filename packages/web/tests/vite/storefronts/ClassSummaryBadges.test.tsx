import { ClassSummaryBadges } from '@/vite/storefronts/ClassSummaryBadges'
import type { ClassSummaryData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function renderBadges(summaries: ClassSummaryData[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ClassSummaryBadges summaries={summaries} />
    </IntlProvider>,
  )
}

describe('ClassSummaryBadges', () => {
  it('uses the operator label and count when there is no ACRISS code', () => {
    renderBadges([{ acrissCode: null, label: 'Compact', availableCount: 4 }])
    expect(screen.getByText('Compact ×4')).toBeInTheDocument()
  })

  it('falls back to the label when the ACRISS code is outside the dictionary (#388)', () => {
    renderBadges([{ acrissCode: 'ZZZZ', label: 'Minivan', availableCount: 2 }])
    expect(screen.getByText('Minivan ×2')).toBeInTheDocument()
  })
})
