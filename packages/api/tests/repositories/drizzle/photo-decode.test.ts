import { describe, expect, it } from 'vitest'
import { type PhotoDecoder, toVehicle, toVehicleClass } from '../../../src/repositories/drizzle/shared'

// A stand-in decoder that expands r2:<key> refs against a fake bucket base and
// passes external URLs through — the same contract the composition root injects
// (#879). The point of these tests is to prove the row->domain mappers actually
// route `photos` THROUGH the injected decoder, so a revert to `photos: r.photos`
// fails here even though no r2: data exists in the rest of the suite yet.
const decode: PhotoDecoder = (photos) =>
  photos.map((p) => (p.startsWith('r2:') ? `https://cdn.example/${p.slice('r2:'.length)}` : p))

const STORED = ['r2:vehicles/v1/a.jpg', 'https://images.example/b.jpg']
const EXPECTED = ['https://cdn.example/vehicles/v1/a.jpg', 'https://images.example/b.jpg']

describe('toVehicle photo decode (#879)', () => {
  it('routes stored photos through the injected decoder', () => {
    // Only `.photos` is asserted; the mapper reads the rest of the row but the
    // test casts a minimal row (tests are not typechecked in this package).
    const vehicle = toVehicle({ photos: STORED } as never, decode)
    expect(vehicle.photos).toEqual(EXPECTED)
  })
})

describe('toVehicleClass photo decode (#879)', () => {
  it('routes stored photos through the injected decoder', () => {
    const vehicleClass = toVehicleClass({ photos: STORED } as never, decode)
    expect(vehicleClass.photos).toEqual(EXPECTED)
  })
})
