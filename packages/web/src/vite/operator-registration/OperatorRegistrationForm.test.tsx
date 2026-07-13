import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'
import { OperatorRegistrationForm } from './OperatorRegistrationForm'

const T = enMessages.business.register.form
function renderForm(accountEmail = 'account@example.com') {
  const onSubmit = vi.fn()
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <OperatorRegistrationForm
        onSubmit={onSubmit}
        isSubmitting={false}
        accountEmail={accountEmail}
      />
    </IntlProvider>,
  )
  return { onSubmit }
}

describe('OperatorRegistrationForm', () => {
  it('submits normalized values when required fields are filled', async () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'Osaka Rentals' } })
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
    fireEvent.change(screen.getByLabelText(T.contactPhone), { target: { value: '+81 90' } })
    fireEvent.change(screen.getByLabelText(T.serviceArea), { target: { value: 'Osaka' } })
    fireEvent.change(screen.getByLabelText(T.fleetSize), { target: { value: '6-20' } })
    fireEvent.click(screen.getByLabelText(T.consent))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      businessName: 'Osaka Rentals',
      contactName: 'Aiko',
      estimatedFleetSize: '6-20',
      submittedLocale: 'en',
    })
  })

  it('shows the signed-in account email read-only and never submits it', async () => {
    const { onSubmit } = renderForm('real@x.io')
    // The account email renders as a read-only display, not an editable input.
    const emailField = screen.getByLabelText(T.accountEmail) as HTMLInputElement
    expect(emailField).toHaveValue('real@x.io')
    expect(emailField).toHaveAttribute('readonly')
    // The hint tells the user where the value comes from.
    expect(screen.getByText(T.accountEmailHint)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'Osaka Rentals' } })
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
    fireEvent.change(screen.getByLabelText(T.contactPhone), { target: { value: '+81 90' } })
    fireEvent.change(screen.getByLabelText(T.serviceArea), { target: { value: 'Osaka' } })
    fireEvent.change(screen.getByLabelText(T.fleetSize), { target: { value: '6-20' } })
    fireEvent.click(screen.getByLabelText(T.consent))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    // The account email is server-derived — it must not ride in the submit payload.
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('contactEmail')
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('accountEmail')
  })

  it('does not submit without consent', async () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'Osaka Rentals' } })
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
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

  it('shows a localized error linked to the field via aria-describedby (#5/#6)', async () => {
    renderForm()
    // Fill everything except businessName, then submit so only it is invalid.
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
    fireEvent.change(screen.getByLabelText(T.contactPhone), { target: { value: '+81 90' } })
    fireEvent.change(screen.getByLabelText(T.serviceArea), { target: { value: 'Osaka' } })
    fireEvent.change(screen.getByLabelText(T.fleetSize), { target: { value: '6-20' } })
    fireEvent.click(screen.getByLabelText(T.consent))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))

    const businessName = screen.getByLabelText(T.businessName)
    await waitFor(() => expect(businessName).toHaveAttribute('aria-invalid', 'true'))
    // The rendered message is the localized copy, not the raw English Zod message.
    const alert = screen.getByText(T.errors.businessName)
    expect(alert).toHaveAttribute('id', 'reg-businessName-error')
    expect(alert).toHaveAttribute('role', 'alert')
    // ...and the field points assistive tech at it.
    expect(businessName).toHaveAttribute('aria-describedby', 'reg-businessName-error')
  })

  it('gives the fleet-size select a labelled placeholder and marks it required (#11)', () => {
    renderForm()
    const fleet = screen.getByLabelText(T.fleetSize)
    expect(fleet).toHaveAttribute('aria-required', 'true')
    // The empty first option reads as a prompt for screen readers, not a blank line.
    expect(screen.getByRole('option', { name: T.fleetSizePlaceholder })).toBeInTheDocument()
  })
})
