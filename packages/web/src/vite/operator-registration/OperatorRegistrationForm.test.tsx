import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'
import { OperatorRegistrationForm } from './OperatorRegistrationForm'

const T = enMessages.business.register.form
function renderForm() {
  const onSubmit = vi.fn()
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <OperatorRegistrationForm onSubmit={onSubmit} isSubmitting={false} />
    </IntlProvider>,
  )
  return { onSubmit }
}

describe('OperatorRegistrationForm', () => {
  it('submits normalized values when required fields are filled', async () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'Osaka Rentals' } })
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
    fireEvent.change(screen.getByLabelText(T.contactEmail), {
      target: { value: 'Aiko@Example.com' },
    })
    fireEvent.change(screen.getByLabelText(T.contactPhone), { target: { value: '+81 90' } })
    fireEvent.change(screen.getByLabelText(T.serviceArea), { target: { value: 'Osaka' } })
    fireEvent.change(screen.getByLabelText(T.fleetSize), { target: { value: '6-20' } })
    fireEvent.click(screen.getByLabelText(T.consent))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      contactEmail: 'aiko@example.com',
      estimatedFleetSize: '6-20',
      submittedLocale: 'en',
    })
  })
  it('does not submit without consent', async () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'Osaka Rentals' } })
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
    fireEvent.change(screen.getByLabelText(T.contactEmail), {
      target: { value: 'aiko@example.com' },
    })
    fireEvent.change(screen.getByLabelText(T.contactPhone), { target: { value: '+81 90' } })
    fireEvent.change(screen.getByLabelText(T.serviceArea), { target: { value: 'Osaka' } })
    fireEvent.change(screen.getByLabelText(T.fleetSize), { target: { value: '6-20' } })
    // consent checkbox intentionally left unchecked
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await waitFor(() =>
      expect(screen.getByLabelText(T.consent)).toHaveAttribute('aria-invalid', 'true'),
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
