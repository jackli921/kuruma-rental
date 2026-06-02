import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface User {
    role?: string
    // Tenant the user belongs to. Present for OPERATOR_* roles only.
    operatorId?: string | null
  }

  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role: string
      operatorId?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string
    operatorId?: string | null
  }
}
