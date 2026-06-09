// Mirrors the Next #391/#392 hydration-race pin: the form must read submitted
// values from the FORM (DOM), not React state, so a pre-hydration fill survives.
// Here submit drives TanStack `navigate` instead of next-intl `router.push`.
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))

function renderForm(props: { defaultFrom?: string; defaultTo?: string } = {}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <StorefrontSearchForm {...props} />
    </IntlProvider>,
  )
}

describe('StorefrontSearchForm', () => {
  afterEach(() => {
    mockNavigate.mockClear()
    cleanup()
  })

  it('navigates with the range read from the DOM even when state never updated', () => {
    const { container } = renderForm()
    const from = container.querySelector('#from') as HTMLInputElement
    const to = container.querySelector('#to') as HTMLInputElement
    from.value = '2026-07-01T10:00'
    to.value = '2026-07-03T10:00'

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00' },
    })
  })

  it('prefills from defaults and carries them on submit', () => {
    const { container } = renderForm({
      defaultFrom: '2026-08-01T09:00',
      defaultTo: '2026-08-02T09:00',
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-08-01T09:00', to: '2026-08-02T09:00' },
    })
  })
})
