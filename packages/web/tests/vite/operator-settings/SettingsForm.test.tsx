import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { SettingsForm } from '@/vite/operator-settings/SettingsForm'

const ownerDefaults = { name: 'Owner Co', preAuthHandoffUrl: 'https://pay.old.example/h' }

describe('SettingsForm', () => {
  afterEach(() => cleanup())

  it('prefills the current name and handoff URL', () => {
    render(<SettingsForm defaultValues={ownerDefaults} canEditHandoff onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('form.name')).toHaveValue('Owner Co')
    expect(screen.getByLabelText('form.handoffUrl')).toHaveValue('https://pay.old.example/h')
  })

  it('an owner submits both the renamed name and the new handoff URL', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm defaultValues={ownerDefaults} canEditHandoff onSubmit={onSubmit} />)

    await user.clear(screen.getByLabelText('form.name'))
    await user.type(screen.getByLabelText('form.name'), 'Renamed Co')
    await user.clear(screen.getByLabelText('form.handoffUrl'))
    await user.type(screen.getByLabelText('form.handoffUrl'), 'https://pay.new.example/h')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'Renamed Co',
      preAuthHandoffUrl: 'https://pay.new.example/h',
    })
  })

  it('an owner clearing the handoff field submits null (clear to NULL)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm defaultValues={ownerDefaults} canEditHandoff onSubmit={onSubmit} />)

    await user.clear(screen.getByLabelText('form.handoffUrl'))
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toEqual({ name: 'Owner Co', preAuthHandoffUrl: null })
  })

  it('disables the handoff field for a non-owner and OMITS it from the patch', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <SettingsForm defaultValues={ownerDefaults} canEditHandoff={false} onSubmit={onSubmit} />,
    )

    expect(screen.getByLabelText('form.handoffUrl')).toBeDisabled()

    await user.clear(screen.getByLabelText('form.name'))
    await user.type(screen.getByLabelText('form.name'), 'Staff Renamed')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    // The money-flow field must not ride along — the API would 403 a staff patch
    // that names preAuthHandoffUrl at all (even unchanged).
    expect(onSubmit.mock.calls[0][0]).toEqual({ name: 'Staff Renamed' })
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('preAuthHandoffUrl')
  })

  it('rejects an empty name without calling onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm defaultValues={ownerDefaults} canEditHandoff onSubmit={onSubmit} />)

    await user.clear(screen.getByLabelText('form.name'))
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a non-http(s) handoff URL without calling onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm defaultValues={ownerDefaults} canEditHandoff onSubmit={onSubmit} />)

    await user.clear(screen.getByLabelText('form.handoffUrl'))
    await user.type(screen.getByLabelText('form.handoffUrl'), 'not-a-url')
    await user.click(screen.getByRole('button', { name: 'form.save' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
