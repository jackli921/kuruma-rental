import { Hono } from 'hono'
import type { AvailabilityRepository } from '../repositories/types'

function parseTimeRange(c: {
  req: { query: (key: string) => string | undefined }
}): { from: Date; to: Date } | { error: string } {
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  if (!fromParam || !toParam) {
    return { error: 'Both "from" and "to" query parameters are required' }
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: '"from" and "to" must be valid ISO datetime strings' }
  }

  if (to <= from) {
    return { error: '"to" must be after "from"' }
  }

  return { from, to }
}

export function createAvailabilityRoutes(repo: AvailabilityRepository): Hono {
  const availability = new Hono()

  availability.get('/availability', async (c) => {
    const parsed = parseTimeRange(c)

    if ('error' in parsed) {
      return c.json({ success: false, error: parsed.error }, 400)
    }

    const { from, to } = parsed
    const available = await repo.findAvailableVehicles(from, to)

    return c.json({ success: true, data: available })
  })

  availability.get('/availability/:vehicleId', async (c) => {
    const vehicleId = c.req.param('vehicleId')
    const parsed = parseTimeRange(c)

    if ('error' in parsed) {
      return c.json({ success: false, error: parsed.error }, 400)
    }

    const { from, to } = parsed
    const result = await repo.checkVehicleAvailability(vehicleId, from, to)

    if (!result) {
      return c.json({ success: false, error: 'Vehicle not found' }, 404)
    }

    if (result.available) {
      return c.json({
        success: true,
        data: { available: true, vehicle: result.vehicle },
      })
    }

    return c.json({
      success: true,
      data: {
        available: false,
        vehicle: result.vehicle,
        conflicts: result.conflicts,
      },
    })
  })

  return availability
}
