import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { apiCall } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { MOCK_OUTREACH_CREATORS, MOCK_OUTREACH_LOG } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SendIcon, EyeIcon, MailIcon, PencilIcon } from "lucide-react"

interface Campaign {
  id: string
  name: string
}

interface OutreachCreator {
  creator_id: string
  handle: string
  emails: string[]
  status?: "pending" | "sent" | "failed"
}

interface PreviewEmail {
  creator_id: string
  handle: string
  email: string
  subject: string
  body: string
}

interface OutreachEntry {
  id: string
  email: string
  subject: string
  status: string
  error: string | null
  sent_at: string | null
  creator: { handle: string } | null
  note: string | null
  note_tag: string | null  // 'replied' | 'bounced' | 'interested' | 'declined' | null
}

function NoteCell({ entry, onSave }: { entry: OutreachEntry; onSave: (note: string, noteTag: string | null) => Promise<void> }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(entry.note || "")
  const [noteTag, setNoteTag] = useState<string>(entry.note_tag || "")
  const [saving, setSaving] = useState(false)

  const tagColors: Record<string, string> = {
    replied: "default",
    interested: "default",
    bounced: "destructive",
    declined: "secondary",
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button className="flex items-center gap-1.5 text-left text-xs hover:bg-muted rounded px-1.5 py-1 -mx-1.5 min-w-0" />
        }
      >
        {entry.note_tag && (
          <Badge variant={tagColors[entry.note_tag] as any || "outline"} className="text-[10px] shrink-0">
            {t(`outreach.tag.${entry.note_tag}`)}
          </Badge>
        )}
        {entry.note && <span className="truncate max-w-[120px] text-muted-foreground">{entry.note}</span>}
        {!entry.note_tag && !entry.note && <span className="text-muted-foreground/50">{"\u2014"}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <div className="flex flex-col gap-2">
          <Select value={noteTag} onValueChange={(v) => setNoteTag(v ?? "")}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={t("outreach.selectTag")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t("outreach.noTag")}</SelectItem>
              <SelectItem value="replied">{t("outreach.tag.replied")}</SelectItem>
              <SelectItem value="interested">{t("outreach.tag.interested")}</SelectItem>
              <SelectItem value="bounced">{t("outreach.tag.bounced")}</SelectItem>
              <SelectItem value="declined">{t("outreach.tag.declined")}</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("outreach.notePlaceholder")}
            rows={2}
            className="text-xs"
          />
          <Button
            size="sm"
            className="self-end"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              await onSave(note, noteTag || null)
              setSaving(false)
              setOpen(false)
            }}
          >
            {saving && <Spinner />}
            {t("outreach.saveNote")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function OutreachTab({ campaign }: { campaign: Campaign }) {
  const { t } = useLanguage()
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState(
    "Hi {{recipient_name}},\n\nI came across your content and thought you'd be a great fit for our campaign.\n\nLooking forward to hearing from you!"
  )
  const [creators, setCreators] = useState<OutreachCreator[]>(MOCK_OUTREACH_CREATORS)
  const [outreachLog, setOutreachLog] = useState<OutreachEntry[]>(MOCK_OUTREACH_LOG as OutreachEntry[])
  const [loading, setLoading] = useState(false)
  const [previews, setPreviews] = useState<PreviewEmail[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [dryRunDone, setDryRunDone] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)

  const fetchData = useCallback(async () => {
    // Fetch approved creators with emails
    const { data: ccData } = await supabase
      .from("campaign_creators")
      .select("creator:creators(id, handle, emails)")
      .eq("campaign_id", campaign.id)
      .eq("status", "approved")

    if (ccData && ccData.length > 0) {
      const mapped: OutreachCreator[] = ccData
        .filter((d) => d.creator)
        .map((d) => {
          const c = d.creator as unknown as Record<string, unknown>
          return {
            creator_id: c.id as string,
            handle: c.handle as string,
            emails: ((c.emails as string[]) || []),
          }
        })
        .filter((c) => c.emails.length > 0)

      setCreators(mapped)
    }

    // Fetch outreach log
    const { data: logData } = await supabase
      .from("outreach_log")
      .select("id, email, subject, status, error, sent_at, note, note_tag, creator:creators(handle)")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })

    if (logData && logData.length > 0) {
      setOutreachLog(
        logData.map((entry) => ({
          ...entry,
          creator: Array.isArray(entry.creator) ? entry.creator[0] : entry.creator,
        })) as OutreachEntry[]
      )
    }
    setLoading(false)
  }, [campaign.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function dryRun() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)

    try {
      const result = await apiCall("/api/outreach/send", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaign.id,
          creator_ids: creators.map((c) => c.creator_id),
          subject,
          body,
          dry_run: true,
        }),
      })

      setPreviews(result.preview)
      setShowPreview(true)
      setDryRunDone(true)
    } finally {
      setSending(false)
    }
  }

  async function sendAll() {
    setSending(true)

    try {
      await apiCall("/api/outreach/send", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaign.id,
          creator_ids: creators.map((c) => c.creator_id),
          subject,
          body,
          dry_run: false,
        }),
      })

      fetchData()
    } finally {
      setSending(false)
    }
  }

  function logStatusBadge(status: string) {
    switch (status) {
      case "sent":
        return <Badge variant="default" className="text-xs">{t("outreach.sent")}</Badge>
      case "failed":
        return <Badge variant="destructive" className="text-xs">{t("outreach.failed")}</Badge>
      default:
        return <Badge variant="outline" className="text-xs">{t("outreach.pending")}</Badge>
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Send Controls */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium">
              {t("outreach.readyToSend", { count: creators.length })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("outreach.onlyApproved")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowTemplate(true)}>
              <PencilIcon data-icon />
              {t("outreach.editTemplate")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={dryRun}
              disabled={sending || creators.length === 0 || !subject.trim()}
            >
              {sending ? (
                <Spinner />
              ) : (
                <EyeIcon data-icon />
              )}
              {t("outreach.dryRun")}
            </Button>
            <Button
              size="sm"
              onClick={sendAll}
              disabled={sending || !dryRunDone || creators.length === 0}
            >
              {sending ? (
                <Spinner />
              ) : (
                <SendIcon data-icon />
              )}
              {t("outreach.sendAll")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : creators.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailIcon />
              </EmptyMedia>
              <EmptyTitle>{t("outreach.noCreators")}</EmptyTitle>
              <EmptyDescription>{t("outreach.noCreatorsDesc")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">{t("outreach.handle")}</TableHead>
                <TableHead>{t("outreach.email")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creators.map((c) => (
                <TableRow key={c.creator_id}>
                  <TableCell className="font-medium py-3">@{c.handle}</TableCell>
                  <TableCell className="text-sm text-muted-foreground py-3">
                    {c.emails[0]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Outreach Log */}
      {outreachLog.length > 0 && (
        <>
          <div>
            <h3 className="text-sm font-medium mb-4">{t("outreach.log")}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[20%]">{t("outreach.handle")}</TableHead>
                  <TableHead>{t("outreach.email")}</TableHead>
                  <TableHead>{t("keywords.status")}</TableHead>
                  <TableHead className="text-right">{t("outreach.sent")}</TableHead>
                  <TableHead>{t("outreach.note")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outreachLog.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium py-3">
                      @{entry.creator?.handle || "unknown"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground py-3">
                      {entry.email}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-col items-start gap-1">
                        {logStatusBadge(entry.status)}
                        {entry.error && (
                          <span className="text-xs text-destructive">{entry.error}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground py-3">
                      {entry.sent_at
                        ? new Date(entry.sent_at).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell className="py-3">
                      <NoteCell
                        entry={entry}
                        onSave={async (note, noteTag) => {
                          await supabase
                            .from("outreach_log")
                            .update({ note, note_tag: noteTag })
                            .eq("id", entry.id)
                          fetchData()
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Template Dialog */}
      <Dialog open={showTemplate} onOpenChange={setShowTemplate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("outreach.templateTitle")}</DialogTitle>
            <DialogDescription>
              {t("outreach.templateDesc")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="subject">{t("outreach.subject")}</FieldLabel>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value)
                  setDryRunDone(false)
                }}
                placeholder={t("outreach.subjectPlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="body">{t("outreach.body")}</FieldLabel>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value)
                  setDryRunDone(false)
                }}
                rows={8}
              />
            </Field>
          </FieldGroup>
          <div className="flex justify-end">
            <Button onClick={() => setShowTemplate(false)}>{t("outreach.done")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("outreach.previewTitle")}</DialogTitle>
            <DialogDescription>
              {t("outreach.previewDesc", { count: previews.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {previews.map((p) => (
              <Card key={p.creator_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">@{p.handle}</CardTitle>
                    <span className="text-xs text-muted-foreground">{p.email}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-medium">{p.subject}</p>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground mt-2">
                    {p.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
