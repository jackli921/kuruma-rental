import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { OperatorContextPicker } from './OperatorContextPicker'

const h = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({ operator: undefined }),
    useNavigate: () => h.navigate,
  }),
}))
vi.mock('./api', () => ({
  operatorsQueryOptions: () => ({ queryKey: ['ops'], queryFn: async () => [] }),
  fetchOperators: async () => [],
}))

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorContextPicker', () => {
  it('renders the "All operators" option', async () => {
    wrap(<OperatorContextPicker operators={[{ id: 'op_1', name: 'Sakura', slug: 'sakura' }]} />)
    expect(await screen.findByText('All operators')).not.toBeNull()
  })

  it('clears the param with operator: undefined when "All operators" is chosen', () => {
    wrap(<OperatorContextPicker operators={[{ id: 'op_1', name: 'Sakura', slug: 'sakura' }]} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: '' } })
    const arg = h.navigate.mock.calls.at(-1)?.[0]
    expect(arg.search({ operator: 'op_1' })).toEqual({ operator: undefined })
  })
})
