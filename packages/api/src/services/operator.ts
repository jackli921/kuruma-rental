import type { CreateOperatorInput } from '@kuruma/shared/validators/operator'
import { type CallerContext, isOperatorRole, requirePlatformAdmin } from '../middleware/auth'
import type { Operator, OperatorRepository } from '../repositories/types'
import { resolveUniqueSlug, slugify } from './slug'

export class OperatorService {
  constructor(private readonly repo: OperatorRepository) {}

  /**
   * Resolve an operator by id for the business portal (#387). An OPERATOR_*
   * caller may only resolve its OWN operator — any other id reads as undefined
   * so the route returns 404 (never leaking another tenant's existence).
   * Bypass roles (PLATFORM_ADMIN, legacy STAFF/ADMIN) resolve any operator.
   */
  async getById(ctx: CallerContext, id: string): Promise<Operator | undefined> {
    return this.scopeToCaller(ctx, await this.repo.findById(id))
  }

  /** Slug variant of getById — powers the `/manage/<slug>` URL resolution. */
  async getBySlug(ctx: CallerContext, slug: string): Promise<Operator | undefined> {
    return this.scopeToCaller(ctx, await this.repo.findBySlug(slug))
  }

  /**
   * List operators for the admin operator picker (#407). Bypass roles
   * (PLATFORM_ADMIN, legacy STAFF/ADMIN) see every operator; an OPERATOR_*
   * caller sees only its own row (and nothing if it carries no operatorId —
   * fail-closed, never leaking other tenants).
   */
  async list(ctx: CallerContext): Promise<Operator[]> {
    const all = await this.repo.list()
    if (!isOperatorRole(ctx.role)) return all
    return all.filter((o) => o.id === ctx.operatorId)
  }

  private scopeToCaller(ctx: CallerContext, operator: Operator | undefined): Operator | undefined {
    if (!operator) return undefined
    if (isOperatorRole(ctx.role) && operator.id !== ctx.operatorId) return undefined
    return operator
  }

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
