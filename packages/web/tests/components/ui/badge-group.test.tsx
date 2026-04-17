import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BadgeGroup } from '@/components/ui/badge-group'

describe('BadgeGroup', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders exactly one button per item', () => {
    render(<BadgeGroup items={['a', 'b', 'c']} selected={[]} onToggle={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'b' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'c' })).toBeInTheDocument()
  })

  it('marks items in `selected` with aria-pressed="true" and others with "false"', () => {
    render(<BadgeGroup items={['a', 'b', 'c']} selected={['b']} onToggle={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'b' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'c' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onToggle with the exact item value when a badge is clicked', async () => {
    const onToggle = vi.fn<[string], void>()
    const user = userEvent.setup()

    render(<BadgeGroup items={['apple', 'banana', 'cherry']} selected={[]} onToggle={onToggle} />)

    await user.click(screen.getByRole('button', { name: 'banana' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('banana')
  })

  it('uses the `label` function when provided', () => {
    render(
      <BadgeGroup
        items={['AUTO', 'MANUAL']}
        selected={[]}
        onToggle={vi.fn()}
        label={(value) => `Transmission: ${value}`}
      />,
    )

    expect(screen.getByRole('button', { name: 'Transmission: AUTO' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Transmission: MANUAL' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AUTO' })).toBeNull()
  })

  it('falls back to String(item) when no `label` is provided', () => {
    render(<BadgeGroup items={[2024, 2023]} selected={[]} onToggle={vi.fn()} />)

    expect(screen.getByRole('button', { name: '2024' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2023' })).toBeInTheDocument()
  })

  it('renders every item unselected when `selected` is undefined (no crash)', () => {
    render(<BadgeGroup items={['x', 'y']} selected={undefined} onToggle={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'x' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'y' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies `groupLabel` as aria-label on the wrapper with role="group"', () => {
    render(
      <BadgeGroup items={['a']} selected={[]} onToggle={vi.fn()} groupLabel="Vehicle statuses" />,
    )

    const group = screen.getByRole('group', { name: 'Vehicle statuses' })
    expect(group).toHaveAttribute('aria-label', 'Vehicle statuses')
  })

  it('works with string items (generic over string)', async () => {
    const onToggle = vi.fn<[string], void>()
    const user = userEvent.setup()

    render(<BadgeGroup items={['Honda', 'Toyota']} selected={['Honda']} onToggle={onToggle} />)

    expect(screen.getByRole('button', { name: 'Honda' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Toyota' }))
    expect(onToggle).toHaveBeenCalledWith('Toyota')
  })

  it('works with number items (generic over number)', async () => {
    const onToggle = vi.fn<[number], void>()
    const user = userEvent.setup()

    render(<BadgeGroup items={[4, 5, 7]} selected={[5]} onToggle={onToggle} />)

    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '7' }))
    expect(onToggle).toHaveBeenCalledWith(7)
  })
})
