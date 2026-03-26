import { useState, useEffect, type FormEvent } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useLanguage } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface EmailConfig {
  provider: "gmail" | "outlook" | "smtp"
  credentials_encrypted: {
    host?: string
    port?: number
    username?: string
    password?: string
  }
}

export default function SettingsPage() {
  const { user } = useAuth()
  const { t } = useLanguage()

  const [provider, setProvider] = useState<string>("smtp")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("587")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)

  // Password change
  const [newPassword, setNewPassword] = useState("")
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from("user_email_config")
      .select("*")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const config = data as unknown as { provider: string; credentials_encrypted: Record<string, unknown> }
          setProvider(config.provider)
          setHasConfig(true)
          if (config.credentials_encrypted) {
            const creds = config.credentials_encrypted
            setHost((creds.host as string) || "")
            setPort(String(creds.port || 587))
            setUsername((creds.username as string) || "")
          }
        }
      })
  }, [user])

  async function handleSaveEmail(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)

    const config: EmailConfig = {
      provider: provider as "gmail" | "outlook" | "smtp",
      credentials_encrypted: {
        host,
        port: Number(port),
        username,
        ...(password ? { password } : {}),
      },
    }

    let saveError = null
    if (hasConfig) {
      const { error } = await supabase
        .from("user_email_config")
        .update(config)
        .eq("user_id", user.id)
      saveError = error
    } else {
      const { error } = await supabase
        .from("user_email_config")
        .insert({ ...config, user_id: user.id })
      saveError = error
      if (!error) setHasConfig(true)
    }

    setSaving(false)
    if (saveError) {
      toast.error(saveError.message)
      return
    }
    toast.success(t("settings.emailSaved"))
    setPassword("")
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordSaving(true)

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setPasswordSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(t("settings.passwordUpdated"))
    setNewPassword("")
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your email configuration and account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email Account</CardTitle>
          <CardDescription>
            Configure your email provider for sending outreach emails.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveEmail}>
            <FieldGroup>
              <Field>
                <FieldLabel>Provider</FieldLabel>
                <Select value={provider} onValueChange={(v) => { if (v) setProvider(v) }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smtp">Custom SMTP</SelectItem>
                    <SelectItem value="gmail">Gmail (OAuth)</SelectItem>
                    <SelectItem value="outlook">Outlook (OAuth)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {provider === "smtp" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="host">SMTP Host</FieldLabel>
                      <Input
                        id="host"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="smtp.example.com"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="port">Port</FieldLabel>
                      <Input
                        id="port"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        placeholder="587"
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="smtp-username">Username</FieldLabel>
                    <Input
                      id="smtp-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="your@email.com"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="smtp-password">Password</FieldLabel>
                    <Input
                      id="smtp-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={hasConfig ? "Leave blank to keep current" : "Enter password"}
                    />
                  </Field>
                </>
              )}

              {(provider === "gmail" || provider === "outlook") && (
                <p className="text-sm text-muted-foreground">
                  OAuth integration coming soon. Use Custom SMTP for now.
                </p>
              )}

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner />}
                  Save Email Config
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-password">New Password</FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  minLength={6}
                  required
                />
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" variant="outline" disabled={passwordSaving}>
                  {passwordSaving && <Spinner />}
                  Update Password
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
