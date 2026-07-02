import { StoreMonogram } from '@/vite/storefronts/StoreMonogram'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('StoreMonogram', () => {
  it('renders the store initials as the visual identity', () => {
    render(<StoreMonogram name="Best Car Rental Osaka" label="Store location" />)
    expect(screen.getByText('BC')).toBeInTheDocument()
  })

  it('exposes an image role carrying the accessible label', () => {
    render(<StoreMonogram name="Best Car Rental Osaka" label="Store location" />)
    expect(screen.getByRole('img', { name: 'Store location' })).toBeInTheDocument()
  })

  it('hides the decorative initials from assistive tech so the label is announced instead', () => {
    render(<StoreMonogram name="Best Car Rental Osaka" label="Store location" />)
    expect(screen.getByText('BC')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders text only, never an <img> element', () => {
    const { container } = render(<StoreMonogram name="Sakura Rentals" label="Store location" />)
    expect(container.querySelector('img')).toBeNull()
  })
})
