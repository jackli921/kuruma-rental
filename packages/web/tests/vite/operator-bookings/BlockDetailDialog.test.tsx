import { BlockDetailDialog } from '@/vite/operator-bookings/BlockDetailDialog'
import { OPERATOR_BOOKINGS_KEY } from '@/vite/operator-bookings/api'
import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// #1101 Slice B B5: the view/delete dialog. Mock only the write fn; the key stays real.
const deleteBlockMock = vi.hoisted(() => vi.fn())
vi.mock('@/vite/operator-bookings/api', async (orig) => {
  const actual = await orig<typeof import('@/vite/operator-bookings/api')>()
  return { ...actual, deleteBlock: deleteBlockMock }
})

const T = en.bookings.operator.blocks.detail

const BLOCK: BlockCalendarEvent = {
  type: 'block',
  id: 'blk-1',
  title: 'Oil change',
  start: new Date('2026-07-01T00:00:00.000Z'),
  end: new Date('2026-07-02T00:00:00.000Z'),
  resourceId: 'veh-2',
  kind: 'MAINTENANCE',
  reason: 'Oil change',
  notes: null,
}

afterEach(() => deleteBlockMock.mockReset())

type Props = Parameters<typeof BlockDetailDialog>[0]

function setup(over: Partial<Props> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <BlockDetailDialog
          block={BLOCK}
          onClose={onClose}
          vehicleName="Note"
          canManage
          csrfToken="csrf-1"
          locale="en"
          {...over}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onClose, invalidate }
}

describe('BlockDetailDialog', () => {
  it('shows the vehicle, kind, and reason, and omits the notes row when there are no notes', () => {
    setup()
    expect(screen.getByText('Note')).not.toBeNull()
    expect(screen.getByText(en.bookings.operator.blocks.kinds.MAINTENANCE)).not.toBeNull()
    expect(screen.getAllByText('Oil change').length).toBeGreaterThan(0)
    expect(screen.queryByText(T.notesLabel)).toBeNull()
  })

  it('renders the block window at the JST wall clock, not the browser-local one (#1250)', () => {
    // The block bands elsewhere on the calendar are placed in JST; this detail dialog
    // must agree, else the window label disagrees with the bar the operator clicked.
    // 00:00Z = 09:00 JST, 04:00Z = 13:00 JST.
    const block = {
      ...BLOCK,
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-01T04:00:00.000Z'),
    }
    setup({ block })
    const jstFmt = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tokyo',
    })
    const expected = `${jstFmt.format(block.start)} – ${jstFmt.format(block.end)}`
    expect(screen.getByText(expected)).not.toBeNull()
  })

  it('shows the notes row when the block carries notes', () => {
    setup({ block: { ...BLOCK, notes: 'Bay 3 lift' } })
    expect(screen.getByText(T.notesLabel)).not.toBeNull()
    expect(screen.getByText('Bay 3 lift')).not.toBeNull()
  })

  it('requires a confirm click, then deletes (forwarding the picked operator), invalidates the cache, and closes', async () => {
    deleteBlockMock.mockResolvedValue(BLOCK)
    // #1260: a picker admin's delete binds to the operator it is acting as.
    const { onClose, invalidate } = setup({ pickedOperatorId: 'op-7' })

    // First click arms the confirm — no API call yet.
    fireEvent.click(screen.getByRole('button', { name: T.deleteAction }))
    expect(screen.getByText(T.deleteConfirm)).not.toBeNull()
    expect(deleteBlockMock).not.toHaveBeenCalled()

    // Second click performs the hard delete against the block's vehicle + id.
    fireEvent.click(screen.getByRole('button', { name: T.deleteAction }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(deleteBlockMock).toHaveBeenCalledWith('veh-2', 'blk-1', 'csrf-1', 'op-7')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: OPERATOR_BOOKINGS_KEY })
  })

  it('offers no remove action to a read-only viewer (admin preview — canManage=false)', () => {
    setup({ canManage: false })
    // The block is fully visible (read access)...
    expect(screen.getByText(T.dialogTitle)).not.toBeNull()
    expect(screen.getByText('Note')).not.toBeNull()
    // ...but the write affordance is gone — the only boundary keeping the admin preview
    // read-only, since the write API itself admits a platform admin.
    expect(screen.queryByRole('button', { name: T.deleteAction })).toBeNull()
  })
})
