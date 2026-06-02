import { operators } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import type { Operator } from '../../stores'
import type { OperatorRepository } from '../types'
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
}
