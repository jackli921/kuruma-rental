import { PreAuthHandoffCard } from '@/vite/bookings/PreAuthHandoffCard'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const baseProps = {
  title: 'Secure your booking',
  explain: 'Your operator places a temporary hold.',
  ctaLabel: 'Complete pre-authorization',
  cancellationContact: 'To change, contact Best Car Rental.',
}

describe('PreAuthHandoffCard', () => {
  it('renders nothing when the operator has no pre-auth URL', () => {
    const { container } = render(<PreAuthHandoffCard url={null} {...baseProps} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the copy and an external link to the operator pre-auth page', () => {
    render(<PreAuthHandoffCard url="https://op.example/preauth" {...baseProps} />)

    expect(screen.getByText('Secure your booking')).toBeInTheDocument()
    expect(screen.getByText('Your operator places a temporary hold.')).toBeInTheDocument()
    expect(screen.getByText('To change, contact Best Car Rental.')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /Complete pre-authorization/ })
    expect(link).toHaveAttribute('href', 'https://op.example/preauth')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
