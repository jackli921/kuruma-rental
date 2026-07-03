import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ApplicationReviewCard } from './ApplicationReviewCard'
import type { OperatorApplicationDto } from './api'

const application: OperatorApplicationDto = {
  id: 'app_1',
  businessName: 'Osaka Cars',
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
}

function renderCard(props: Partial<Parameters<typeof ApplicationReviewCard>[0]> = {}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ApplicationReviewCard
        application={application}
        onReject={vi.fn()}
        onApprove={vi.fn()}
        {...props}
      />
    </IntlProvider>,
  )
}

describe('ApplicationReviewCard', () => {
  it('renders business name and contact email', () => {
    renderCard()
    expect(screen.queryByText('Osaka Cars')).not.toBeNull()
    expect(screen.queryByText('taro@example.com')).not.toBeNull()
  })

  it('renders a localized fleet-size label, never the raw enum value', () => {
    renderCard()
    expect(screen.queryByText('6-20 vehicles')).not.toBeNull()
    expect(screen.queryByText('6-20')).toBeNull()
  })

  it('disables the Reject button when the textarea is empty', () => {
    renderCard()
    const button = screen.getByRole('button', { name: en.admin.applications.reject })
    expect(button).toBeDisabled()
  })

  it('enables the Reject button and calls onReject with trimmed reason after typing', async () => {
    const onReject = vi.fn()
    renderCard({ onReject })
    const textarea = screen.getByRole('textbox')
    const button = screen.getByRole('button', { name: en.admin.applications.reject })

    await userEvent.type(textarea, '  not enough info  ')
    expect(button).not.toBeDisabled()

    await userEvent.click(button)
    expect(onReject).toHaveBeenCalledWith('not enough info')
  })

  it('renders optional business details and a safe http website link', () => {
    renderCard({
      application: {
        ...application,
        businessType: 'COMPANY',
        message: 'We run a fleet in Kansai.',
        website: 'https://osaka-cars.example.com',
      },
    })
    // Business type renders as a localized label, not the raw enum value.
    expect(screen.queryByText('Company')).not.toBeNull()
    expect(screen.queryByText('COMPANY')).toBeNull()
    expect(screen.queryByText('We run a fleet in Kansai.')).not.toBeNull()
    const link = screen.getByRole('link', { name: 'https://osaka-cars.example.com' })
    expect(link).toHaveAttribute('href', 'https://osaka-cars.example.com')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('renders a non-http website as plain text, never as a link (XSS sink guard)', () => {
    renderCard({
      application: { ...application, website: 'javascript:alert(1)' },
    })
    // The value is shown for the admin to see, but must not become a clickable href.
    expect(screen.queryByText('javascript:alert(1)')).not.toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('announces the reject error to assistive tech via role=alert', () => {
    renderCard({ error: en.admin.applications.error })
    expect(screen.getByRole('alert')).toHaveTextContent(en.admin.applications.error)
  })

  it('renders an Approve button and calls onApprove when clicked', async () => {
    const onApprove = vi.fn()
    renderCard({ onApprove })
    const approveBtn = screen.getByRole('button', { name: en.admin.applications.approve })
    expect(approveBtn).not.toBeDisabled()
    await userEvent.click(approveBtn)
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('when inviteUrl is set, renders the readonly invite input and copy button, hides Approve/Reject', () => {
    renderCard({ inviteUrl: '/provider/invite/tok_abc' })
    // Readonly invite input is visible
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('/provider/invite/tok_abc')
    // Copy button present
    expect(screen.getByRole('button', { name: en.admin.applications.copy })).not.toBeNull()
    // Approve and Reject buttons must not be rendered in the terminal state
    expect(screen.queryByRole('button', { name: en.admin.applications.approve })).toBeNull()
    expect(screen.queryByRole('button', { name: en.admin.applications.reject })).toBeNull()
  })

  it('when approveError is set, shows it via role=alert', () => {
    renderCard({ approveError: en.admin.applications.alreadyReviewed })
    const alerts = screen.getAllByRole('alert')
    const texts = alerts.map((el) => el.textContent)
    expect(texts.some((t) => t?.includes(en.admin.applications.alreadyReviewed))).toBe(true)
  })

  it('in the reveal state, renders a Regenerate button that calls onRemint when clicked', async () => {
    const onRemint = vi.fn()
    renderCard({ inviteUrl: '/provider/invite/tok_abc', onRemint })
    const button = screen.getByRole('button', { name: en.admin.applications.regenerate })
    await userEvent.click(button)
    expect(onRemint).toHaveBeenCalledTimes(1)
  })

  it('disables the Regenerate button and shows a pending label while reminting', () => {
    renderCard({ inviteUrl: '/provider/invite/tok_abc', onRemint: vi.fn(), isReminting: true })
    const button = screen.getByRole('button', { name: en.admin.applications.regenerating })
    expect(button).toBeDisabled()
  })

  it('announces a remint error via role=alert in the reveal state', () => {
    renderCard({
      inviteUrl: '/provider/invite/tok_abc',
      onRemint: vi.fn(),
      remintError: en.admin.applications.regenerateFailed,
    })
    const alerts = screen.getAllByRole('alert')
    expect(
      alerts.some((el) => el.textContent?.includes(en.admin.applications.regenerateFailed)),
    ).toBe(true)
  })

  it('omits the Regenerate button when no onRemint handler is provided', () => {
    renderCard({ inviteUrl: '/provider/invite/tok_abc' })
    expect(screen.queryByRole('button', { name: en.admin.applications.regenerate })).toBeNull()
  })
})
