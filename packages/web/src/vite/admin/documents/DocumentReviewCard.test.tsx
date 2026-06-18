import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { DocumentReviewCard } from './DocumentReviewCard'
import type { AdminDocumentDto } from './api'

const DOC: AdminDocumentDto = {
  id: 'doc_1',
  renterId: 'renter_1',
  type: 'IDP',
  status: 'PENDING',
  expiryDate: null,
  verifiedAt: null,
  rejectionReason: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

function renderCard(overrides: Partial<AdminDocumentDto> = {}) {
  const onSubmit = vi.fn()
  const utils = render(
    <IntlProvider locale="en" messages={en}>
      <DocumentReviewCard document={{ ...DOC, ...overrides }} onSubmit={onSubmit} />
    </IntlProvider>,
  )
  return { onSubmit, ...utils }
}

const T = en.admin.documents

describe('DocumentReviewCard', () => {
  it('shows the renter id, type, and a same-origin scan viewer pointing at the file route', () => {
    renderCard()
    expect(screen.queryByText('renter_1')).not.toBeNull()
    expect(screen.queryByText('IDP')).not.toBeNull()
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/documents/doc_1/file')
  })

  it('approves with the entered expiry date', () => {
    const { onSubmit } = renderCard()
    fireEvent.change(screen.getByLabelText(T.expiryLabel), { target: { value: '2030-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: T.approve }))
    expect(onSubmit).toHaveBeenCalledWith({ status: 'APPROVED', expiryDate: '2030-01-31' })
  })

  it('rejects with the entered reason', () => {
    const { onSubmit } = renderCard()
    fireEvent.change(screen.getByLabelText(T.reasonLabel), { target: { value: 'blurry scan' } })
    fireEvent.click(screen.getByRole('button', { name: T.reject }))
    expect(onSubmit).toHaveBeenCalledWith({ status: 'REJECTED', rejectionReason: 'blurry scan' })
  })

  it('cannot approve without an expiry date', () => {
    const { onSubmit } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: T.approve }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cannot reject without a reason', () => {
    const { onSubmit } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: T.reject }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
