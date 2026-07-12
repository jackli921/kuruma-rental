import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// #1538: authenticated, real-DB coverage for the operator vehicle-photo upload/delete path —
// the only file-upload flow in the operator product, previously untouched. Drives the real
// Vite UI -> Hono API -> seeded Postgres stack under the OPERATOR_OWNER session (project
// default storageState = Best Car Rental).
//
// Storage note (the #1538 "resolve infra first"): production stores photos in R2, and the
// composition root wires DisabledPhotoStorage when no R2 bucket is bound — so the upload path
// throws locally by default. The real-db harness (real-api-server.ts) now injects an
// InMemoryPhotoStorage (safe because it is one long-lived process, unlike per-request CF
// Workers), so the full upload -> visible -> delete -> gone flow round-trips locally. That
// storage returns https://test-photos.example.com/... URLs; with the harness's empty public
// base the URL is stored verbatim, so this spec identifies its own uploaded photo by that
// origin and never touches the vehicle's seeded photos.
//
// Fixture: a committed 1x1 PNG (e2e/fixtures/vehicle-photo.png) — real magic bytes so the
// service's content sniff accepts it. The spec uploads to an existing Best Car Rental vehicle
// and restores that vehicle's original photos array in afterAll.

const OPERATOR_NAME = 'Best Car Rental'
// InMemoryPhotoStorage's public base (repositories/in-memory/photo-storage.ts). Our uploaded
// photo's wire URL starts with this; seeded photos are external image URLs, so this never
// collides with them.
const UPLOADED_ORIGIN = 'https://test-photos.example.com'
const FIXTURE = join(process.cwd(), 'e2e/fixtures/vehicle-photo.png')

// The vehicle this spec uploads to + its original photos, snapshotted at test start so afterAll
// restores it exactly (removing the uploaded photo even if the test failed mid-run).
let targetVehicleId: string | null = null
let originalPhotos: string[] = []

test.describe('operator vehicle photos — upload then delete on the fleet detail page (real DB)', () => {
  test.afterAll(restoreVehiclePhotos)

  test('operator uploads a photo (appears in the gallery) then deletes it (disappears)', async ({
    page,
  }) => {
    test.setTimeout(120_000) // Vite builds the fleet-detail route on first hit.

    const vehicleId = await resolveTargetVehicle()

    await page.goto(`/en/manage/fleet/${vehicleId}`)
    // The upload control renders for the owner (canWrite). Scope to <main> so the edit sheet's
    // own (portaled, currently-closed) PhotoUpload input can never make this ambiguous.
    const fileInput = page.getByRole('main').locator('input[type="file"]')
    await expect(fileInput).toBeAttached({ timeout: 30_000 })

    // Our uploaded photo, identified by the in-memory storage origin (seeded photos are
    // external URLs, so this matcher can only ever be the one we just uploaded).
    const uploadedImg = page.locator(`img[src^="${UPLOADED_ORIGIN}"]`)

    await test.step('upload -> photo appears in the gallery + lands in the DB', async () => {
      await fileInput.setInputFiles(FIXTURE)
      await expect(uploadedImg).toBeVisible({ timeout: 20_000 })

      const photos = await readPhotos(vehicleId)
      expect(photos.filter((u) => u.startsWith(UPLOADED_ORIGIN))).toHaveLength(1)
      expect(photos).toHaveLength(originalPhotos.length + 1)
    })

    await test.step('delete -> photo disappears from the gallery + leaves the DB', async () => {
      const uploadedItem = page.locator('li').filter({ has: uploadedImg })
      await uploadedItem.hover() // the delete control is hover-revealed
      await uploadedItem.getByRole('button', { name: 'Delete photo' }).click()
      await expect(uploadedImg).toHaveCount(0)

      const photos = await readPhotos(vehicleId)
      expect(photos.filter((u) => u.startsWith(UPLOADED_ORIGIN))).toHaveLength(0)
      expect(photos).toHaveLength(originalPhotos.length)
    })
  })
})

// --- seeding + assertion helpers (raw pg over testSql) -------------------------------------

/** Pick a Best Car Rental vehicle and snapshot its current photos (for afterAll restore). */
async function resolveTargetVehicle(): Promise<string> {
  const sql = testSql()
  try {
    const [op] = await sql<{ id: string }[]>`
      SELECT id FROM operators WHERE name = ${OPERATOR_NAME}`
    if (!op) throw new Error(`seed missing operator ${OPERATOR_NAME}`)
    const [vehicle] = await sql<{ id: string; photos: string[] }[]>`
      SELECT id, photos FROM vehicles
      WHERE "operatorId" = ${op.id} AND status = 'AVAILABLE'
      ORDER BY id
      LIMIT 1`
    if (!vehicle) throw new Error('seed has no AVAILABLE Best Car Rental vehicle')
    targetVehicleId = vehicle.id
    originalPhotos = vehicle.photos
    return vehicle.id
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readPhotos(vehicleId: string): Promise<string[]> {
  const sql = testSql()
  try {
    const [row] = await sql<{ photos: string[] }[]>`
      SELECT photos FROM vehicles WHERE id = ${vehicleId}`
    if (!row) throw new Error(`vehicle ${vehicleId} not found`)
    return row.photos
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Restore the vehicle's original photos array — removes the uploaded photo (and any leftover
 *  from a mid-run failure), returning the row to its seeded state. */
async function restoreVehiclePhotos(): Promise<void> {
  if (!targetVehicleId) return
  const sql = testSql()
  try {
    await sql`UPDATE vehicles SET photos = ${originalPhotos} WHERE id = ${targetVehicleId}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
