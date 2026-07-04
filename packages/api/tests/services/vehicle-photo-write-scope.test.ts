// #1260 slice 4 + #1406: bind photo writes (POST/DELETE /vehicles/:id/photos ->
// VehiclePhotoService.uploadPhotos / deletePhoto) to the picked operator. These
// are SERVICE-level guard tests, exercising both caller classes the route gate
// admits: all-scope callers (`admin`, !isOperatorRole -> must name the owning
// operator or 422/404) and tenant operators (`opA` -> auto-clamped by read scope;
// a stray acting id is ignored). #1406 widened the route gate from STAFF_ROLES to
// FLEET_WRITE_ROLES, so operators and legacy STAFF/ADMIN are now route-reachable;
// legacy STAFF/ADMIN need no separate case here because they are all-scope
// (!isOperatorRole), behaving identically to the `admin` cases. The guard keys on
// `!isOperatorRole`, so any admitted non-operator fails closed without an operator.

import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import { MAX_PHOTOS_PER_VEHICLE, VehiclePhotoService } from '../../src/services/vehicle-photo'

const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
function jpeg(name = 'a.jpg'): File {
  return new File([new Uint8Array([...JPEG, ...new Array(50).fill(0)])], name, {
    type: 'image/jpeg',
  })
}

function vehicleInput(operatorId: string) {
  return {
    operatorId,
    name: 'Test Car',
    description: null,
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
  }
}

let repo: InMemoryVehicleRepository
let storage: InMemoryPhotoStorage
let service: VehiclePhotoService
let vehA: string // owned by op-A

beforeEach(async () => {
  repo = new InMemoryVehicleRepository()
  storage = new InMemoryPhotoStorage()
  service = new VehiclePhotoService(repo, storage)
  vehA = (await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A'))).id
})

describe('VehiclePhotoService.uploadPhotos — acting-operator binding (#1260)', () => {
  it('rejects an admin who names no acting operator (422), persisting no R2 object', async () => {
    const res = await service.uploadPhotos(admin, vehA, [jpeg()])
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
    // Guard runs before any storage.put, so the denied request leaves R2 clean.
    expect(storage.size()).toBe(0)
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toEqual([])
  })

  it('rejects an admin whose acting operator does not own the vehicle (404, no oracle)', async () => {
    const res = await service.uploadPhotos(admin, vehA, [jpeg()], 'op-B')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle not found' })
    expect(storage.size()).toBe(0)
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toEqual([])
  })

  it('uploads when the admin acts as the owning operator', async () => {
    const res = await service.uploadPhotos(admin, vehA, [jpeg()], 'op-A')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.total).toBe(1)
    expect(storage.size()).toBe(1)
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toHaveLength(1)
  })

  // Guard precedence: it must fire BEFORE the photo-cap check. A guard that ran
  // after the cap would surface 400 cap_exceeded for a cross-tenant admin; it
  // must 404 instead and never touch R2.
  it('denies a cross-tenant admin before the photo-cap check', async () => {
    const photos = Array.from(
      { length: MAX_PHOTOS_PER_VEHICLE },
      (_, i) => `https://r2.example/${i}.jpg`,
    )
    await repo.update(SYSTEM_CONTEXT, vehA, { photos })

    const res = await service.uploadPhotos(admin, vehA, [jpeg()], 'op-B')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle not found' })
    expect(storage.size()).toBe(0)
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toHaveLength(MAX_PHOTOS_PER_VEHICLE)
  })

  it('ignores a stray acting id for a tenant operator (already clamped by read scope)', async () => {
    const res = await service.uploadPhotos(opA, vehA, [jpeg()], 'op-else')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.total).toBe(1)
  })
})

describe('VehiclePhotoService.deletePhoto — acting-operator binding (#1260)', () => {
  let url: string

  beforeEach(async () => {
    const up = await service.uploadPhotos(opA, vehA, [jpeg()])
    if (!up.ok) throw new Error('setup failed')
    url = up.uploaded[0]!
  })

  it('rejects an admin who names no acting operator (422), leaving the photo in place', async () => {
    const res = await service.deletePhoto(admin, vehA, url)
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toEqual([url])
    expect(storage.size()).toBe(1)
  })

  it('rejects an admin whose acting operator does not own the vehicle (404, no oracle)', async () => {
    const res = await service.deletePhoto(admin, vehA, url, 'op-B')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Photo not found' })
    // The cross-tenant delete is refused: the photo row and its R2 object survive.
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toEqual([url])
    expect(storage.size()).toBe(1)
  })

  it('deletes when the admin acts as the owning operator', async () => {
    const res = await service.deletePhoto(admin, vehA, url, 'op-A')
    expect(res).toMatchObject({ ok: true, remaining: 0 })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.photos).toEqual([])
    expect(storage.size()).toBe(0)
  })

  it('ignores a stray acting id for a tenant operator (already clamped by read scope)', async () => {
    const res = await service.deletePhoto(opA, vehA, url, 'op-else')
    expect(res).toMatchObject({ ok: true, remaining: 0 })
  })
})
