import type { RunTx } from '@kuruma/shared/db'
import { describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../../src/auth/context'
import type { PhotoDecoder, PhotoEncoder } from '../../../src/repositories/drizzle/shared'
import { createDrizzleTransaction } from '../../../src/repositories/drizzle/transaction'

// The same codec contract the composition root injects (#879): r2:<key> <-> wire
// URL against a fake CDN base. The pre-#1000 tx factory wired NEITHER, so the
// tx-bound vehicle repo silently fell back to identity (raw r2: leaks out on
// read; the spoof-guard encode is skipped on write). These two tests prove the
// factory now threads both codecs — a revert drops back to identity and fails.
const BASE = 'https://cdn.example/'
const decode: PhotoDecoder = (photos) =>
  photos.map((p) => (p.startsWith('r2:') ? BASE + p.slice('r2:'.length) : p))
const encode: PhotoEncoder = (photos) =>
  photos.map((p) => (p.startsWith(BASE) ? `r2:${p.slice(BASE.length)}` : p))

// Minimal stand-in for the neon-serverless tx handle. findById awaits
// select().from().where(); update awaits update().set().where().returning().
// `capture` records the values update writes so the encode assertion is exact.
function makeFakeTx(
  readRow: Record<string, unknown>,
  capture: { set?: Record<string, unknown> } = {},
) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([readRow]) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        capture.set = values
        return {
          where: () => ({ returning: () => Promise.resolve([{ ...readRow, ...values }]) }),
        }
      },
    }),
  }
}

// A RunTx that runs the callback against the fake handle, no real transaction.
const fakeRunTx =
  (tx: ReturnType<typeof makeFakeTx>): RunTx =>
  (fn) =>
    fn(tx as never)

describe('createDrizzleTransaction threads the photo codecs into the tx vehicle repo (#1000)', () => {
  it('decodes stored r2: refs on a tx-bound findById (read-side leak guard)', async () => {
    const tx = makeFakeTx({ id: 'v1', photos: ['r2:vehicles/v1/a.jpg'] })
    const runInTx = createDrizzleTransaction(fakeRunTx(tx), decode, encode)

    const vehicle = await runInTx(async ({ vehicleRepo }) =>
      vehicleRepo.findById(SYSTEM_CONTEXT, 'v1'),
    )

    expect(vehicle?.photos).toEqual(['https://cdn.example/vehicles/v1/a.jpg'])
  })

  it('encodes wire URLs to r2: refs on a tx-bound update (write-side spoof guard)', async () => {
    const capture: { set?: Record<string, unknown> } = {}
    const tx = makeFakeTx({ id: 'v1', photos: ['r2:vehicles/v1/a.jpg'] }, capture)
    const runInTx = createDrizzleTransaction(fakeRunTx(tx), decode, encode)

    await runInTx(async ({ vehicleRepo }) =>
      vehicleRepo.update(SYSTEM_CONTEXT, 'v1', {
        photos: ['https://cdn.example/vehicles/v1/b.jpg'],
      }),
    )

    expect(capture.set?.photos).toEqual(['r2:vehicles/v1/b.jpg'])
  })
})
