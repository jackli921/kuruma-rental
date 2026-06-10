import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryDocumentStorage,
  InMemoryRenterDocumentRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]

function jpegFile(name = 'idp.jpg'): File {
  const buf = new Uint8Array(1024)
  buf.set(JPEG_HEADER, 0)
  return new File([buf.buffer], name, { type: 'image/jpeg' })
}

function uploadForm(type = 'IDP', file: File | null = jpegFile()): FormData {
  const form = new FormData()
  if (file) form.append('file', file)
  form.append('type', type)
  return form
}

function createTestApp() {
  setupAuthEnv()
  const renterDocumentRepo = new InMemoryRenterDocumentRepository()
  const documentStorage = new InMemoryDocumentStorage()
  const app = createApp({
    vehicleRepo: new InMemoryVehicleRepository(),
    bookingRepo: new InMemoryBookingRepository(),
    availabilityRepo: new InMemoryAvailabilityRepository(
      new InMemoryVehicleRepository(),
      new InMemoryBookingRepository(),
    ),
    renterDocumentRepo,
    documentStorage,
  })
  return { app, renterDocumentRepo, documentStorage }
}

const RENTER = { sub: 'renter-1', role: 'RENTER' as const }

describe('POST /documents', () => {
  let app: ReturnType<typeof createTestApp>['app']

  beforeEach(() => {
    app = createTestApp().app
  })

  it('lets a renter upload their own IDP and returns 201 with PENDING metadata', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('IDP'),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.document).toMatchObject({
      renterId: 'renter-1',
      type: 'IDP',
      status: 'PENDING',
    })
    expect(body.data.document.storageKey).toBeTruthy()
  })

  it('rejects a request with no file part with 400', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('IDP', null),
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('file')
  })

  it('rejects an unknown document type with 400', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('DRIVERS_LICENSE'),
    })

    expect(res.status).toBe(400)
  })

  it('returns 401 without auth', async () => {
    const res = await app.request('/documents', { method: 'POST', body: uploadForm('IDP') })
    expect(res.status).toBe(401)
  })

  it('rejects an oversized body early with 413 before buffering it', async () => {
    const res = await app.request('/documents', {
      method: 'POST',
      headers: { ...(await authHeaders(RENTER)), 'content-length': String(50 * 1024 * 1024) },
    })

    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('Request body too large')
  })
})

describe('GET /documents/me', () => {
  it("returns only the calling renter's own documents", async () => {
    const app = createTestApp().app
    await app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('IDP'),
    })

    const res = await app.request('/documents/me', { headers: await authHeaders(RENTER) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.documents).toHaveLength(1)
    expect(body.data.documents[0].renterId).toBe('renter-1')
  })
})

describe('GET /documents (staff pending queue)', () => {
  it('returns the paginated pending queue for staff', async () => {
    const app = createTestApp().app
    await app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('IDP'),
    })

    const res = await app.request('/documents', { headers: await authHeaders() })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.total).toBe(1)
    expect(body.data.documents[0].status).toBe('PENDING')
  })

  it('forbids a renter from reading the staff queue with 403', async () => {
    const app = createTestApp().app
    const res = await app.request('/documents', { headers: await authHeaders(RENTER) })
    expect(res.status).toBe(403)
  })
})

describe('POST /documents/:id/verify', () => {
  it('lets staff approve a document with an expiry date', async () => {
    const ctx = createTestApp()
    const upload = await ctx.app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('IDP'),
    })
    const id = (await upload.json()).data.document.id

    const res = await ctx.app.request(`/documents/${id}/verify`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED', expiryDate: '2027-01-01' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.document.status).toBe('APPROVED')
    expect(body.data.document.expiryDate).toBe('2027-01-01')
  })

  it('returns 404 verifying a document that does not exist', async () => {
    const app = createTestApp().app
    const res = await app.request('/documents/nope/verify', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED', expiryDate: '2027-01-01' }),
    })
    expect(res.status).toBe(404)
  })

  it('forbids a renter from verifying with 403', async () => {
    const ctx = createTestApp()
    const upload = await ctx.app.request('/documents', {
      method: 'POST',
      headers: await authHeaders(RENTER),
      body: uploadForm('IDP'),
    })
    const id = (await upload.json()).data.document.id

    const res = await ctx.app.request(`/documents/${id}/verify`, {
      method: 'POST',
      headers: { ...(await authHeaders(RENTER)), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPROVED', expiryDate: '2027-01-01' }),
    })
    expect(res.status).toBe(403)
  })
})
