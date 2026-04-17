import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import { VehiclePhotoService } from '../../src/services/vehicle-photo'
import type { Vehicle } from '../../src/stores'

function vehicleInput(overrides?: Partial<Vehicle>) {
  return {
    name: 'Test Car',
    description: 'A test vehicle',
    photos: [] as string[],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    status: 'AVAILABLE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    ...overrides,
  }
}

function makeFile(name: string, type: string, magicBytes: number[]): File {
  const bytes = new Uint8Array([...magicBytes, ...new Array(50).fill(0)])
  return new File([bytes], name, { type })
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

let repo: InMemoryVehicleRepository
let storage: InMemoryPhotoStorage
let service: VehiclePhotoService
let vehicleId: string

beforeEach(async () => {
  repo = new InMemoryVehicleRepository()
  storage = new InMemoryPhotoStorage()
  service = new VehiclePhotoService(repo, storage)
  const v = await repo.create(vehicleInput())
  vehicleId = v.id
})

describe('VehiclePhotoService.uploadPhotos', () => {
  it('uploads a valid image and appends the URL to the vehicle', async () => {
    const file = makeFile('a.jpg', 'image/jpeg', JPEG)
    const result = await service.uploadPhotos(vehicleId, [file])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.uploaded).toHaveLength(1)
    expect(result.total).toBe(1)

    const updated = await repo.findById(vehicleId)
    expect(updated?.photos).toHaveLength(1)
  })

  it('rejects non-image MIME with 400', async () => {
    const file = new File([new Uint8Array(100)], 'doc.pdf', { type: 'application/pdf' })
    const result = await service.uploadPhotos(vehicleId, [file])
    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('image') })
  })

  it('rejects content-type spoofing with 415', async () => {
    // PNG bytes labeled as image/jpeg
    const file = makeFile('fake.jpg', 'image/jpeg', PNG)
    const result = await service.uploadPhotos(vehicleId, [file])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(415)
  })

  it('rejects file over 5MB with 400', async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024)
    bytes.set(JPEG)
    const file = new File([bytes], 'huge.jpg', { type: 'image/jpeg' })
    const result = await service.uploadPhotos(vehicleId, [file])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.error).toContain('5MB')
  })

  it('returns 404 with no orphan when vehicle does not exist', async () => {
    const file = makeFile('a.jpg', 'image/jpeg', JPEG)
    const result = await service.uploadPhotos('nonexistent-id', [file])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
    // R2 objects for the missing vehicle should have been rolled back
    expect(storage.size()).toBe(0)
  })

  it('returns 400 when no files provided', async () => {
    const result = await service.uploadPhotos(vehicleId, [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })
})

describe('VehiclePhotoService.deletePhoto', () => {
  it('removes the photo from the vehicle and R2', async () => {
    const file = makeFile('a.jpg', 'image/jpeg', JPEG)
    const up = await service.uploadPhotos(vehicleId, [file])
    if (!up.ok) throw new Error('setup failed')
    const url = up.uploaded[0]!

    const result = await service.deletePhoto(vehicleId, url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remaining).toBe(0)

    const after = await repo.findById(vehicleId)
    expect(after?.photos).toHaveLength(0)
  })

  it('returns 404 when the url is not associated with the vehicle', async () => {
    const result = await service.deletePhoto(vehicleId, 'https://r2.example/missing.jpg')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })
})
