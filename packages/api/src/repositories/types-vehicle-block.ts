import type { VehicleBlock } from '../stores'

/**
 * #1101: scheduled vehicle blocks — the availability primitive. NOT
 * ctx-scoped: operatorId is server-derived from the vehicle (the route resolves
 * the vehicle in the caller's tenant, then the repo re-asserts via the
 * composite-FK seal + the scoped `delete`). The block-vs-block guarantee is the
 * `vehicle_blocks_no_overlap` GiST EXCLUDE; `findOverlapping` powers the
 * app-level booking-vs-block + availability subtraction (a single EXCLUDE can't
 * span two tables).
 */
export interface VehicleBlockRepository {
  // createdAt is DB-defaulted; operatorId is supplied by the caller already
  // resolved from the vehicle (never client input).
  create(data: Omit<VehicleBlock, 'id' | 'createdAt'>): Promise<VehicleBlock>
  findById(id: string): Promise<VehicleBlock | undefined>
  /** Blocks on `vehicleId` whose [startAt, endAt) overlaps [from, to). Half-open
   *  on both ends — adjacent windows (block.endAt === from) do NOT overlap,
   *  matching the GiST `&&` on tstzrange and the booking exclusion. */
  findOverlapping(vehicleId: string, from: Date, to: Date): Promise<VehicleBlock[]>
  /** Operator-scoped hard delete (defence-in-depth, must-fix #4): returns the
   *  removed block, or undefined when no block with that id belongs to the
   *  operator (unknown id OR another tenant's block). */
  delete(id: string, operatorId: string): Promise<VehicleBlock | undefined>
}
