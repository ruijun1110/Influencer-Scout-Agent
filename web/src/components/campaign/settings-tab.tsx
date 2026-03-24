import { useState, useEffect, type FormEvent } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { apiCall } from "@/lib/api"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateCampaignData } from "@/lib/invalidation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
// Card imports removed — using flat section layout
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { useLanguage } from "@/lib/i18n"
import { formatNumber } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface Campaign {
  id: string
  name: string
  persona: string | null
}

interface EmailConfig {
  provider: "gmail" | "outlook" | "smtp"
  credentials_encrypted: {
    host?: string
    port?: number
    username?: string
    password?: string
  }
}

interface PresetFilters {
  followers?: { min?: number | null; max?: number | null }
  avg_views?: { min?: number | null; max?: number | null }
  engagement_rate?: { min?: number | null; max?: number | null }
  total_likes?: { min?: number | null; max?: number | null }
  video_count?: { min?: number | null; max?: number | null }
  has_email?: boolean | null
  country?: string | null
}

interface ScoutPreset {
  id?: string
  campaign_id: string
  name: string
  is_default: boolean
  filters: PresetFilters
  created_at?: string
  updated_at?: string
}

function emptyPreset(campaignId: string): ScoutPreset {
  return {
    campaign_id: campaignId,
    name: "",
    is_default: false,
    filters: {},
  }
}

function formatFilterSummary(preset: ScoutPreset): string {
  const parts: string[] = []
  const f = preset.filters
  if (f.followers?.min != null || f.followers?.max != null) {
    const min = f.followers?.min ? formatNumber(f.followers.min) : "0"
    const max = f.followers?.max ? formatNumber(f.followers.max) : "\u221e"
    parts.push(`${min}-${max} followers`)
  }
  if (f.avg_views?.min != null) {
    parts.push(`>${formatNumber(f.avg_views.min)} views`)
  }
  if (f.engagement_rate?.min != null) {
    parts.push(`>${(f.engagement_rate.min * 100).toFixed(0)}% eng`)
  }
  return parts.join(", ") || ""
}

