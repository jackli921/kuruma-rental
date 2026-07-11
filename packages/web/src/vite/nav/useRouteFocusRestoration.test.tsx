import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useRouteFocusRestoration } from './useRouteFocusRestoration'

// The hook is the testable core of RouteAnnouncer (#1489). `navKey` stands in for the
// resolved-location key the component derives from useRouterState — changing it models a
// COMPLETED navigation. Toggling `showContent` models a route change / pendingComponent
// swap that unmounts the element that had focus (dropping focus to <body>), exactly the
// browser-agnostic mechanism the real bug relies on.
function Harness({ navKey, showContent }: { navKey: string; showContent: boolean }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  useRouteFocusRestoration(navKey, anchorRef)
  return (
    <>
      <div ref={anchorRef} tabIndex={-1} data-testid="anchor" />
      {showContent && (
        <button type="button" data-testid="content">
          content
        </button>
      )}
    </>
  )
}

describe('useRouteFocusRestoration (#1489)', () => {
  it('moves focus to the anchor when a navigation strands focus on <body>', () => {
    const { rerender } = render(<Harness navKey="/a" showContent />)
    screen.getByTestId('content').focus()
    expect(screen.getByTestId('content')).toHaveFocus()

    // Navigation resolves to a new location AND unmounts the focused content.
    rerender(<Harness navKey="/b" showContent={false} />)

    expect(screen.getByTestId('anchor')).toHaveFocus()
  })

  it('leaves focus alone when it is still on a live element after the nav', () => {
    // Focus sat on stable chrome (e.g. a Navbar link) that survives the nav, so it is NOT
    // on <body>; the restoration must not steal it.
    const { rerender } = render(<Harness navKey="/a" showContent />)
    screen.getByTestId('content').focus()
    rerender(<Harness navKey="/b" showContent />)
    expect(screen.getByTestId('content')).toHaveFocus()
  })

  it('does not steal focus on the initial resolution (WCAG 3.2.1)', () => {
    render(<Harness navKey="/a" showContent={false} />)
    expect(screen.getByTestId('anchor')).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('skips the first real key even when it arrives after mount (fresh load)', () => {
    // On a cold load resolvedLocation is briefly '' then becomes the landing href; that
    // first real key is the initial load, not a navigation -> no focus steal.
    const { rerender } = render(<Harness navKey="" showContent={false} />)
    rerender(<Harness navKey="/landing" showContent={false} />)
    expect(screen.getByTestId('anchor')).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })
})
