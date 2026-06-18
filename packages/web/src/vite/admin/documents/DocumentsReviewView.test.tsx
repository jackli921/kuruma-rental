import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { DocumentsReviewView } from './DocumentsReviewView'
import type { AdminDocumentDto } from './api'

const doc = (id: string, renterId: string): AdminDocumentDto => ({
  id,
  renterId,
  type: 'IDP',
  status: 'PENDING',
  expiryDate: null,
  verifiedAt: null,
  rejectionReason: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
})

function renderView(documents: AdminDocumentDto[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <DocumentsReviewView documents={documents} onVerify={vi.fn()} />
    </IntlProvider>,
  )
}

describe('DocumentsReviewView', () => {
  it('shows the empty state when nothing awaits review', () => {
    renderView([])
    expect(screen.queryByText(en.admin.documents.empty)).not.toBeNull()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('renders one review card per pending document', () => {
    renderView([doc('d1', 'renter_1'), doc('d2', 'renter_2')])
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByText('renter_1')).not.toBeNull()
    expect(screen.queryByText('renter_2')).not.toBeNull()
  })
})
