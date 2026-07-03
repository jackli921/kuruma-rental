import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('reveals every approved invite link, so approving a second row never drops the first', () => {
    renderView([app('a1', 'Osaka Cars'), app('a2', 'Kyoto Wheels')], {
      approvedInvites: { a1: '/provider/invite/tok_a1', a2: '/provider/invite/tok_a2' },
    })
    expect(screen.getByDisplayValue('/provider/invite/tok_a1')).not.toBeNull()
    expect(screen.getByDisplayValue('/provider/invite/tok_a2')).not.toBeNull()
  })

  it('calls onRemint with the row id when its Regenerate button is clicked', async () => {
    const onRemint = vi.fn()
    renderView([app('a1', 'Osaka Cars')], {
      approvedInvites: { a1: '/provider/invite/tok_a1' },
      onRemint,
    })
    await userEvent.click(screen.getByRole('button', { name: en.admin.applications.regenerate }))
    expect(onRemint).toHaveBeenCalledWith('a1')
  })

  it('shows the remint error only on the matching row', () => {
    renderView([app('a1', 'Osaka Cars'), app('a2', 'Kyoto Wheels')], {
      approvedInvites: { a1: '/provider/invite/tok_a1', a2: '/provider/invite/tok_a2' },
      onRemint: vi.fn(),
      remintErrorId: 'a2',
    })
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent(en.admin.applications.regenerateFailed)
  })
})
