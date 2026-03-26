import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useLanguage } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

interface NewCampaignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewCampaignDialog({ open, onOpenChange }: NewCampaignDialogProps) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [name, setName] = useState("")
  const [persona, setPersona] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return

    setError(null)
    setSubmitting(true)

    const { data, error: insertError } = await supabase
      .from("campaigns")
      .insert({
        name,
        persona: persona || null,
        owner_id: user.id,
      })
      .select("id")
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setName("")
    setPersona("")
    onOpenChange(false)
    navigate(`/campaign/${data.id}?tab=discover`, { replace: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sidebar.newCampaign")}</DialogTitle>
          <DialogDescription>
            {t("campaign.newDesc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-name">{t("settings.campaignName")}</FieldLabel>
              <Input
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("campaign.namePlaceholder")}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="new-persona">{t("settings.targetPersona")}</FieldLabel>
              <Textarea
                id="new-persona"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder={t("campaign.personaPlaceholder")}
                rows={3}
              />
              <FieldDescription>
                {t("settings.personaHint")}
              </FieldDescription>
            </Field>

            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting && <Spinner />}
              {submitting ? t("campaign.creating") : t("campaign.create")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
