import { useState, useEffect, type FormEvent } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

interface ScoutPreset {
  id?: string
  campaign_id: string
  name: string
  is_default: boolean
  followers_min: number | null
  followers_max: number | null
  avg_views_min: number | null
  avg_views_max: number | null
  engagement_rate_min: number | null
  engagement_rate_max: number | null
  total_likes_min: number | null
  total_likes_max: number | null
  video_count_min: number | null
  video_count_max: number | null
  has_email: string | null
  country: string | null
  created_at?: string
}

function emptyPreset(campaignId: string): ScoutPreset {
  return {
    campaign_id: campaignId,
    name: "",
    is_default: false,
    followers_min: null,
    followers_max: null,
    avg_views_min: null,
    avg_views_max: null,
    engagement_rate_min: null,
    engagement_rate_max: null,
    total_likes_min: null,
    total_likes_max: null,
    video_count_min: null,
    video_count_max: null,
    has_email: null,
    country: null,
  }
}

function formatFilterSummary(preset: ScoutPreset): string {
  const parts: string[] = []
  if (preset.followers_min != null || preset.followers_max != null) {
    const min = preset.followers_min ? formatNumber(preset.followers_min) : "0"
    const max = preset.followers_max ? formatNumber(preset.followers_max) : "\u221e"
    parts.push(`${min}-${max} followers`)
  }
  if (preset.avg_views_min != null) {
    parts.push(`>${formatNumber(preset.avg_views_min)} views`)
  }
  if (preset.engagement_rate_min != null) {
    parts.push(`>${(preset.engagement_rate_min * 100).toFixed(0)}% eng`)
  }
  return parts.join(", ") || ""
}

export default function SettingsTab({ campaign }: { campaign: Campaign }) {
  const { t } = useLanguage()
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
  const [provider, setProvider] = useState<string>("smtp")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("587")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [savingEmail, setSavingEmail] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)

  // Fetch email config on mount
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
      followers_min: editingPreset.followers_min,
      followers_max: editingPreset.followers_max,
      avg_views_min: editingPreset.avg_views_min,
      avg_views_max: editingPreset.avg_views_max,
      engagement_rate_min: editingPreset.engagement_rate_min,
      engagement_rate_max: editingPreset.engagement_rate_max,
      total_likes_min: editingPreset.total_likes_min,
      total_likes_max: editingPreset.total_likes_max,
      video_count_min: editingPreset.video_count_min,
      video_count_max: editingPreset.video_count_max,
      has_email: editingPreset.has_email,
      country: editingPreset.country,
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
    fetchPresets()
  }

  async function handleDeletePreset(id: string) {
    await supabase.from("scout_presets").delete().eq("id", id)
    toast.success(t("settings.presetDeleted"))
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.campaign")}</CardTitle>
          <CardDescription>{t("settings.campaignDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
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
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={savingCampaign}>
                {savingCampaign && <Spinner />}
                {t("settings.saveCampaign")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Scout Presets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.presets")}</CardTitle>
          <CardDescription>{t("settings.presetsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
                        value={editingPreset.followers_min ?? ""}
                        onChange={(e) =>
                          updatePresetField("followers_min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.followers_max ?? ""}
                        onChange={(e) =>
                          updatePresetField("followers_max", e.target.value ? Number(e.target.value) : null)
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
                        value={editingPreset.avg_views_min ?? ""}
                        onChange={(e) =>
                          updatePresetField("avg_views_min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.avg_views_max ?? ""}
                        onChange={(e) =>
                          updatePresetField("avg_views_max", e.target.value ? Number(e.target.value) : null)
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
                        value={editingPreset.engagement_rate_min != null ? editingPreset.engagement_rate_min * 100 : ""}
                        onChange={(e) =>
                          updatePresetField(
                            "engagement_rate_min",
                            e.target.value ? Number(e.target.value) / 100 : null,
                          )
                        }
                        min={0}
                        step={0.1}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.engagement_rate_max != null ? editingPreset.engagement_rate_max * 100 : ""}
                        onChange={(e) =>
                          updatePresetField(
                            "engagement_rate_max",
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
                        value={editingPreset.total_likes_min ?? ""}
                        onChange={(e) =>
                          updatePresetField("total_likes_min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.total_likes_max ?? ""}
                        onChange={(e) =>
                          updatePresetField("total_likes_max", e.target.value ? Number(e.target.value) : null)
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
                        value={editingPreset.video_count_min ?? ""}
                        onChange={(e) =>
                          updatePresetField("video_count_min", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                      <Input
                        type="number"
                        placeholder={t("settings.max")}
                        value={editingPreset.video_count_max ?? ""}
                        onChange={(e) =>
                          updatePresetField("video_count_max", e.target.value ? Number(e.target.value) : null)
                        }
                        min={0}
                      />
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel>{t("settings.hasEmail")}</FieldLabel>
                    <Select
                      value={editingPreset.has_email || "any"}
                      onValueChange={(v) => updatePresetField("has_email", v === "any" ? null : v)}
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
                      value={editingPreset.country || ""}
                      onChange={(e) =>
                        updatePresetField("country", e.target.value || null)
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.emailAccount")}</CardTitle>
          <CardDescription>
            {t("settings.emailDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveEmail} className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("settings.provider")}</FieldLabel>
              <Select value={provider} onValueChange={(v) => { if (v) setProvider(v) }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smtp">{t("settings.customSmtp")}</SelectItem>
                  <SelectItem value="gmail">{t("settings.gmail")}</SelectItem>
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

            {(provider === "gmail" || provider === "outlook") && (
              <p className="text-sm text-muted-foreground">
                {t("settings.oauthSoon")}
              </p>
            )}

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={savingEmail}>
                {savingEmail && <Spinner />}
                {t("settings.saveEmail")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
