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

function renderView(applications: OperatorApplicationDto[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ApplicationsReviewView applications={applications} onReject={vi.fn()} />
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
})
