import type { UserRepository } from '../repositories/types'
import type { User } from '../stores'

export class CustomerService {
  constructor(private readonly userRepo: UserRepository) {}

  async search(query: string): Promise<User[]> {
    return this.userRepo.search(query)
  }

  async quickCreate(input: {
    name: string
    email?: string | undefined
    phone?: string | undefined
    language: string
  }): Promise<{ user: User; created: boolean }> {
    // Fast-path: if a customer already exists for this email/phone, return it
    // without attempting an insert. The repository also handles concurrent
    // inserts idempotently, but this short-circuits the common case.
    if (input.email) {
      const existing = await this.userRepo.findByEmail(input.email)
      if (existing) return { user: existing, created: false }
    }
    if (input.phone) {
      const existing = await this.userRepo.findByPhone(input.phone)
      if (existing) return { user: existing, created: false }
    }

    const user = await this.userRepo.quickCreate({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      language: input.language,
    })
    return { user, created: true }
  }
}
