export interface EmailMessage {
  to: string
  from: string
  subject: string
  html: string
  text: string // plain-text fallback; deliverability + screen readers
  replyTo?: string
}

export interface SendResult {
  providerMessageId: string
}

/**
 * Provider-agnostic outbound email port. Implementations call a vendor
 * (Resend, SES, Postmark…); the service layer depends on this interface so
 * the vendor swaps at the composition root. Throws on provider failure —
 * the dispatcher catches, logs FAILED, and never rolls back the booking.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>
}
