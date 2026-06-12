import { PhotoUpload } from '@/vite/operator-fleet/PhotoUpload'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Mock the foundation api module: the unit under test is the controlled
// component's guard + wiring, not the HTTP layer (covered by api.ts).
const uploadVehiclePhotos = vi.fn()
const deleteVehiclePhoto = vi.fn()
vi.mock('@/vite/operator-fleet/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-fleet/api')>()
  return {
    ...actual,
    uploadVehiclePhotos: (...args: unknown[]) => uploadVehiclePhotos(...args),
    deleteVehiclePhoto: (...args: unknown[]) => deleteVehiclePhoto(...args),
  }
})

const photosCopy = en.business.vehicles.photos

function renderUpload(props: { vehicleId: string | null; photos?: string[] }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <PhotoUpload {...props} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

/** A File whose `.size` we control without allocating real bytes. */
function fileOfSize(bytes: number, name: string, type = 'image/png'): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

afterEach(() => {
  uploadVehiclePhotos.mockReset()
  deleteVehiclePhoto.mockReset()
})

describe('PhotoUpload', () => {
  it('disables the control in create mode (vehicleId null) and never uploads', async () => {
    renderUpload({ vehicleId: null })

    const input = screen.getByLabelText(photosCopy.uploadPhotos) as HTMLInputElement
    expect(input).toBeDisabled()
    // No dedicated "upload after save" i18n key exists and we may not add one;
    // the create-mode hint reuses `photos.hint` (upload constraints).
    expect(
      screen.getByText(photosCopy.hint.replace('{max}', '10').replace('{maxSize}', '5')),
    ).toBeInTheDocument()

    const file = fileOfSize(1024, 'a.png')
    await userEvent.upload(input, file).catch(() => {})
    expect(uploadVehiclePhotos).not.toHaveBeenCalled()
  })

  it('uploads a valid selected file with the vehicle id and file array', async () => {
    uploadVehiclePhotos.mockResolvedValue({ uploaded: ['/p/a.png'], total: 1 })
    renderUpload({ vehicleId: 'veh_1' })

    const file = fileOfSize(1024, 'a.png')
    await userEvent.upload(screen.getByLabelText(photosCopy.uploadPhotos), file)

    await waitFor(() => expect(uploadVehiclePhotos).toHaveBeenCalledTimes(1))
    expect(uploadVehiclePhotos).toHaveBeenCalledWith('veh_1', [file])
  })

  it('rejects an oversize file client-side, shows an error, and never uploads', async () => {
    renderUpload({ vehicleId: 'veh_1' })

    const oversize = fileOfSize(6 * 1024 * 1024, 'big.png')
    await userEvent.upload(screen.getByLabelText(photosCopy.uploadPhotos), oversize)

    expect(await screen.findByText(photosCopy.sizeLimit.replace('{max}', '5'))).toBeInTheDocument()
    expect(uploadVehiclePhotos).not.toHaveBeenCalled()
  })

  it('deletes an existing photo by vehicle id and url', async () => {
    deleteVehiclePhoto.mockResolvedValue({ deleted: '/p/a.png', remaining: 0 })
    renderUpload({ vehicleId: 'veh_1', photos: ['/p/a.png'] })

    await userEvent.click(screen.getByRole('button', { name: photosCopy.deletePhoto }))

    await waitFor(() => expect(deleteVehiclePhoto).toHaveBeenCalledTimes(1))
    expect(deleteVehiclePhoto).toHaveBeenCalledWith('veh_1', '/p/a.png')
  })
})
