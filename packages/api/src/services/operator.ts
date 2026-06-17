import type { CreateOperatorInput, UpdateOperatorInput } from '@kuruma/shared/validators/operator'
import {
  type CallerContext,
  isOperatorRole,
  requireOperatorOwnerWrite,
  requirePlatformAdmin,
} from '../middleware/auth'
import type { Operator, OperatorRepository } from '../repositories/types'
import { resolveUniqueSlug, slugify } from './slug'

/**
 * The canonical operator wire shape (#903) — the SINGLE shape every detail
 * endpoint for an operator returns: `GET /operators/:id`, `GET /operators/by-slug/
 * :slug`, and `PATCH /operators/:id` all project through {@link toOperatorProfile}.
 * Excludes `createdAt`/`updatedAt` (raw Date columns) so reads and writes agree on
 * one contract instead of the route leaking the full row on read and a projection
 * on write. The admin picker `list` returns a leaner `{id,name,slug}` summary by
 * design (collection vs detail), which is the expected REST asymmetry.
 */
export interface OperatorProfile {
  id: string
  name: string
  slug: string
  preAuthHandoffUrl: string | null
}

export function toOperatorProfile(op: Operator): OperatorProfile {
  return { id: op.id, name: op.name, slug: op.slug, preAuthHandoffUrl: op.preAuthHandoffUrl }
}

/**
 * Structured audit of a change to an operator's renter-facing money-flow
 * controls (#914). `preAuthHandoffUrl` is the pay-at-pickup handoff URL —
 * owner-only to write (#903) — so each change records who/when and old->new.
 * Mirrors {@link ProviderInviteAuditEvent}: an injected sink (never hardcoded)
 * keeps the trail assertable in tests and swappable for a durable store later
 * without touching the service.
 */
export interface OperatorProfileAuditEvent {
  readonly type: 'OPERATOR_PROFILE_UPDATED'
  readonly operatorId: string
  readonly actorUserId: string
  readonly field: 'preAuthHandoffUrl'
  readonly oldValue: string | null
  readonly newValue: string | null
  readonly changedAt: Date
}

// index.ts wires a console-backed default.
export type RecordOperatorProfileAudit = (event: OperatorProfileAuditEvent) => void

export class OperatorService {
  constructor(
    private readonly repo: OperatorRepository,
    private readonly recordAudit: RecordOperatorProfileAudit,
  ) {}

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

  /**
   * Self-service operator profile update (#903). Load-then-authorize: resolve the
   * row through `scopeToCaller` first so a foreign/absent id reads as `undefined`
   * (the route 404s, never leaking existence) BEFORE any field-level gate runs.
   * Only then is the owner-only `preAuthHandoffUrl` gate applied — so a staff
   * caller patching another tenant's handoff still gets a 404, not a 403 that
   * would confirm the tenant exists. Writes `updatedAt` (the column has no
   * `$onUpdate`). Returns the wire projection, or `undefined` when not found.
   */
  async update(
    ctx: CallerContext,
    id: string,
    input: UpdateOperatorInput,
  ): Promise<OperatorProfile | undefined> {
    const existing = this.scopeToCaller(ctx, await this.repo.findById(id))
    if (!existing) return undefined

    // `preAuthHandoffUrl` is a renter-facing money-flow control — owner-only,
    // even though `name` is open to all fleet-write roles. The key being present
    // (string OR explicit null) is the write attempt; an absent key is not.
    if ('preAuthHandoffUrl' in input) requireOperatorOwnerWrite(ctx)

    // Spread only the keys the patch actually carries — passing `name: undefined`
    // would overwrite the column (in-memory) and breaks exactOptionalPropertyTypes.
    const updated = await this.repo.update(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...('preAuthHandoffUrl' in input
        ? { preAuthHandoffUrl: input.preAuthHandoffUrl ?? null }
        : {}),
      updatedAt: new Date(),
    })
    if (!updated) return undefined

    // #914: trail the money-flow control change. The owner-gate above already
    // ran; emit only when the value actually moved, so a no-op re-save stays
    // silent (and a name-only patch carries no key, so it never emits).
    if ('preAuthHandoffUrl' in input) {
      const newValue = input.preAuthHandoffUrl ?? null
      if (newValue !== existing.preAuthHandoffUrl) {
        this.recordAudit({
          type: 'OPERATOR_PROFILE_UPDATED',
          operatorId: existing.id,
          actorUserId: ctx.userId,
          field: 'preAuthHandoffUrl',
          oldValue: existing.preAuthHandoffUrl,
          newValue,
          changedAt: new Date(),
        })
      }
    }
    return toOperatorProfile(updated)
  }
}
