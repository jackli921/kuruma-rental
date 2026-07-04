import { useManualBookingDialog } from '@/vite/operator-bookings/useManualBookingDialog'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const RANGE = { start: new Date('2026-08-01T09:00:00Z'), end: new Date('2026-08-01T17:00:00Z') }

describe('useManualBookingDialog', () => {
  it('defaults to closed with no prefilled slot range', () => {
    const { result } = renderHook(() => useManualBookingDialog())
    expect(result.current.open).toBe(false)
    expect(result.current.slotRange).toBeNull()
  })

  it('openDialog() with no arg opens the dialog with an empty range (header button)', () => {
    const { result } = renderHook(() => useManualBookingDialog())
    act(() => result.current.openDialog())
    expect(result.current.open).toBe(true)
    expect(result.current.slotRange).toBeNull()
  })

  it('openDialog(range) opens the dialog and prefills that slot range (calendar slot-click)', () => {
    const { result } = renderHook(() => useManualBookingDialog())
    act(() => result.current.openDialog(RANGE))
    expect(result.current.open).toBe(true)
    expect(result.current.slotRange).toEqual(RANGE)
  })

  it('a later openDialog() clears a previously prefilled range back to null', () => {
    const { result } = renderHook(() => useManualBookingDialog())
    act(() => result.current.openDialog(RANGE))
    act(() => result.current.openDialog())
    expect(result.current.open).toBe(true)
    expect(result.current.slotRange).toBeNull()
  })

  it('setOpen(false) closes the dialog (onOpenChange path)', () => {
    const { result } = renderHook(() => useManualBookingDialog())
    act(() => result.current.openDialog(RANGE))
    act(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
  })
})
