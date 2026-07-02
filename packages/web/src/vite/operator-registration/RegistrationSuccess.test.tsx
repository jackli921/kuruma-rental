import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { RegistrationSuccess } from './RegistrationSuccess'

function wrap(email: string) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <RegistrationSuccess email={email} />
    </IntlProvider>,
  )
}

afterEach(cleanup)

describe('RegistrationSuccess', () => {
  it('renders the success title from i18n', () => {
    wrap('test@example.com')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      en.business.register.success.title,
    )
  })

  it('interpolates the email into the body copy', () => {
    wrap('owner@acme.co')
    // The ICU template is "Thanks - we'll reach out at {email}."
    expect(screen.getByText(/owner@acme\.co/)).toBeInTheDocument()
  })

  it('does not interpolate a different email into the body', () => {
    wrap('other@example.com')
    expect(screen.queryByText(/owner@acme\.co/)).toBeNull()
  })
})
