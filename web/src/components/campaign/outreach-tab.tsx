import { useEffect, useState, useCallback, useRef } from "react"
import { useOutletContext } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { apiCall } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { toast } from "sonner"
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
import { SendIcon, EyeIcon, MailIcon, PencilIcon, PaperclipIcon, XIcon, TrashIcon, ExternalLinkIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"

interface Campaign {
  id: string
  name: string
}

interface OutreachCreator {
  creator_id: string
  campaign_creator_id: string
  handle: string
  emails: string[]
  profile_url: string | null
  cover_url: string | null
  preview_image_url: string | null
  followers: number
  avg_views: number
  bio: string | null
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
              <span className="truncate">
                {noteTag ? t(`outreach.tag.${noteTag}`) : t("outreach.selectTag")}
              </span>
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
              try {
                await onSave(note, noteTag || null)
                setOpen(false)
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("outreach.noteSaveFailed"))
              } finally {
                setSaving(false)
              }
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

export default function OutreachTab() {
  const { campaign } = useOutletContext<{ campaign: Campaign }>()
  const { t } = useLanguage()
  const [subject, setSubject] = useState(() => {
    return localStorage.getItem(`outreach-subject-${campaign.id}`) || ""
  })
  const [body, setBody] = useState(() => {
    return localStorage.getItem(`outreach-body-${campaign.id}`) ||
      "Hi {{recipient_name}},\n\nI came across your content and thought you'd be a great fit for our campaign.\n\nLooking forward to hearing from you!"
  })
  const [creators, setCreators] = useState<OutreachCreator[]>([])
  const [outreachLog, setOutreachLog] = useState<OutreachEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [previews, setPreviews] = useState<PreviewEmail[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [dryRunning, setDryRunning] = useState(false)
  // Tracks bulk sends ("all" | "selected") separately from individual sends
  const [bulkSending, setBulkSending] = useState<string | null>(null) // "all" | "selected" | null
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set()) // individual creator IDs in flight
  const [showTemplate, setShowTemplate] = useState(false)
  const [logStatusFilter, setLogStatusFilter] = useState<string>("all")
  const [logTagFilter, setLogTagFilter] = useState<string>("all")
  const [logSortOrder, setLogSortOrder] = useState<string>("newest")
  const [selectedOutreachCreator, setSelectedOutreachCreator] = useState<OutreachCreator | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>(() => {
    try {
      const stored = localStorage.getItem(`outreach-attachments-${campaign.id}`)
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Persist attachments to localStorage
  function updateAttachments(next: { name: string; url: string }[]) {
    setAttachments(next)
    localStorage.setItem(`outreach-attachments-${campaign.id}`, JSON.stringify(next))
  }

  async function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const path = `${campaign.id}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from("outreach-attachments").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      })
      if (error) {
        toast.error(error.message)
        continue
      }
      const { data: urlData } = supabase.storage.from("outreach-attachments").getPublicUrl(path)
      if (!urlData?.publicUrl) {
        toast.error(t("outreach.attachmentUrlFailed"))
        continue
      }
      updateAttachments([...attachments, { name: file.name, url: urlData.publicUrl }])
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeAttachment(idx: number) {
    const next = attachments.filter((_, i) => i !== idx)
    updateAttachments(next)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: ccData, error: ccError } = await supabase
        .from("campaign_creators")
        .select("id, creator_id, preview_image_url")
        .eq("campaign_id", campaign.id)
        .eq("status", "approved")

      if (ccError) {
        toast.error(ccError.message)
        setCreators([])
      } else if (ccData?.length) {
        const ids = [
          ...new Set(
            ccData.map((r) => r.creator_id).filter((id): id is string => Boolean(id))
          ),
        ]
        const { data: crData, error: crError } = await supabase
          .from("creators")
          .select("id, handle, emails, profile_url, cover_url, followers, avg_views, bio")
          .in("id", ids)

        if (crError) {
          toast.error(crError.message)
          setCreators([])
        } else {
          const ccMap = Object.fromEntries((ccData ?? []).map(cc => [cc.creator_id, cc]))
          const mapped: OutreachCreator[] = (crData ?? [])
            .map((c) => ({
              creator_id: c.id,
              campaign_creator_id: ccMap[c.id]?.id || "",
              handle: c.handle,
              emails: c.emails ?? [],
              profile_url: c.profile_url ?? null,
              cover_url: c.cover_url ?? null,
              preview_image_url: ccMap[c.id]?.preview_image_url ?? null,
              followers: c.followers ?? 0,
              avg_views: c.avg_views ?? 0,
              bio: c.bio ?? null,
            }))
            .filter((c) => c.emails.length > 0)
          setCreators(mapped)
        }
      } else {
        setCreators([])
      }

      const { data: logData, error: logError } = await supabase
        .from("outreach_log")
        .select("id, email, subject, status, error, sent_at, note, note_tag, creator_id")
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })

      if (logError) {
        toast.error(logError.message)
        setOutreachLog([])
      } else {
        const rows = logData ?? []
        const logCreatorIds = [
          ...new Set(
            rows.map((r) => r.creator_id).filter((id): id is string => Boolean(id))
          ),
        ]
        let handleById = new Map<string, { handle: string }>()
        if (logCreatorIds.length > 0) {
          const { data: hData, error: hError } = await supabase
            .from("creators")
            .select("id, handle")
            .in("id", logCreatorIds)
          if (hError) {
            toast.error(hError.message)
          } else {
            handleById = new Map(
              (hData ?? []).map((c) => [c.id, { handle: c.handle }])
            )
          }
        }
        setOutreachLog(
          rows.map((entry) => ({
            id: entry.id,
            email: entry.email,
            subject: entry.subject,
            status: entry.status,
            error: entry.error,
            sent_at: entry.sent_at,
            note: entry.note,
            note_tag: entry.note_tag,
            creator: entry.creator_id ? handleById.get(entry.creator_id) ?? null : null,
          }))
        )
      }
    } finally {
      setLoading(false)
    }
  }, [campaign.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function dryRun() {
    if (!subject.trim() || !body.trim()) return
    setDryRunning(true)

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("outreach.dryRunFailed"))
    } finally {
      setDryRunning(false)
    }
  }

  async function sendBulk(creatorIds: string[], target: "all" | "selected") {
    if (creatorIds.length === 0 || !subject.trim()) return
    setBulkSending(target)
    try {
      await apiCall("/api/outreach/send", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaign.id,
          creator_ids: creatorIds,
          subject,
          body,
          dry_run: false,
        }),
      })
      fetchData()
      setSelectedIds(new Set())
      toast(t("outreach.sendQueued"), { duration: 2000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("outreach.sendFailed"))
    } finally {
      setBulkSending(null)
    }
  }

  async function sendOne(creatorId: string) {
    if (!subject.trim()) return
    setSendingIds(prev => new Set([...prev, creatorId]))
    try {
      await apiCall("/api/outreach/send", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaign.id,
          creator_ids: [creatorId],
          subject,
          body,
          dry_run: false,
        }),
      })
      fetchData()
      toast(t("outreach.sendQueued"), { duration: 2000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("outreach.sendFailed"))
    } finally {
      setSendingIds(prev => {
        const next = new Set(prev)
        next.delete(creatorId)
        return next
      })
    }
  }

  function sendAll() {
    sendBulk(creators.map((c) => c.creator_id), "all")
  }

  function sendSelected() {
    sendBulk(Array.from(selectedIds), "selected")
  }

  function toggleSelect(creatorId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(creatorId)) next.delete(creatorId)
      else next.add(creatorId)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === creators.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(creators.map(c => c.creator_id)))
    }
  }

  async function removeFromOutreach(c: OutreachCreator) {
    try {
      const { error } = await supabase
        .from("campaign_creators")
        .update({ status: "rejected" })
        .eq("id", c.campaign_creator_id)
      if (error) throw error
      setCreators(prev => prev.filter(cr => cr.creator_id !== c.creator_id))
      toast.success(t("outreach.creatorRemoved"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("outreach.removeFailed"))
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
              disabled={dryRunning || !!bulkSending || creators.length === 0 || !subject.trim()}
            >
              {dryRunning ? <Spinner /> : <EyeIcon data-icon />}
              {t("outreach.dryRun")}
            </Button>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={sendSelected}
                disabled={!!bulkSending || dryRunning || !subject.trim()}
              >
                {bulkSending === "selected" ? <Spinner /> : <SendIcon data-icon />}
                {t("outreach.sendSelected", { count: selectedIds.size })}
              </Button>
            )}
            <Button
              size="sm"
              onClick={sendAll}
              disabled={!!bulkSending || dryRunning || !subject.trim() || creators.length === 0}
            >
              {bulkSending === "all" ? <Spinner /> : <SendIcon data-icon />}
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
                <TableHead className="w-10">
                  <Checkbox
                    checked={creators.length > 0 && selectedIds.size === creators.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-[25%]">{t("outreach.handle")}</TableHead>
                <TableHead>{t("outreach.email")}</TableHead>
                <TableHead className="text-right w-[120px]">{t("keywords.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creators.map((c) => (
                <TableRow
                  key={c.creator_id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedOutreachCreator(c)}
                >
                  <TableCell className="py-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(c.creator_id)}
                      onCheckedChange={() => toggleSelect(c.creator_id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium py-3">@{c.handle}</TableCell>
                  <TableCell className="text-sm text-muted-foreground py-3">
                    {c.emails[0]}
                  </TableCell>
                  <TableCell className="text-right py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => sendOne(c.creator_id)}
                        disabled={sendingIds.has(c.creator_id) || !!bulkSending || !subject.trim()}
                        title={t("outreach.sendOne")}
                      >
                        {sendingIds.has(c.creator_id) ? <Spinner className="size-3.5" /> : <SendIcon className="size-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFromOutreach(c)}
                        title={t("outreach.removeCreator")}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
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
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <Select value={logStatusFilter} onValueChange={(v) => setLogStatusFilter(v ?? "all")}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <span className="truncate">
                    {logStatusFilter === "all" ? t("filter.allStatus")
                      : logStatusFilter === "sent" ? t("outreach.sent")
                      : logStatusFilter === "failed" ? t("outreach.failed")
                      : t("outreach.pending")}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.allStatus")}</SelectItem>
                  <SelectItem value="sent">{t("outreach.sent")}</SelectItem>
                  <SelectItem value="failed">{t("outreach.failed")}</SelectItem>
                  <SelectItem value="pending">{t("outreach.pending")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={logTagFilter} onValueChange={(v) => setLogTagFilter(v ?? "all")}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <span className="truncate">
                    {logTagFilter === "all" ? t("outreach.allTags")
                      : logTagFilter === "none" ? t("outreach.noTag")
                      : t(`outreach.tag.${logTagFilter}`)}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("outreach.allTags")}</SelectItem>
                  <SelectItem value="none">{t("outreach.noTag")}</SelectItem>
                  <SelectItem value="replied">{t("outreach.tag.replied")}</SelectItem>
                  <SelectItem value="interested">{t("outreach.tag.interested")}</SelectItem>
                  <SelectItem value="bounced">{t("outreach.tag.bounced")}</SelectItem>
                  <SelectItem value="declined">{t("outreach.tag.declined")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={logSortOrder} onValueChange={(v) => setLogSortOrder(v ?? "newest")}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <span className="truncate">
                    {logSortOrder === "newest" ? t("outreach.sortNewest") : t("outreach.sortOldest")}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">{t("outreach.sortNewest")}</SelectItem>
                  <SelectItem value="oldest">{t("outreach.sortOldest")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                {outreachLog
                  .filter((e) => {
                    if (logStatusFilter !== "all" && e.status !== logStatusFilter) return false
                    if (logTagFilter === "none" && e.note_tag != null) return false
                    if (logTagFilter !== "all" && logTagFilter !== "none" && e.note_tag !== logTagFilter) return false
                    return true
                  })
                  .sort((a, b) => {
                    const dateA = new Date(a.sent_at || 0).getTime()
                    const dateB = new Date(b.sent_at || 0).getTime()
                    return logSortOrder === "newest" ? dateB - dateA : dateA - dateB
                  })
                  .map((entry) => (
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
                          // Optimistic: update local state
                          setOutreachLog((prev) =>
                            prev.map((e) => e.id === entry.id ? { ...e, note, note_tag: noteTag } : e)
                          )
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

      {/* Creator Detail Sheet */}
      <Sheet open={!!selectedOutreachCreator} onOpenChange={() => setSelectedOutreachCreator(null)}>
        <SheetContent className="overflow-y-auto">
          {selectedOutreachCreator && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  @{selectedOutreachCreator.handle}
                  {selectedOutreachCreator.profile_url && (
                    <a
                      href={selectedOutreachCreator.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {t("discover.followers", { count: String(selectedOutreachCreator.followers) })}
                  {" / "}
                  {t("discover.avgViews", { count: String(selectedOutreachCreator.avg_views) })}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-8">
                {(selectedOutreachCreator.preview_image_url || selectedOutreachCreator.cover_url) && (
                  <div className="flex justify-center">
                    <div className="relative aspect-[9/16] w-full max-w-[200px] overflow-hidden rounded-xl bg-muted">
                      <img
                        src={selectedOutreachCreator.preview_image_url || selectedOutreachCreator.cover_url || ""}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    </div>
                  </div>
                )}
                {selectedOutreachCreator.bio && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.bio")}</p>
                    <p className="text-sm">{selectedOutreachCreator.bio}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.emails")}</p>
                  {selectedOutreachCreator.emails.map((email) => (
                    <div key={email} className="flex items-center gap-2 text-sm">
                      <MailIcon className="size-3 text-muted-foreground" />
                      {email}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      removeFromOutreach(selectedOutreachCreator)
                      setSelectedOutreachCreator(null)
                    }}
                  >
                    <TrashIcon className="size-3.5 mr-1" />
                    {t("outreach.removeCreator")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Template Dialog */}
      <Dialog open={showTemplate} onOpenChange={setShowTemplate}>
        <DialogContent className="max-w-5xl max-h-[85dvh] overflow-y-auto">
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
                  localStorage.setItem(`outreach-subject-${campaign.id}`, e.target.value)
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
                  localStorage.setItem(`outreach-body-${campaign.id}`, e.target.value)
                }}
                rows={16}
                className="min-h-[300px] font-mono text-sm"
                placeholder={t("outreach.bodyPlaceholder")}
              />
            </Field>
          </FieldGroup>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs"
              >
                <PaperclipIcon className="size-3.5 mr-1" />
                {t("outreach.addAttachment")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                multiple
                onChange={handleAttachmentUpload}
              />
            </div>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                    <PaperclipIcon className="size-3 text-muted-foreground" />
                    <span className="max-w-[200px] truncate">{a.name}</span>
                    <button onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-destructive">
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("outreach.variableHint")}
          </p>
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
