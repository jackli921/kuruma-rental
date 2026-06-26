import type { ConsentAcceptanceListItem } from '@kuruma/shared/types/consent-governance'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ConsentGovernanceView } from './ConsentGovernanceView'

function row(over: Partial<ConsentAcceptanceListItem> = {}): ConsentAcceptanceListItem {
  return {
    acceptanceId: 'acc_1',
    userId: 'user_a',
    consentType: 'RENTER_TOS',
    version: '1.0',
    acceptedAt: '2026-03-01T00:00:00.000Z',
    operatorId: null,
    bookingId: null,
    ...over,
  }
}

function renderView(
  acceptances: ConsentAcceptanceListItem[],
  onApplyFilters = vi.fn(),
  filters = {},
) {
  render(
    <IntlProvider locale="en" messages={en}>
      <ConsentGovernanceView
        acceptances={acceptances}
        filters={filters}
        onApplyFilters={onApplyFilters}
      />
    </IntlProvider>,
  )
  return { onApplyFilters }
}

describe('ConsentGovernanceView', () => {
  it('shows the empty state when nothing matches', () => {
    renderView([])
    expect(screen.queryByText(en.admin.governance.empty)).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders one row per acceptance with type, version, and a working evidence link', () => {
    renderView([row(), row({ acceptanceId: 'acc_2', userId: 'user_b', version: '2.0' })])

    const rows = screen.getAllByRole('row')
    // 1 header + 2 data rows.
    expect(rows).toHaveLength(3)

    const firstData = rows[1]
    expect(firstData).toBeDefined()
    if (!firstData) return
    const cells = within(firstData)
    expect(cells.queryByText('user_a')).not.toBeNull()
    expect(cells.queryByText('RENTER_TOS')).not.toBeNull()
    expect(cells.queryByText('1.0')).not.toBeNull()

    const link = cells.getByRole('link', { name: /user_a/ })
    expect(link.getAttribute('href')).toMatch(/\/admin\/consent\/acceptances\/acc_1\/evidence$/)
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('applies the consent-type filter immediately on select', () => {
    const { onApplyFilters } = renderView([row()])
    fireEvent.change(screen.getByLabelText(en.admin.governance.filterType), {
      target: { value: 'PRIVACY_POLICY' },
    })
    expect(onApplyFilters).toHaveBeenCalledWith({ consentType: 'PRIVACY_POLICY' })
  })

  it('commits the user-id filter on submit, dropping blank fields', () => {
    const { onApplyFilters } = renderView([row()])
    fireEvent.change(screen.getByLabelText(en.admin.governance.filterUser), {
      target: { value: 'user_z' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.admin.governance.apply }))
    expect(onApplyFilters).toHaveBeenCalledWith({ userId: 'user_z' })
  })
})
