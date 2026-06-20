import { describe, expect, it } from 'vitest'

import { buttonVariants } from './button'

// Tailwind v4 Preflight removed the browser default `cursor: pointer` on
// <button>, so every Button rendered the text/arrow cursor on hover (#961).
// The shared variants are the single fix point — guard it so a future class
// edit can't silently drop the affordance again.
describe('buttonVariants', () => {
  it('includes cursor-pointer by default', () => {
    expect(buttonVariants()).toContain('cursor-pointer')
  })

  it('keeps cursor-pointer across every variant and size (incl. icon buttons)', () => {
    const variants = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const
    const sizes = ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const
    for (const variant of variants) {
      for (const size of sizes) {
        expect(buttonVariants({ variant, size })).toContain('cursor-pointer')
      }
    }
  })
})
