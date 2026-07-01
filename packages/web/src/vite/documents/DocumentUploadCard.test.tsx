import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import { DocumentUploadCard } from './DocumentUploadCard'

// #1298: the upload submit was a raw hardcoded <button> (~36px, off-token red),
// so the shared Button touch-target floor could never reach it. Guard that it
// routes through the Button primitive (data-slot="button") going forward.
function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['session'], { user: { id: 'u1', role: 'RENTER' }, csrfToken: 'csrf' })
  client.setQueryData(['documents', 'me'], [])
  const { baseElement } = render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <DocumentUploadCard />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return baseElement
}

describe('DocumentUploadCard submit (#1298)', () => {
  it('renders the submit through the Button primitive so it inherits the touch floor', () => {
    const submit = renderCard().querySelector('button[type="submit"]')
    expect(submit).not.toBeNull()
    expect(submit?.getAttribute('data-slot')).toBe('button')
  })

  it('drops the off-token hardcoded red background', () => {
    const submit = renderCard().querySelector('button[type="submit"]')
    expect(submit?.className).not.toContain('bg-red-600')
  })
})
