import { formatJpy } from '@/lib/format'
import type { AdminOverview } from '@kuruma/shared/types/admin-overview'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { AdminHomeView } from './AdminHomeView'

const OVERVIEW: AdminOverview = {
  bookings: 128,
  gmvJpy: 4_560_000,
  fleet: 42,
  operators: 7,
  unresolvedAnomalies: 2,
  pendingDocs: 5,
}

function renderView(overview: AdminOverview = OVERVIEW) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <AdminHomeView overview={overview} />
    </IntlProvider>,
  )
}

const KPI = en.admin.home.kpi

describe('AdminHomeView', () => {
  it('renders all six KPI labels', () => {
    renderView()
    for (const label of Object.values(KPI)) {
      expect(screen.getByText(label)).not.toBeNull()
    }
  })

  it('renders each KPI value, formatting GMV as yen and counts grouped', () => {
    renderView()
    // Counts are locale-grouped (en-US): 128, 42, 7.
    expect(screen.getByText('128')).not.toBeNull()
    expect(screen.getByText('42')).not.toBeNull()
    expect(screen.getByText('7')).not.toBeNull()
    // GMV is yen-formatted (not the bare 4560000), via the shared formatter so the
    // assertion tracks the runtime's currency glyph rather than hard-coding it.
    expect(screen.getByText(formatJpy(OVERVIEW.gmvJpy))).not.toBeNull()
    expect(screen.queryByText('4560000')).toBeNull()
  })

  it('pairs the GMV label with the yen value in the same card', () => {
    renderView()
    const gmvLabel = screen.getByText(KPI.gmv)
    const card = gmvLabel.closest('div')
    expect(card?.textContent).toContain(formatJpy(OVERVIEW.gmvJpy))
  })
})
