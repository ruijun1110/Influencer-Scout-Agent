import { useState, useEffect, type FormEvent, type MouseEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { useLanguage } from "@/lib/i18n"

export default function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const { t } = useLanguage()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  // Redirect when authenticated — single source of truth for navigation
  useEffect(() => {
    if (!loading && user) {
      navigate("/", { replace: true })
    }
  }, [user, loading, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (signingIn || resetting) return
    setError(null)
    setSigningIn(true)
    try {
      await signIn(email, password)
      // Don't navigate here — the useEffect above handles redirect
      // once onAuthStateChange sets user state
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("login.signInFailed"))
      setSigningIn(false)
    }
  }

  async function handleForgotPassword(e: MouseEvent) {
    e.preventDefault()
    if (resetting || signingIn) return
    if (!email.trim()) {
      setError(t("login.forgotHint"))
      return
    }
    setError(null)
    setResetting(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email)
      if (resetError) setError(resetError.message)
      else {
        toast.success(t("login.resetSent"))
        setResetSent(true)
      }
    } catch {
      setError(t("login.resetFailed"))
    } finally {
      setResetting(false)
    }
  }

  if (loading) return null

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("login.title")}</CardTitle>
            <CardDescription>{t("login.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">{t("login.email")}</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("login.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </Field>
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">{t("login.password")}</FieldLabel>
                    <Button variant="link" type="button" onClick={handleForgotPassword} disabled={signingIn || resetting} className="ml-auto">
                      {resetting ? <Spinner /> : null}
                      {t("login.forgotPassword")}
                    </Button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </Field>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                {resetSent && (
                  <Alert>
                    <AlertDescription>{t("login.resetSent")}</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <Button type="submit" className="w-full" disabled={signingIn || resetting}>
                    {signingIn && <Spinner />}
                    {signingIn ? t("login.signingIn") : t("login.signIn")}
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
