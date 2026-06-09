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

  // #457 D6: surface the class-default luggage so renters compare storefronts at a
  // glance. The chip stays compact (briefcase + count); the full "{n} bags · {size}"
  // rides along in the title.
  it('surfaces the class luggage count + size in the badge title for comparison', () => {
    renderBadges([
      {
        acrissCode: null,
        label: 'Compact',
        availableCount: 2,
        luggageCapacity: 4,
        luggageSize: 'LARGE',
      },
    ])
    expect(screen.getByText('Compact ×2')).toBeInTheDocument()
    expect(screen.getByTitle('4 bags · Large')).toBeInTheDocument()
  })

  it('omits the size from the title when the class default size is unknown', () => {
    renderBadges([
      {
        acrissCode: null,
        label: 'Compact',
        availableCount: 2,
        luggageCapacity: 4,
        luggageSize: null,
      },
    ])
    expect(screen.getByTitle('4 bags')).toBeInTheDocument()
  })

  it('renders no luggage indicator when capacity is unknown', () => {
    renderBadges([
      {
        acrissCode: null,
        label: 'Compact',
        availableCount: 2,
        luggageCapacity: null,
        luggageSize: null,
      },
    ])
    expect(screen.getByText('Compact ×2')).toBeInTheDocument()
    expect(screen.queryByTitle(/bags/)).toBeNull()
  })
})
