import type { CreateOperatorInput } from '@kuruma/shared/validators/operator'
import { type CallerContext, requirePlatformAdmin } from '../middleware/auth'
import type { Operator, OperatorRepository } from '../repositories/types'
import { resolveUniqueSlug, slugify } from './slug'

export class OperatorService {
  constructor(private readonly repo: OperatorRepository) {}

  /**
   * Create a marketplace operator. Platform-admin only (defence in depth — the
   * route also gates). The slug is server-derived from the name and made unique
   * (proposal §9 item 15); clients never supply it.
   */
  async create(ctx: CallerContext, input: CreateOperatorInput): Promise<Operator> {
    requirePlatformAdmin(ctx)
    const slug = await resolveUniqueSlug(slugify(input.name), (s) => this.repo.existsBySlug(s))
    return this.repo.create({
      name: input.name,
      slug,
      preAuthHandoffUrl: input.preAuthHandoffUrl ?? null,
    })
  }
}
