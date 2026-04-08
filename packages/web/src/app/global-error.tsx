'use client'

import { getErrorMessage } from '@/lib/error-helpers'

interface GlobalErrorProps {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  if (process.env.NODE_ENV === 'development') {
    console.error(error)
  }

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          margin: 0,
          padding: '1rem',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#666' }}>Error</p>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#666', marginTop: '1rem' }}>
            {process.env.NODE_ENV === 'development'
              ? getErrorMessage(error)
              : 'An unexpected error occurred. Please try again.'}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              padding: '0.5rem 1.5rem',
              borderRadius: '0.5rem',
              border: '1px solid #ddd',
              background: '#fafafa',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
