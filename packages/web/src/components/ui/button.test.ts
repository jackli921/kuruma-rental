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

// #1298: no >=44px touch-target floor existed, so every CTA was sub-44px on
// phones. The floor is a coarse-pointer opt-in (`@media (pointer: coarse)`) so
// it lifts touch targets WITHOUT inflating compact desktop/operator controls,
// whose density depends on the small fine-pointer heights.
describe('buttonVariants touch-target floor (#1298)', () => {
  const sizes = ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const

  it('applies a >=44px min-height on coarse pointers for every size', () => {
    for (const size of sizes) {
      expect(buttonVariants({ size })).toContain('pointer-coarse:min-h-11')
    }
  })

  it('gives square icon sizes a >=44px min-width too, so the tap area is 44x44', () => {
    const iconSizes = ['icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const
    for (const size of iconSizes) {
      expect(buttonVariants({ size })).toContain('pointer-coarse:min-w-11')
    }
  })

  it('leaves compact fine-pointer density unchanged (default stays h-8)', () => {
    expect(buttonVariants({ size: 'default' })).toContain('h-8')
  })
})
