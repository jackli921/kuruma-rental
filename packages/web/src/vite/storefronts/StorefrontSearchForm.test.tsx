import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/vite/regions/regions-api', () => ({
  regionsQueryOptions: () => ({ queryKey: ['regions'], queryFn: async () => [] }),
}))

import { StorefrontSearchForm } from './StorefrontSearchForm'

function renderForm(classFilter: string | string[] | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  const { container } = render(
    <StorefrontSearchForm
      defaultFrom="2026-07-01T10:00"
      defaultTo="2026-07-04T10:00"
      classFilter={classFilter}
    />,
    { wrapper },
  )
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
  return navigate.mock.calls[0]?.[0]?.search
}

beforeEach(() => navigate.mockReset())
afterEach(() => sessionStorage.clear())

describe('StorefrontSearchForm class filter', () => {
  it('preserves an operator-custom ACRISS code that has no chip when re-submitting', () => {
    // MCAR has a chip (stays checked); PVAR is outside the 8-chip subset.
    const classes = renderForm(['MCAR', 'PVAR']).class
    const asArray = Array.isArray(classes) ? classes : [classes]
    expect(asArray).toContain('MCAR')
    expect(asArray).toContain('PVAR')
  })

  it('keeps a single off-subset code from being dropped to no filter at all', () => {
    const search = renderForm('PVAR')
    const classes = Array.isArray(search.class) ? search.class : [search.class]
    expect(classes).toContain('PVAR')
  })

  it('carries no class filter when none is selected', () => {
    const search = renderForm(undefined)
    expect(search).not.toHaveProperty('class')
  })
})
