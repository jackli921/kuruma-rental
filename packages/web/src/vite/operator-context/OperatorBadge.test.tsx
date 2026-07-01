import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { OperatorBadge } from './OperatorBadge'

function wrap(ui: React.ReactNode) {
  return render(
    <IntlProvider locale="en" messages={en}>
      {ui}
    </IntlProvider>,
  )
}

afterEach(cleanup)

describe('OperatorBadge', () => {
  it('renders nothing when no operator name is given', () => {
    const { container } = wrap(<OperatorBadge name={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the operator name as visible text', () => {
    wrap(<OperatorBadge name="Sakura Rentals" />)
    expect(screen.getByText('Sakura Rentals')).toBeInTheDocument()
  })

  it('localizes the aria-label with the name interpolated, not a hardcoded prefix', () => {
    wrap(<OperatorBadge name="Sakura Rentals" />)
    // business.operatorContext.badge = "Operator: {name}" in messages/en.json.
    // A regression to a hardcoded English string or a dropped {name} fails here.
    expect(screen.getByLabelText('Operator: Sakura Rentals')).toBeInTheDocument()
  })
})
