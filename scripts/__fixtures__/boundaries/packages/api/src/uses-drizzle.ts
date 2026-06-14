// #722 OK fixture: only packages/web is forbidden from runtime DB access; api is fine.
import { eq } from 'drizzle-orm'

export const equals = eq
