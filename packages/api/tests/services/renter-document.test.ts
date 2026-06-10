import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryDocumentStorage } from '../../src/repositories/in-memory/document-storage'
import { InMemoryRenterDocumentRepository } from '../../src/repositories/in-memory/renter-document'
import { RenterDocumentService } from '../../src/services/renter-document'

const RENTER = 'renter_1'
const renterCtx: CallerContext = { userId: RENTER, role: 'RENTER', bypassScope: false }

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function makeFile(name: string, type: string, magicBytes: number[], padTo = 50): File {
  const bytes = new Uint8Array([...magicBytes, ...new Array(padTo).fill(0)])
  return new File([bytes], name, { type })
}

let repo: InMemoryRenterDocumentRepository
let storage: InMemoryDocumentStorage
let service: RenterDocumentService

beforeEach(() => {
  repo = new InMemoryRenterDocumentRepository()
  storage = new InMemoryDocumentStorage()
  service = new RenterDocumentService(repo, storage)
})

describe('RenterDocumentService — upload', () => {
  it('stores a valid JPEG IDP as a PENDING document', async () => {
    const result = await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'IDP' },
      makeFile('idp.jpg', 'image/jpeg', JPEG),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document.status).toBe('PENDING')
      expect(result.document.type).toBe('IDP')
      expect(storage.has(result.document.storageKey)).toBe(true)
    }
  })

  it('rejects a non-image content type', async () => {
    const result = await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'IDP' },
      makeFile('idp.pdf', 'application/pdf', [0x25, 0x50]),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects a file whose bytes do not match the declared type (spoof)', async () => {
    const result = await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'IDP' },
      makeFile('idp.jpg', 'image/jpeg', PNG),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(415)
  })

  it('rejects an oversized file', async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'idp.jpg', { type: 'image/jpeg' })
    const result = await service.upload(renterCtx, { renterId: RENTER, type: 'IDP' }, big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('does not persist a document when validation fails', async () => {
    await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'IDP' },
      makeFile('idp.pdf', 'application/pdf', [0x25, 0x50]),
    )
    expect(await service.listMine(renterCtx, RENTER)).toEqual([])
  })
})

describe('RenterDocumentService — verify', () => {
  it('returns 404 when verifying an unknown document', async () => {
    const result = await service.verify(SYSTEM_CONTEXT, 'missing', {
      status: 'APPROVED',
      verifierId: 'staff',
      expiryDate: '2030-01-31',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('approves an existing document', async () => {
    const up = await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'IDP' },
      makeFile('idp.jpg', 'image/jpeg', JPEG),
    )
    if (!up.ok) throw new Error('upload failed')
    const result = await service.verify(SYSTEM_CONTEXT, up.document.id, {
      status: 'APPROVED',
      verifierId: 'staff',
      expiryDate: '2030-01-31',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.status).toBe('APPROVED')
  })
})

describe('RenterDocumentService — isRenterEligible (type + date aware)', () => {
  const RENTAL_END = new Date('2026-08-01T10:00:00Z')

  async function approveIdp(expiryDate: string) {
    const up = await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'IDP' },
      makeFile('idp.jpg', 'image/jpeg', JPEG),
    )
    if (!up.ok) throw new Error('upload failed')
    await service.verify(SYSTEM_CONTEXT, up.document.id, {
      status: 'APPROVED',
      verifierId: 'staff',
      expiryDate,
    })
  }

  it('eligible when an approved IDP is valid through the rental return', async () => {
    await approveIdp('2026-12-31')
    expect(await service.isRenterEligible(RENTER, RENTAL_END)).toEqual({ ok: true })
  })

  it('eligible when the IDP expires exactly on the return day', async () => {
    await approveIdp('2026-08-01')
    expect(await service.isRenterEligible(RENTER, RENTAL_END)).toEqual({ ok: true })
  })

  it('ineligible when the approved IDP expires before the return', async () => {
    await approveIdp('2026-07-31')
    const verdict = await service.isRenterEligible(RENTER, RENTAL_END)
    expect(verdict).toEqual({ ok: false, reason: 'IDP_EXPIRES_BEFORE_RETURN' })
  })

  it('ineligible when the renter has no approved IDP', async () => {
    expect(await service.isRenterEligible(RENTER, RENTAL_END)).toEqual({
      ok: false,
      reason: 'NO_APPROVED_IDP',
    })
  })

  it('an approved PASSPORT does not satisfy the IDP requirement', async () => {
    const up = await service.upload(
      renterCtx,
      { renterId: RENTER, type: 'PASSPORT' },
      makeFile('p.jpg', 'image/jpeg', JPEG),
    )
    if (!up.ok) throw new Error('upload failed')
    await service.verify(SYSTEM_CONTEXT, up.document.id, {
      status: 'APPROVED',
      verifierId: 'staff',
      expiryDate: '2030-01-01',
    })
    expect(await service.isRenterEligible(RENTER, RENTAL_END)).toEqual({
      ok: false,
      reason: 'NO_APPROVED_IDP',
    })
  })
})
