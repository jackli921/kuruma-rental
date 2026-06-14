import { NativeSelect } from '@/components/ui/native-select'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

// #622: NativeSelect was extracted (#604) without the interaction-state styling
// that the text-input primitive (ui/input.tsx) carries. These tests pin parity
// on focus / disabled / aria-invalid so a future refactor can't silently drop it.
describe('NativeSelect', () => {
  it('carries focus / disabled / aria-invalid interaction-state styling (Input parity)', () => {
    const { container } = render(<NativeSelect aria-label="region" />)
    const select = container.querySelector('select')

    // focus ring
    expect(select).toHaveClass('focus-visible:border-ring')
    expect(select).toHaveClass('focus-visible:ring-ring/50')
    // disabled
    expect(select).toHaveClass('disabled:cursor-not-allowed')
    expect(select).toHaveClass('disabled:opacity-50')
    // invalid (dormant until aria-invalid is set, exactly like Input)
    expect(select).toHaveClass('aria-invalid:border-destructive')
    expect(select).toHaveClass('aria-invalid:ring-destructive/20')
    // dark-mode counterparts — the ones most likely to be silently dropped in a
    // future sweep since nobody eyeballs dark mode, so pin them explicitly.
    expect(select).toHaveClass('disabled:bg-input/50')
    expect(select).toHaveClass('dark:disabled:bg-input/80')
    expect(select).toHaveClass('dark:aria-invalid:border-destructive/50')
    expect(select).toHaveClass('dark:aria-invalid:ring-destructive/40')
  })

  it('preserves its own dimensions and merges caller className', () => {
    const { container } = render(<NativeSelect className="mt-4" />)
    const select = container.querySelector('select')

    expect(select).toHaveClass('h-9')
    expect(select).toHaveClass('rounded-md')
    expect(select).toHaveClass('mt-4')
  })
})
