import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dialog, DialogContent } from './dialog'

// #1298: DialogContent centered with `-translate-y-1/2` and no `max-h`/scroll,
// so any dialog taller than a small phone's viewport clipped its top AND bottom
// with no way to reach the footer/submit (CancelBookingDialog, reviews dialog).
// The fix caps height at 90dvh and lets the body scroll.
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
    if (!content) throw new Error('dialog content did not render')
    return content
  }

  it('caps its height to the viewport so it never exceeds the screen', () => {
    expect(renderOpen().className).toContain('max-h-[90dvh]')
  })

  it('scrolls its overflowing body so the footer stays reachable', () => {
    expect(renderOpen().className).toContain('overflow-y-auto')
  })
})
