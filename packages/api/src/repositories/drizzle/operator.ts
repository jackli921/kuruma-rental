import { operators } from '@kuruma/shared/db/schema'
import { asc, count, eq, isNull } from 'drizzle-orm'
import type { Operator } from '../../stores'
import type { OperatorRepository, OperatorUpdatePatch } from '../types'
import type { Db } from './shared'

export class DrizzleOperatorRepository implements OperatorRepository {
  constructor(private readonly db: Db) {}

  async existsBySlug(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: operators.id })
      .from(operators)
      .where(eq(operators.slug, slug))
      .limit(1)
    return row !== undefined
  }

  async list(): Promise<Operator[]> {
    return this.db.select().from(operators).orderBy(asc(operators.name))
  }

  // #1087 platform overview — #1088 narrowed it to active operators only
  // (deactivatedAt IS NULL), so a deactivated tenant drops out of the KPI.
  async count(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(operators)
      .where(isNull(operators.deactivatedAt))
    return row?.value ?? 0
  }

  async findById(id: string): Promise<Operator | undefined> {
    const [row] = await this.db.select().from(operators).where(eq(operators.id, id)).limit(1)
    return row
  }

  async findBySlug(slug: string): Promise<Operator | undefined> {
    const [row] = await this.db.select().from(operators).where(eq(operators.slug, slug)).limit(1)
    return row
  }

  async create(data: {
    name: string
    slug: string
    preAuthHandoffUrl: string | null
  }): Promise<Operator> {
    // operators.slug is UNIQUE — a concurrent create racing on the same slug
    // surfaces as a unique-violation here rather than silently colliding.
    const [row] = await this.db
      .insert(operators)
      .values({ name: data.name, slug: data.slug, preAuthHandoffUrl: data.preAuthHandoffUrl })
      .returning()
    if (!row) throw new Error('Failed to create operator')
    return row
  }

  async update(id: string, patch: OperatorUpdatePatch): Promise<Operator | undefined> {
    // `set(patch)` only writes the keys present (an absent field is left
    // unchanged; `preAuthHandoffUrl: null` clears the column). RETURNING gives
    // the post-update row, or nothing when the id matched no operator.
    const [row] = await this.db
      .update(operators)
      .set(patch)
      .where(eq(operators.id, id))
      .returning()
    return row
  }
}
