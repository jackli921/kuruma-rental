import { OperatorClassesView } from '@/vite/operator-classes/OperatorClassesView'
import type { OperatorClass } from '@/vite/operator-classes/api'
import { render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function makeClass(over: Partial<OperatorClass> = {}): OperatorClass {
  return {
    id: 'c-1',
    operatorId: 'op-1',
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function renderView(classes: OperatorClass[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <OperatorClassesView classes={classes} />
    </IntlProvider>,
  )
}

describe('OperatorClassesView', () => {
  it('renders one row per class with name, slug, seats, and luggage', () => {
    renderView([makeClass()])

    const row = screen.getByRole('listitem')
    expect(within(row).getByRole('heading', { level: 3 })).toHaveTextContent('Compact')
    expect(within(row).getByText('compact')).toBeInTheDocument()
    expect(within(row).getByText('5 seats')).toBeInTheDocument()
    expect(within(row).getByText('2 bags')).toBeInTheDocument()
  })

  it('marks an archived class with the Archived badge', () => {
    renderView([makeClass({ status: 'ARCHIVED' })])
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('sorts classes by sortOrder ascending, then name', () => {
    renderView([
      makeClass({ id: 'b', name: 'Bravo', slug: 'bravo', sortOrder: 2 }),
      makeClass({ id: 'a', name: 'Alpha', slug: 'alpha', sortOrder: 1 }),
      makeClass({ id: 'z', name: 'Zeta', slug: 'zeta', sortOrder: 1 }),
    ])
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    // sortOrder 1 before 2; within sortOrder 1, Alpha before Zeta by name.
    expect(names).toEqual(['Alpha', 'Zeta', 'Bravo'])
  })

  it('renders a friendly ACRISS label, falling back to the raw code', () => {
    renderView([makeClass({ acrissCode: 'ZZZZ' })]) // not in the 8-key dictionary
    expect(screen.getByText('ZZZZ')).toBeInTheDocument()
  })

  it('shows the empty state when there are no classes', () => {
    renderView([])
    expect(screen.getByText(en.business.classes.empty)).toBeInTheDocument()
  })
})
