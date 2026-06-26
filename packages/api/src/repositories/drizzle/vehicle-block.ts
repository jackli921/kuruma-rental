import { vehicleBlocks } from '@kuruma/shared/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { VehicleBlock } from '../../stores'
import type { VehicleBlockRepository } from '../types'
import { type Db, toVehicleBlock, vehicleBlockColumns } from './shared'

export class DrizzleVehicleBlockRepository implements VehicleBlockRepository {
  constructor(private readonly db: Db) {}

  async create(data: Omit<VehicleBlock, 'id' | 'createdAt'>): Promise<VehicleBlock> {
    const rows = await this.db
      .insert(vehicleBlocks)
      .values({
        operatorId: data.operatorId,
        vehicleId: data.vehicleId,
        startAt: data.startAt,
        endAt: data.endAt,
        kind: data.kind,
        reason: data.reason,
        notes: data.notes,
        createdBy: data.createdBy,
      })
      .returning(vehicleBlockColumns)
    return toVehicleBlock(rows[0]!)
  }

  async findById(id: string): Promise<VehicleBlock | undefined> {
    const rows = await this.db
      .select(vehicleBlockColumns)
      .from(vehicleBlocks)
      .where(eq(vehicleBlocks.id, id))
      .limit(1)
    const row = rows[0]
    return row ? toVehicleBlock(row) : undefined
  }

  async findOverlapping(vehicleId: string, from: Date, to: Date): Promise<VehicleBlock[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()
    // Same half-open tstzrange overlap as the `vehicle_blocks_no_overlap` EXCLUDE
    // and the booking exclusion — adjacent windows do not overlap.
    const rows = await this.db
      .select(vehicleBlockColumns)
      .from(vehicleBlocks)
      .where(
        and(
          eq(vehicleBlocks.vehicleId, vehicleId),
          sql`tstzrange("startAt", "endAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )
    return rows.map(toVehicleBlock)
  }

  async delete(id: string, operatorId: string): Promise<VehicleBlock | undefined> {
    // Operator-scoped DELETE: the WHERE narrows to (id, operatorId), so a foreign
    // tenant's block matches zero rows and returns undefined — the data-layer
    // half of the defence-in-depth scope (must-fix #4).
    const rows = await this.db
      .delete(vehicleBlocks)
      .where(and(eq(vehicleBlocks.id, id), eq(vehicleBlocks.operatorId, operatorId)))
      .returning(vehicleBlockColumns)
    const row = rows[0]
    return row ? toVehicleBlock(row) : undefined
  }
}
