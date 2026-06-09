import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SIZE_LABELS: Record<string, string> = { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        classCount: '{label} ×{count}',
        luggage: '{count} bags',
      }
      const template =
        namespace === 'luggageSize' ? (SIZE_LABELS[key] ?? key) : (messages[key] ?? key)
      if (!values) return template
      return Object.entries(values).reduce<string>(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        template,
      )
    }
    t.has = (key: string) => key in SIZE_LABELS
    return t
  },
}))

import { ClassSummaryBadges } from '@/modules/storefronts/components/ClassSummaryBadges'

const compact = { acrissCode: null, label: 'Compact', availableCount: 2 }

describe('ClassSummaryBadges luggage (#457 D6)', () => {
  afterEach(() => {
    cleanup()
  })

  it('still renders the class availability count', () => {
    render(
      <ClassSummaryBadges summaries={[{ ...compact, luggageCapacity: 4, luggageSize: 'LARGE' }]} />,
    )
    expect(screen.getByText('Compact ×2')).toBeInTheDocument()
  })

  it('surfaces the class luggage count + size for comparison', () => {
    render(
      <ClassSummaryBadges summaries={[{ ...compact, luggageCapacity: 4, luggageSize: 'LARGE' }]} />,
    )
    expect(screen.getByTitle('4 bags · Large')).toBeInTheDocument()
  })

  it('omits the size from the title when the class default size is unknown', () => {
    render(
      <ClassSummaryBadges summaries={[{ ...compact, luggageCapacity: 4, luggageSize: null }]} />,
    )
    expect(screen.getByTitle('4 bags')).toBeInTheDocument()
  })

  it('renders no luggage indicator when capacity is unknown', () => {
    render(
      <ClassSummaryBadges summaries={[{ ...compact, luggageCapacity: null, luggageSize: null }]} />,
    )
    expect(screen.getByText('Compact ×2')).toBeInTheDocument()
    expect(screen.queryByTitle(/bags/)).toBeNull()
  })
})
