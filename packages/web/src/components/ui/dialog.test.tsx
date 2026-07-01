import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dialog, DialogContent } from './dialog'

// #1298: DialogContent centered with `-translate-y-1/2` and no `max-h`/scroll,
// so any dialog taller than a small phone's viewport clipped its top AND bottom
// with no way to reach the footer/submit (CancelBookingDialog, reviews dialog).
// The fix caps height at 90dvh and scrolls an INNER region — not the popup
// itself — so the close button stays pinned instead of scrolling away.
describe('DialogContent viewport fit (#1298)', () => {
  function renderOpen() {
    const { baseElement } = render(
      <Dialog open>
        <DialogContent>
          <p>tall content</p>
        </DialogContent>
      </Dialog>,
    )
    const content = baseElement.querySelector('[data-slot="dialog-content"]')
    const scroll = baseElement.querySelector('[data-slot="dialog-scroll"]')
    if (!content || !scroll) throw new Error('dialog content/scroll did not render')
    return { content, scroll }
  }

  it('caps the popup height to the viewport and clips it, so it never exceeds the screen', () => {
    const { content } = renderOpen()
    expect(content.className).toContain('max-h-[90dvh]')
    expect(content.className).toContain('overflow-hidden')
  })

  it('scrolls an inner region (not the popup) so the body overflow stays contained', () => {
    const { content, scroll } = renderOpen()
    // The scrollable region is a child of the popup, not the popup itself.
    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll.className).toContain('min-h-0')
    expect(content.className).not.toContain('overflow-y-auto')
  })

  it('pins the close button outside the scroll region so it survives a scrolled body', () => {
    const { content, scroll } = renderOpen()
    const close = content.querySelector('[data-slot="dialog-close"]')
    expect(close, 'close button did not render').not.toBeNull()
    // Pinned means the close button is a direct child of the popup, NOT nested
    // inside the scrolling region — otherwise it scrolls away with the content.
    expect(scroll.contains(close)).toBe(false)
  })
})