export default function SettingsTab({ campaign }: { campaign: Campaign }) {
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  // Campaign fields
  const [name, setName] = useState(campaign.name)
  const [persona, setPersona] = useState(campaign.persona || "")
  const [savingCampaign, setSavingCampaign] = useState(false)

  // Preset state
  const [presets, setPresets] = useState<ScoutPreset[]>([])
  const [editingPreset, setEditingPreset] = useState<ScoutPreset | null>(null)
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)

  // Email config fields
  const { user } = useAuth()
  const [emailConfigLoaded, setEmailConfigLoaded] = useState(false)
  const [provider, setProvider] = useState<string>("smtp")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("587")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [savingEmail, setSavingEmail] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email?: string } | null>(null)
  const [gmailLoading, setGmailLoading] = useState(false)

  // Fetch email config on mount
  useEffect(() => {
    if (!user) return
    supabase
      .from("user_email_config")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const config = data as unknown as { provider: string; credentials_encrypted: Record<string, unknown>; gmail_email?: string }
          setProvider(config.provider)
          setHasConfig(true)
          if (config.provider === "gmail" && config.gmail_email) {
            setGmailStatus({ connected: true, email: config.gmail_email })
          }
          if (config.credentials_encrypted) {
            const creds = config.credentials_encrypted
            setHost((creds.host as string) || "")
            setPort(String(creds.port || 587))
            setUsername((creds.username as string) || "")
          }
        }
      })
      .finally(() => setEmailConfigLoaded(true))
  }, [user])

  // Fetch Gmail status on mount — also sync provider state
  useEffect(() => {
    apiCall("/api/outreach/gmail/status")
      .then((data) => {
        setGmailStatus(data)
        if (data.connected) {
          setProvider("gmail")
        }
      })
      .catch(() => setGmailStatus({ connected: false }))
  }, [])

  // Handle ?gmail_ref= or ?gmail_error= URL param when user returns from Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Handle error redirect from backend
    const gmailError = params.get("gmail_error")
    if (gmailError) {
      window.history.replaceState({}, "", window.location.pathname + "?tab=settings")
      toast.error(t("settings.gmailFailed"))
      return
    }

    const gmailRef = params.get("gmail_ref")
    if (!gmailRef) return

    // Clear the URL param immediately
    window.history.replaceState({}, "", window.location.pathname + "?tab=settings")

    ;(async () => {
      try {
        setGmailLoading(true)
        // Backend exchanges ref and stores tokens in DB (RLS-safe via user JWT)
        const result = await apiCall("/api/outreach/gmail/exchange", {
          method: "POST",
          body: JSON.stringify({ gmail_ref: gmailRef }),
        })
        setGmailStatus({ connected: true, email: result.email })
        setProvider("gmail")
        toast.success(t("settings.gmailConnected"))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.gmailFailed"))
      } finally {
        setGmailLoading(false)
      }
    })()
  }, [])

  // Fetch presets
  useEffect(() => {
    fetchPresets()
  }, [campaign.id])

  async function fetchPresets() {
    const { data } = await supabase
      .from("scout_presets")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("created_at")
    if (data) setPresets(data as ScoutPreset[])
  }

  async function handleSaveCampaign(e: FormEvent) {
    e.preventDefault()
    setSavingCampaign(true)
    await supabase
      .from("campaigns")
      .update({
        name,
        persona: persona || null,
      })
      .eq("id", campaign.id)
    setSavingCampaign(false)
    invalidateCampaignData(queryClient, campaign.id, ["campaign"])
    toast.success(t("settings.campaignSaved"))
  }

  async function handleSavePreset() {
    if (!editingPreset) return
    setSavingPreset(true)

    // If setting as default, clear default on other presets first
    if (editingPreset.is_default) {
      await supabase
        .from("scout_presets")
        .update({ is_default: false })
        .eq("campaign_id", campaign.id)
    }

    const payload = {
      campaign_id: editingPreset.campaign_id,
      name: editingPreset.name,
      is_default: editingPreset.is_default,
      filters: editingPreset.filters,
    }

    if (editingPreset.id) {
      await supabase
        .from("scout_presets")
        .update(payload)
        .eq("id", editingPreset.id)
    } else {
      await supabase
        .from("scout_presets")
        .insert(payload)
    }

    setSavingPreset(false)
    setPresetDialogOpen(false)
    setEditingPreset(null)
    toast.success(t("settings.presetSaved"))
    invalidateCampaignData(queryClient, campaign.id, ["presets"])
    fetchPresets()
  }

  async function handleDeletePreset(id: string) {
    await supabase.from("scout_presets").delete().eq("id", id)
    toast.success(t("settings.presetDeleted"))
    invalidateCampaignData(queryClient, campaign.id, ["presets"])
    fetchPresets()
  }

  async function handleSetDefault(id: string) {
    await supabase
      .from("scout_presets")
      .update({ is_default: false })
      .eq("campaign_id", campaign.id)
    await supabase
      .from("scout_presets")
      .update({ is_default: true })
      .eq("id", id)
    invalidateCampaignData(queryClient, campaign.id, ["presets"])
    fetchPresets()
  }

  function openNewPreset() {
    setEditingPreset(emptyPreset(campaign.id))
    setPresetDialogOpen(true)
  }

  function openEditPreset(preset: ScoutPreset) {
    setEditingPreset({ ...preset })
    setPresetDialogOpen(true)
  }

  function updatePresetField<K extends keyof ScoutPreset>(field: K, value: ScoutPreset[K]) {
    setEditingPreset((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  function updateFilter(key: keyof PresetFilters, field: "min" | "max", value: number | null) {
    if (!editingPreset) return
    setEditingPreset({
      ...editingPreset,
      filters: {
        ...editingPreset.filters,
        [key]: { ...((editingPreset.filters[key] as Record<string, unknown>) || {}), [field]: value },
      },
    })
  }

  function updateFilterField(key: "has_email" | "country", value: boolean | string | null) {
    if (!editingPreset) return
    setEditingPreset({
      ...editingPreset,
      filters: { ...editingPreset.filters, [key]: value },
    })
  }

  async function connectGmail() {
    setGmailLoading(true)
    try {
      const returnUrl = encodeURIComponent(window.location.href)
      const { url } = await apiCall(`/api/outreach/gmail/auth-url?return_url=${returnUrl}`)
      window.location.href = url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.gmailFailed"))
      setGmailLoading(false)
    }
  }

  async function disconnectGmail() {
    setGmailLoading(true)
    try {
      await apiCall("/api/outreach/gmail/disconnect", { method: "POST" })
      await supabase.from("user_email_config").update({
        provider: null,
        credentials_encrypted: null,
        gmail_email: null,
      }).eq("user_id", user?.id)
      setGmailStatus({ connected: false })
      toast.success(t("settings.gmailDisconnected"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.gmailFailed"))
    } finally {
      setGmailLoading(false)
    }
  }

  async function handleSaveEmail(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setSavingEmail(true)

    const config: EmailConfig = {
      provider: provider as "gmail" | "outlook" | "smtp",
      credentials_encrypted: {
        host,
        port: Number(port),
        username,
        ...(password ? { password } : {}),
      },
    }

    if (hasConfig) {
      await supabase
        .from("user_email_config")
        .update(config)
        .eq("user_id", user.id)
    } else {
      await supabase
        .from("user_email_config")
        .insert({ ...config, user_id: user.id })
      setHasConfig(true)
    }

    setSavingEmail(false)
    toast.success(t("settings.emailSaved"))
    setPassword("")
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col divide-y p-6">
      {/* Campaign */}
      <section className="pb-8">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">{t("settings.campaign")}</h2>
        <form onSubmit={handleSaveCampaign} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="campaign-name">{t("settings.campaignName")}</FieldLabel>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="persona">{t("settings.targetPersona")}</FieldLabel>
            <Textarea
              id="persona"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={3}
            />
            <FieldDescription>{t("settings.personaHint")}</FieldDescription>
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={savingCampaign}>
              {savingCampaign && <Spinner />}
              {t("settings.saveCampaign")}
            </Button>
          </div>
        </form>
      </section>

      {/* Scout Presets */}
      <section className="py-8">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">{t("settings.presets")}</h2>
        <div className="flex flex-col gap-4">
          {presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.noPresets")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className={preset.is_default ? "font-bold text-sm" : "text-sm"}>
                        {preset.name}
                      </span>
                      {preset.is_default && (
                        <Badge variant="secondary">{t("settings.default")}</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatFilterSummary(preset) || t("settings.noFilters")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!preset.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(preset.id!)}
                      >
                        {t("settings.default")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditPreset(preset)}
                    >
                      {t("settings.editPreset")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => handleDeletePreset(preset.id!)}
                    >
                      {t("keywords.delete")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <Button variant="outline" size="sm" onClick={openNewPreset}>
              {t("settings.newPreset")}
            </Button>
          </div>

          {/* Preset Editor Dialog */}
          <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingPreset?.id ? t("settings.editPreset") : t("settings.newPreset")}
                </DialogTitle>
                <DialogDescription>
                  {t("settings.presetsDesc")}
                </DialogDescription>
              </DialogHeader>

              {editingPreset && (
                <div className="flex flex-col gap-4 py-2">
                  <Field>
                    <FieldLabel>{t("settings.presetName")}</FieldLabel>
                    <Input
                      value={editingPreset.name}
                      onChange={(e) => updatePresetField("name", e.target.value)}
                      required
                    />
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.followers")}</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder={t("settings.min")}
                        value={editingPreset.filters.followers?.min ?? ""}
                        onChange={(e) =>
                          updateFilter("followers", "min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.filters.followers?.max ?? ""}
                        onChange={(e) =>
                          updateFilter("followers", "max", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.avgViews")}</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder={t("settings.min")}
                        value={editingPreset.filters.avg_views?.min ?? ""}
                        onChange={(e) =>
                          updateFilter("avg_views", "min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.filters.avg_views?.max ?? ""}
                        onChange={(e) =>
                          updateFilter("avg_views", "max", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.engagementRate")}</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder={t("settings.min")}
                        value={editingPreset.filters.engagement_rate?.min != null ? editingPreset.filters.engagement_rate.min * 100 : ""}
                        onChange={(e) =>
                          updateFilter(
                            "engagement_rate",
                            "min",
                            e.target.value ? Number(e.target.value) / 100 : null,
                          )
                        }
                        min={0}
                        step={0.1}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.filters.engagement_rate?.max != null ? editingPreset.filters.engagement_rate.max * 100 : ""}
                        onChange={(e) =>
                          updateFilter(
                            "engagement_rate",
                            "max",
                            e.target.value ? Number(e.target.value) / 100 : null,
                          )
                        }
                        min={0}
                        step={0.1}
                      />
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.totalLikes")}</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder={t("settings.min")}
                        value={editingPreset.filters.total_likes?.min ?? ""}
                        onChange={(e) =>
                          updateFilter("total_likes", "min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.filters.total_likes?.max ?? ""}
                        onChange={(e) =>
                          updateFilter("total_likes", "max", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.videoCount")}</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder={t("settings.min")}
                        value={editingPreset.filters.video_count?.min ?? ""}
                        onChange={(e) =>
                          updateFilter("video_count", "min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.filters.video_count?.max ?? ""}
                        onChange={(e) =>
                          updateFilter("video_count", "max", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.hasEmail")}</FieldLabel>
                    <Select
                      value={editingPreset.filters.has_email == null ? "any" : editingPreset.filters.has_email ? "yes" : "no"}
                      onValueChange={(v) => updateFilterField("has_email", v === "any" ? null : v === "yes")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t("settings.any")}</SelectItem>
                        <SelectItem value="yes">{t("settings.yes")}</SelectItem>
                        <SelectItem value="no">{t("settings.no")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.country")}</FieldLabel>
                    <Input
                      value={editingPreset.filters.country || ""}
                      onChange={(e) =>
                        updateFilterField("country", e.target.value || null)
                      }
                    />
                  </Field>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="is-default"
                      checked={editingPreset.is_default}
                      onCheckedChange={(checked) =>
                        updatePresetField("is_default", checked === true)
                      }
                    />
                    <label htmlFor="is-default" className="text-sm">
                      {t("settings.isDefault")}
                    </label>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPresetDialogOpen(false)
                    setEditingPreset(null)
                  }}
                >
                  {t("keywords.cancel")}
                </Button>
                <Button onClick={handleSavePreset} disabled={savingPreset || !editingPreset?.name}>
                  {savingPreset && <Spinner />}
                  {t("settings.saveCampaign")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </section>

      {/* Email Account */}
      <section className="py-8">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">{t("settings.emailAccount")}</h2>
        {!emailConfigLoaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Spinner className="size-4" />
          </div>
        ) : (
        <form onSubmit={handleSaveEmail} className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("settings.provider")}</FieldLabel>
              <Select value={provider} onValueChange={(v) => { if (v) setProvider(v) }}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">{t("settings.gmail")}</SelectItem>
                  <SelectItem value="smtp">{t("settings.customSmtp")}</SelectItem>
                  <SelectItem value="outlook">{t("settings.outlook")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {provider === "smtp" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="host">{t("settings.smtpHost")}</FieldLabel>
                    <Input
                      id="host"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder={t("settings.smtpHostPlaceholder")}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="port">{t("settings.port")}</FieldLabel>
                    <Input
                      id="port"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder={t("settings.portPlaceholder")}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="smtp-username">{t("settings.username")}</FieldLabel>
                  <Input
                    id="smtp-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("settings.usernamePlaceholder")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="smtp-password">{t("settings.password")}</FieldLabel>
                  <Input
                    id="smtp-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={hasConfig ? t("settings.passwordHint") : t("settings.enterPassword")}
                  />
                </Field>
              </>
            )}

            {provider === "gmail" && (
              <div className="mt-3">
                {gmailStatus?.connected ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-emerald-600">{t("settings.gmailConnectedLabel")}</span>
                        <span className="text-xs text-muted-foreground">{gmailStatus.email}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={gmailLoading}
                          onClick={async () => {
                            setGmailLoading(true)
                            try {
                              await apiCall("/api/outreach/gmail/test-send", {
                                method: "POST",
                                body: JSON.stringify({ to_email: gmailStatus.email }),
                              })
                              toast.success(t("settings.testEmailSent"))
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : t("settings.testEmailFailed"))
                            } finally {
                              setGmailLoading(false)
                            }
                          }}
                        >
                          {gmailLoading && <Spinner />}
                          {t("settings.sendTestEmail")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={disconnectGmail} disabled={gmailLoading}>
                          {t("settings.disconnectGmail")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button onClick={connectGmail} disabled={gmailLoading}>
                    {gmailLoading && <Spinner />}
                    {t("settings.connectGmail")}
                  </Button>
                )}
              </div>
            )}

            {provider === "outlook" && (
              <p className="text-sm text-muted-foreground">
                {t("settings.oauthSoon")}
              </p>
            )}

            {provider === "smtp" && (
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={savingEmail}>
                  {savingEmail && <Spinner />}
                  {t("settings.saveEmail")}
                </Button>
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  )
}
