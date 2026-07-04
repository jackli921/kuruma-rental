import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import { MAX_PHOTOS_PER_VEHICLE, VehiclePhotoService } from '../../src/services/vehicle-photo'
import type { Vehicle } from '../../src/stores'
import { TEST_OPERATOR_ID } from '../helpers/operator'

// #1260: photo writes are bound to the acting operator. The success/mutating
// paths run as the owning OPERATOR_OWNER (already tenant-scoped, so the guard
// no-ops); validation / no-file / nonexistent paths return BEFORE the guard, so
// they keep the unscoped SYSTEM_CONTEXT. The acting-operator denials themselves
// are covered in vehicle-photo-write-scope.test.ts.
const operator: CallerContext = {
  userId: 'op-user',
  role: 'OPERATOR_OWNER',
  operatorId: TEST_OPERATOR_ID,
}

function vehicleInput(overrides?: Partial<Vehicle>) {
  return {
    operatorId: TEST_OPERATOR_ID,
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
  const v = await repo.create(SYSTEM_CONTEXT, vehicleInput())
  vehicleId = v.id
})

describe('VehiclePhotoService.uploadPhotos', () => {
  it('uploads a valid image and appends the URL to the vehicle', async () => {
    const file = makeFile('a.jpg', 'image/jpeg', JPEG)
    const result = await service.uploadPhotos(operator, vehicleId, [file])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.uploaded).toHaveLength(1)
    expect(result.total).toBe(1)

    const updated = await repo.findById(SYSTEM_CONTEXT, vehicleId)
    expect(updated?.photos).toHaveLength(1)
  })

  it('rejects non-image MIME with 400', async () => {
    const file = new File([new Uint8Array(100)], 'doc.pdf', { type: 'application/pdf' })
    const result = await service.uploadPhotos(SYSTEM_CONTEXT, vehicleId, [file])
    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('image') })
  })

  it('rejects content-type spoofing with 415', async () => {
    // PNG bytes labeled as image/jpeg
    const file = makeFile('fake.jpg', 'image/jpeg', PNG)
    const result = await service.uploadPhotos(SYSTEM_CONTEXT, vehicleId, [file])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(415)
  })

  it('rejects file over 5MB with 400', async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024)
    bytes.set(JPEG)
    const file = new File([bytes], 'huge.jpg', { type: 'image/jpeg' })
    const result = await service.uploadPhotos(SYSTEM_CONTEXT, vehicleId, [file])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.error).toContain('5MB')
  })

  it('returns 404 with no orphan when vehicle does not exist', async () => {
    const file = makeFile('a.jpg', 'image/jpeg', JPEG)
    const result = await service.uploadPhotos(SYSTEM_CONTEXT, 'nonexistent-id', [file])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
    // R2 objects for the missing vehicle should have been rolled back
    expect(storage.size()).toBe(0)
  })

  it('returns 400 when no files provided', async () => {
    const result = await service.uploadPhotos(SYSTEM_CONTEXT, vehicleId, [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })
})

describe('VehiclePhotoService.uploadPhotos rollback', () => {
  it('rolls back already-uploaded files when a later put rejects', async () => {
    // Stub storage that rejects on the second put. All earlier successes
    // must be deleted; DB should be unchanged.
    const deletedUrls: string[] = []
    const deletedOwners: string[] = []
    let callCount = 0
    const flakyStorage = {
      put: async (vId: string, _file: File) => {
        callCount += 1
        if (callCount === 2) throw new Error('network blip')
        return { key: `k${callCount}`, url: `https://r2.example/${vId}/p${callCount}.jpg` }
      },
      delete: async (url: string, ownerVehicleId: string) => {
        deletedUrls.push(url)
        deletedOwners.push(ownerVehicleId)
      },
    }
    const flakyService = new VehiclePhotoService(repo, flakyStorage)

    const files = [makeFile('a.jpg', 'image/jpeg', JPEG), makeFile('b.jpg', 'image/jpeg', JPEG)]
    const result = await flakyService.uploadPhotos(operator, vehicleId, files)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    // The one successful upload must have been cleaned up, scoped to its vehicle.
    expect(deletedUrls).toEqual([`https://r2.example/${vehicleId}/p1.jpg`])
    expect(deletedOwners).toEqual([vehicleId])

    const after = await repo.findById(SYSTEM_CONTEXT, vehicleId)
    expect(after?.photos).toHaveLength(0)
  })
})

describe('VehiclePhotoService.deletePhoto', () => {
  it('removes the photo from the vehicle and R2', async () => {
    const file = makeFile('a.jpg', 'image/jpeg', JPEG)
    const up = await service.uploadPhotos(operator, vehicleId, [file])
    if (!up.ok) throw new Error('setup failed')
    const url = up.uploaded[0]!

    const result = await service.deletePhoto(operator, vehicleId, url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remaining).toBe(0)

    const after = await repo.findById(SYSTEM_CONTEXT, vehicleId)
    expect(after?.photos).toHaveLength(0)
  })

  it('returns 404 when the url is not associated with the vehicle', async () => {
    const result = await service.deletePhoto(operator, vehicleId, 'https://r2.example/missing.jpg')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })

  it('does not delete another vehicle’s stored object when its URL is cross-referenced', async () => {
    // Victim vehicle owns a real stored object.
    const victim = await repo.create(SYSTEM_CONTEXT, vehicleInput())
    const up = await service.uploadPhotos(operator, victim.id, [
      makeFile('v.jpg', 'image/jpeg', JPEG),
    ])
    if (!up.ok) throw new Error('setup failed')
    const victimUrl = up.uploaded[0]!
    expect(storage.size()).toBe(1)

    // Attacker references the victim's URL on their OWN row, then deletes it.
    await repo.appendPhotos(SYSTEM_CONTEXT, vehicleId, [victimUrl], MAX_PHOTOS_PER_VEHICLE)
    const result = await service.deletePhoto(operator, vehicleId, victimUrl)

    expect(result.ok).toBe(true)
    // The ref is gone from the attacker's row (DB tenant-scoped removal) ...
    const attacker = await repo.findById(SYSTEM_CONTEXT, vehicleId)
    expect(attacker?.photos).not.toContain(victimUrl)
    // ... but the victim's object is untouched in storage.
    expect(storage.size()).toBe(1)
  })
})
