import { useState, useEffect, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useLanguage } from "@/lib/i18n"

export default function SetPasswordPage() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const { t } = useLanguage()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true })
    }
  }, [user, loading, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t("setPassword.mismatch"))
      return
    }

    if (password.length < 6) {
      setError(t("setPassword.tooShort"))
      return
    }

    setSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
      } else {
        // Full reload clears the module-level hash flag so all useAuth
        // instances start fresh with needsPasswordSet=false.
        window.location.replace("/")
      }
    } catch {
      setError(t("setPassword.failed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("setPassword.title")}</CardTitle>
            <CardDescription>
              {t("setPassword.subtitle")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">{t("setPassword.password")}</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("setPassword.enterPassword")}
                    minLength={6}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-password">{t("setPassword.confirm")}</FieldLabel>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("setPassword.confirmPlaceholder")}
                    minLength={6}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Field>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting && <Spinner />}
                    {submitting ? t("setPassword.setting") : t("setPassword.submit")}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
