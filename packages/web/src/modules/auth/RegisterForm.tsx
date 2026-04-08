'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { register } from './actions'

export function RegisterForm() {
  const t = useTranslations('auth')
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    setGlobalError(null)
    setPending(true)

    const formData = new FormData(e.currentTarget)
    const result = await register({
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })

    setPending(false)

    if (!result.success) {
      if (result.errors) {
        setErrors(result.errors)
      }
      if (result.error) {
        setGlobalError(result.error)
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('register')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {globalError && (
            <p className="text-sm text-red-600">{globalError}</p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" name="name" type="text" required />
            {errors.name?.map((msg) => (
              <p key={msg} className="text-sm text-red-600">{msg}</p>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" name="email" type="email" required />
            {errors.email?.map((msg) => (
              <p key={msg} className="text-sm text-red-600">{msg}</p>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input id="password" name="password" type="password" required />
            {errors.password?.map((msg) => (
              <p key={msg} className="text-sm text-red-600">{msg}</p>
            ))}
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? '...' : t('register')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
