import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ApplicationsReviewView } from './ApplicationsReviewView'
import type { OperatorApplicationDto } from './api'

const app = (id: string, businessName: string): OperatorApplicationDto => ({
  id,
  businessName,
  contactName: 'Taro Yamada',
  contactEmail: 'taro@example.com',
  contactPhone: '+81-6-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  website: null,
  businessLicenseNumber: null,
  businessType: null,
  message: null,
  submittedLocale: 'en',
  status: 'PENDING',
  rejectionReason: null,
  reviewedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
})

function renderView(
  applications: OperatorApplicationDto[],
  props: Partial<Parameters<typeof ApplicationsReviewView>[0]> = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ApplicationsReviewView
        applications={applications}
        onReject={vi.fn()}
        onApprove={vi.fn()}
        {...props}
      />
    </IntlProvider>,
  )
}

describe('ApplicationsReviewView', () => {
  it('shows the empty state when nothing awaits review', () => {
    renderView([])
    expect(screen.queryByText(en.admin.applications.empty)).not.toBeNull()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('renders one review card per pending application', () => {
    renderView([app('a1', 'Osaka Cars'), app('a2', 'Kyoto Wheels')])
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByText('Osaka Cars')).not.toBeNull()
    expect(screen.queryByText('Kyoto Wheels')).not.toBeNull()
  })

  it('shows the already-reviewed message on the matching card for a 409 approval error', () => {
    renderView([app('a1', 'Osaka Cars')], {
      approveError: { id: 'a1', alreadyReviewed: true },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(en.admin.applications.alreadyReviewed)
  })

  it('shows the generic retry message on the matching card for a non-409 approval error', () => {
    renderView([app('a1', 'Osaka Cars')], {
      approveError: { id: 'a1', alreadyReviewed: false },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(en.admin.applications.approveFailed)
  })

  it('shows the plain Approved confirmation for every approved id, so approving a second row never drops the first', () => {
    renderView([app('a1', 'Osaka Cars'), app('a2', 'Kyoto Wheels')], {
      approvedIds: new Set(['a1', 'a2']),
    })
    // Both cards show the approved confirmation text
    expect(screen.getAllByText(en.admin.applications.approved)).toHaveLength(2)
    // No invite link inputs anywhere
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a card whose id is NOT in approvedIds still shows normal controls', () => {
    renderView([app('a1', 'Osaka Cars'), app('a2', 'Kyoto Wheels')], {
      approvedIds: new Set(['a1']),
    })
    // a1 approved, a2 not
    expect(screen.getAllByText(en.admin.applications.approved)).toHaveLength(1)
    // a2 still has an Approve button
    expect(screen.getAllByRole('button', { name: en.admin.applications.approve })).toHaveLength(1)
  })
})
