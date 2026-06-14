import { PhotoGallery } from '@/vite/storefronts/PhotoGallery'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function renderGallery(photos: string[], alt = 'Toyota Aqua') {
  return render(
    <IntlProvider locale="en" messages={en}>
      <PhotoGallery photos={photos} alt={alt} />
    </IntlProvider>,
  )
}

describe('PhotoGallery', () => {
  afterEach(cleanup)

  it('renders a placeholder with no image and no controls for zero photos', () => {
    renderGallery([])
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a single image with no navigation controls for one photo', () => {
    renderGallery(['/photos/a.jpg'])
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/photos/a.jpg')
    expect(img).toHaveAttribute('alt', 'Toyota Aqua')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lazy-loads images to avoid blocking first paint', () => {
    renderGallery(['/photos/a.jpg'])
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy')
  })

  it('declares explicit 4:3 width and height so the browser reserves the box (#440)', () => {
    renderGallery(['/photos/a.jpg'])
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('width', '400')
    expect(img).toHaveAttribute('height', '300')
  })

  it('shows the first photo and advances to the next on Next', () => {
    renderGallery(['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'])
    expect(screen.getByRole('img')).toHaveAttribute('src', '/photos/a.jpg')

    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/photos/b.jpg')
  })

  it('wraps to the last photo when Previous is pressed on the first', () => {
    renderGallery(['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'])
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/photos/c.jpg')
  })

  it('renders one dot control per photo and jumps to the chosen one', () => {
    renderGallery(['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'])
    expect(screen.getByRole('button', { name: 'Go to photo 3' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go to photo 3' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/photos/c.jpg')
  })
})
