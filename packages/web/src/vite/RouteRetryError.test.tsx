import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))

import { RouteRetryError } from './RouteRetryError'

describe('RouteRetryError', () => {
  beforeEach(() => {
    invalidate.mockClear()
  })

  it('renders the load-error message and the retry button', () => {
    render(<RouteRetryError message="Could not load your data" retryLabel="Try again" />)

    expect(screen.getByText('Could not load your data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('invalidates the route (re-runs the loader) when retry is clicked', () => {
    render(<RouteRetryError message="Load failed" retryLabel="Retry" />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('overrides the wrapper with a provided className', () => {
    const { container } = render(
      <RouteRetryError
        message="m"
        retryLabel="r"
        className="mx-auto max-w-3xl py-20 text-center"
      />,
    )

    expect(container.firstElementChild).toHaveClass('max-w-3xl', 'py-20', 'text-center')
    expect(container.firstElementChild).not.toHaveClass('max-w-7xl')
  })

  it('falls back to the default centered wrapper when no className is given', () => {
    const { container } = render(<RouteRetryError message="m" retryLabel="r" />)

    expect(container.firstElementChild).toHaveClass('mx-auto', 'max-w-7xl', 'text-center')
  })
})
