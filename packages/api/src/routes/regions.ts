import { Hono } from 'hono'
import type { RegionRepository } from '../repositories/types'
import { cachePublic, ok } from './helpers'

// Regions are platform-global reference data that change rarely (a new prefecture
// onboards with an operator), so cache hard at the edge. The web client fetches
// this once and builds the cascading dropdowns from the flat list.
const CACHE_SECONDS = 3600

/**
 * Public region taxonomy (#394). Anonymous — registered with no `requireAuth` so
 * the renter search dropdowns load before login. A flat list (parentId edges);
 * the cascade is built client-side. No pagination: the whole tree is a few dozen
 * rows. HTTP in/out only; the repo owns the read.
 *
 * #651 2b: the payload carries the full RegionNode — type/slug/assignable/status +
 * area centroid lat/lng — to anonymous callers. Intentional: the operator cascade
 * and the renter map (Slice 3) need them, and region centroids aren't sensitive.
 */
export function createRegionRoutes(regionRepo: RegionRepository) {
  return new Hono().get('/regions', async (c) => {
    const regions = await regionRepo.findAll()
    cachePublic(c, CACHE_SECONDS)
    return ok(c, regions)
  })
}
