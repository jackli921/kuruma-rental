import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { LocationForm } from '@/modules/locations/components/LocationForm'

const editDefaults = {
  name: 'Osaka Namba',
  address: '1-2-3 Namba, Chuo-ku, Osaka',
  operatingHours: { openTime: '09:00', closeTime: '18:00' },
  timezone: 'Asia/Tokyo',
  defaultTurnaroundMinutes: 2880,
}

describe('LocationForm', () => {
  afterEach(() => {
    cleanup()
  })

  it('create mode: submits the entered values with create defaults', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<LocationForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('form.name'), 'Kyoto Station')
    await user.type(screen.getByLabelText('form.address'), '1 Karasuma, Kyoto')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: 'Kyoto Station',
      address: '1 Karasuma, Kyoto',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 2880,
    })
  })

  it('floors the turnaround input at the 60-minute service-quality minimum (#551)', () => {
    render(<LocationForm onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.turnaround')).toHaveAttribute('min', '60')
  })

  it('edit mode: pre-fills the existing location and submits the edit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<LocationForm mode="edit" onSubmit={onSubmit} defaultValues={editDefaults} />)

    const name = screen.getByLabelText('form.name')
    expect(name).toHaveValue('Osaka Namba')

    await user.clear(name)
    await user.type(name, 'Osaka Umeda')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: 'Osaka Umeda',
      address: '1-2-3 Namba, Chuo-ku, Osaka',
      operatingHours: { openTime: '09:00', closeTime: '18:00' },
    })
  })

  it('edit mode: still rejects an inverted operating-hours range', async () => {
    // The update schema reuses the shared operatingHours field schema, so the
    // inverted-range refinement must fire in edit mode too (issue #413 note).
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <LocationForm
        mode="edit"
        onSubmit={onSubmit}
        defaultValues={{
          ...editDefaults,
          operatingHours: { openTime: '20:00', closeTime: '08:00' },
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => {
      expect(screen.getByText('closeTime must be after openTime')).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
