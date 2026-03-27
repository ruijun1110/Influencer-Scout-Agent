import { useLanguage } from "@/lib/i18n"
import { CheckCircleIcon, XCircleIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { useTasks, type BatchTask } from "@/hooks/use-tasks"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { apiCall } from "@/lib/api"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAtHandle(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  return s.startsWith("@") ? s : `@${s}`
}

/**
 * Same source as Discover cards: `creators.handle` via `seed_creator_handle`
 * when `source_params.creator_id` is set; else typed `creator_handle` (dialog-only similar).
 */
function similarSeedHandleDisplay(batch: BatchTask): string {
  const fromDb = batch.seed_creator_handle
  if (fromDb) return formatAtHandle(fromDb)
  const typed = String(batch.source_params.creator_handle ?? "").trim()
  if (typed) return formatAtHandle(typed)
  return ""
}

/** Compact number formatting: 1234 → "1.2K", 1234567 → "1.2M" */
function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(n)
}

/** Format a range filter { min?, max? } into a readable string */
function formatRange(obj: { min?: number; max?: number } | null | undefined): string | null {
  if (!obj) return null
  const { min, max } = obj
  if (min != null && max != null) return `${compactNum(min)} – ${compactNum(max)}`
  if (min != null) return `≥ ${compactNum(min)}`
  if (max != null) return `≤ ${compactNum(max)}`
  return null
}

/** Render preset_snapshot filters as a set of compact badges */
function PresetFilters({
  snapshot,
  t,
}: {
  snapshot: Record<string, unknown>
  t: (key: string) => string
}) {
  const items: { label: string; value: string }[] = []

  const rangeFields = [
    { key: "followers", label: t("tasks.presetFollowers") },
    { key: "avg_views", label: t("tasks.presetAvgViews") },
    { key: "total_likes", label: t("tasks.presetTotalLikes") },
    { key: "video_count", label: t("tasks.presetVideoCount") },
  ] as const

  for (const { key, label } of rangeFields) {
    const v = formatRange(snapshot[key] as { min?: number; max?: number } | undefined)
    if (v) items.push({ label, value: v })
  }

  // Engagement rate: stored as decimal (0.03 = 3%)
  const eng = snapshot.engagement_rate as { min?: number; max?: number } | undefined
  if (eng?.min != null) {
    items.push({ label: t("tasks.presetEngagement"), value: `≥ ${(eng.min * 100).toFixed(1)}%` })
  }

  // Single value: min_video_views
  const mvv = snapshot.min_video_views as number | undefined
  if (mvv != null) {
    items.push({ label: t("tasks.presetMinVideoViews"), value: compactNum(mvv) })
  }

  // Boolean: has_email
  if (snapshot.has_email === true) {
    items.push({ label: t("tasks.presetHasEmail"), value: t("tasks.presetYes") })
  } else if (snapshot.has_email === false) {
    items.push({ label: t("tasks.presetHasEmail"), value: t("tasks.presetNo") })
  }

  if (items.length === 0) return <span className="text-muted-foreground">—</span>

  return (
    <div className="flex flex-wrap gap-1">
      {items.map(({ label, value }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] leading-tight"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{value}</span>
        </span>
      ))}
    </div>
  )
}

function StatusIcon({ status }: { status: BatchTask["task_status"] }) {
  switch (status) {
    case "queued":
    case "running":
      return <Spinner className="size-3.5 shrink-0" />
    case "completed":
      return <CheckCircleIcon className="size-3.5 shrink-0 text-emerald-500" />
    case "failed":
    case "partial":
      return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
  }
}

function sourceLabel(sourceType: string, t: (key: string) => string): string {
  switch (sourceType) {
    case "keyword_creator":
      return t("tasks.creatorSearch")
    case "keyword_video":
      return t("tasks.videoSearch")
    case "similar":
      return t("tasks.similarTo")
    default:
      return sourceType
  }
}

function collapsedSummary(
  batch: BatchTask,
  t: (key: string, p?: Record<string, string | number>) => string,
): string {
  if (batch.batch_name) return batch.batch_name
  const params = batch.source_params
  if (batch.source_type === "similar") {
    const h = similarSeedHandleDisplay(batch)
    return `${t("tasks.similarTo")} ${h || "—"}`
  }
  const keywords = params.keywords as string[] | undefined
  const count = keywords?.length ?? 0
  return `${sourceLabel(batch.source_type, t)} · ${t("tasks.keywordCount", { count })}`
}

function collapsedRight(
  batch: BatchTask,
  t: (key: string, p?: Record<string, string | number>) => string,
): string {
  if (batch.task_status === "running") {
    return `${batch.task_progress}/${batch.task_total || "?"}`
  }
  if (batch.task_status === "queued") {
    return t("tasks.queued")
  }
  if (batch.task_status === "failed") {
    return t("tasks.failed")
  }
  const meta = batch.task_meta || {}
  const qualified = meta.result_count as number | undefined
  if (qualified != null && batch.creator_count > 0) {
    return `${qualified}/${batch.creator_count}`
  }
  return t("tasks.found", { count: batch.creator_count })
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}


// ---------------------------------------------------------------------------
// BatchItem
// ---------------------------------------------------------------------------

interface BatchItemProps {
  batch: BatchTask
  onDismiss?: () => void
}
function BatchItem({ batch, onDismiss }: BatchItemProps) {
  const { t } = useLanguage()
  const { refetch: refetchTasks } = useTasks()
  const isActive = batch.task_status === "running" || batch.task_status === "queued"
  const params = batch.source_params
  const keywords = (params.keywords as string[] | undefined) ?? []

  async function handleRetry() {
    if (!batch.campaign_id) {
      toast.error(t("tasks.missingCampaign"))
      return
    }
    try {
      await apiCall("/api/scout/run", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: batch.campaign_id,
          source_type: batch.source_type,
          source_params: params,
        }),
      })
      void refetchTasks()
      toast.success(t("tasks.retryQueued"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tasks.retryFailed"))
    }
  }

  return (
    <Collapsible defaultOpen={isActive} className="group/task">
      {/* Collapsed trigger row */}
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded-md transition-colors">
        <StatusIcon status={batch.task_status} />
        <span className="min-w-0 flex-1 truncate text-sm">
          {collapsedSummary(batch, t)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {collapsedRight(batch, t)}
        </span>
        {onDismiss && (
          <button onClick={(e) => { e.stopPropagation(); onDismiss() }} className="shrink-0 text-muted-foreground/50 hover:text-foreground">
            <XIcon className="size-3.5" />
          </button>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200 group-data-[state=open]/task:rotate-180" />
      </CollapsibleTrigger>

      {/* Expanded detail */}
      <CollapsibleContent>
        <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
          {/* Progress bar for running */}
          {batch.task_status === "running" && batch.task_total > 0 && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: `${Math.min(100, (batch.task_progress / batch.task_total) * 100)}%`,
                }}
              />
            </div>
          )}

          {/* Detail grid */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {/* Keywords (as tags) */}
            {keywords.length > 0 ? (
              <>
                <dt className="text-muted-foreground pt-0.5">{t("tasks.keywords")}</dt>
                <dd className="flex flex-wrap gap-1">
                  {keywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="text-[10px] font-normal">
                      {kw}
                    </Badge>
                  ))}
                </dd>
              </>
            ) : null}

            {/* Similar: seed profile (creators.handle when id present, else dialog handle) */}
            {batch.source_type === "similar" &&
            (params.creator_id || params.creator_handle) ? (
              <>
                <dt className="text-muted-foreground">{t("tasks.creator")}</dt>
                <dd className="font-medium">
                  {similarSeedHandleDisplay(batch) || "—"}
                </dd>
              </>
            ) : null}

            {/* Source */}
            <dt className="text-muted-foreground">{t("tasks.source")}</dt>
            <dd>{sourceLabel(batch.source_type, t)}</dd>

            {/* Country (keyword sources only) */}
            {params.country ? (
              <>
                <dt className="text-muted-foreground">{t("tasks.country")}</dt>
                <dd>{String(params.country)}</dd>
              </>
            ) : null}

            {/* Preset filters */}
            {batch.preset_snapshot && Object.values(batch.preset_snapshot).some(v => v != null) ? (
              <>
                <dt className="text-muted-foreground pt-0.5">{t("tasks.preset")}</dt>
                <dd>
                  <PresetFilters snapshot={batch.preset_snapshot as Record<string, unknown>} t={t} />
                </dd>
              </>
            ) : null}

            {/* Result with qualification rate */}
            {(batch.task_status === "completed" || batch.task_status === "partial") && (() => {
              const meta = batch.task_meta || {}
              const qualified = meta.result_count as number | undefined
              const totalStored = (meta.total_stored as number | undefined) ?? batch.creator_count
              const hasPreset = batch.preset_snapshot && Object.values(batch.preset_snapshot).some(v => v != null)

              return (
                <>
                  <dt className="text-muted-foreground">{t("tasks.result")}</dt>
                  <dd className="flex flex-col gap-0.5">
                    {hasPreset && qualified != null ? (
                      <>
                        <span>{t("tasks.qualifiedOfTotal", { qualified, total: totalStored })}</span>
                        {totalStored > 0 && qualified / totalStored < 0.15 && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            {t("tasks.lowYieldHint")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span>{t("tasks.creatorsFound", { count: batch.creator_count })}</span>
                    )}
                  </dd>
                </>
              )
            })()}

            {/* Date */}
            <dt className="text-muted-foreground">{t("tasks.date")}</dt>
            <dd>{formatDateFull(batch.batch_created_at)}</dd>
          </dl>

          {/* Error + Retry */}
          {batch.task_status === "failed" && (
            <div className="flex items-center justify-between rounded-md bg-destructive/5 px-2.5 py-1.5">
              <p className="text-xs text-destructive truncate">
                {batch.task_error || t("tasks.failed")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2 shrink-0 text-destructive hover:text-destructive"
                onClick={handleRetry}
              >
                {t("tasks.retry")}
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// TaskTracker
// ---------------------------------------------------------------------------

interface TaskTrackerProps {
  batches: BatchTask[]
}

export function TaskTracker({ batches }: TaskTrackerProps) {
  const { t } = useLanguage()
  const { refetch } = useTasks()

  const groups = {
    active: batches.filter(b => b.task_status === "running" || b.task_status === "queued")
      .sort((a, b) => new Date(b.batch_created_at).getTime() - new Date(a.batch_created_at).getTime()),
    completed: batches.filter(b => b.task_status === "completed" || b.task_status === "partial")
      .sort((a, b) => new Date(b.batch_created_at).getTime() - new Date(a.batch_created_at).getTime()),
    failed: batches.filter(b => b.task_status === "failed")
      .sort((a, b) => new Date(b.batch_created_at).getTime() - new Date(a.batch_created_at).getTime()),
  }

  async function handleClearAll(ids: string[]) {
    if (ids.length === 0) return
    try {
      await supabase.from("scout_batches").update({ dismissed_at: new Date().toISOString() }).in("id", ids)
      void refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tasks.clearFailed"))
    }
  }

  async function handleDismiss(id: string) {
    try {
      await supabase.from("scout_batches").update({ dismissed_at: new Date().toISOString() }).eq("id", id)
      void refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tasks.clearFailed"))
    }
  }

  if (batches.length === 0) {
    return (
      <div className="flex min-h-[min(360px,55dvh)] items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("tasks.empty")}</EmptyTitle>
            <EmptyDescription>{t("tasks.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <Tabs defaultValue="active" className="flex flex-col">
      <TabsList className="mx-2 mt-1 shrink-0">
        <TabsTrigger value="active" className="gap-1.5 text-xs">
          {t("tasks.tabActive")}
          {groups.active.length > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{groups.active.length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="completed" className="gap-1.5 text-xs">
          {t("tasks.tabCompleted")}
          {groups.completed.length > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{groups.completed.length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="failed" className="gap-1.5 text-xs">
          {t("tasks.tabFailed")}
          {groups.failed.length > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{groups.failed.length}</Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="active" className="flex-1 overflow-y-auto">
        {groups.active.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">{t("tasks.noActive")}</p>
        ) : (
          <div className="flex flex-col divide-y px-2 py-1 pb-6">
            {groups.active.map(b => <BatchItem key={b.id} batch={b} />)}
          </div>
        )}
      </TabsContent>

      <TabsContent value="completed" className="flex-1 overflow-y-auto">
        {groups.completed.length > 0 && (
          <div className="flex justify-end px-3 py-1">
            <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => handleClearAll(groups.completed.map(b => b.id))}>
              {t("tasks.clearAll")}
            </Button>
          </div>
        )}
        {groups.completed.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">{t("tasks.noCompleted")}</p>
        ) : (
          <div className="flex flex-col divide-y px-2 pb-6">
            {groups.completed.map(b => <BatchItem key={b.id} batch={b} onDismiss={() => handleDismiss(b.id)} />)}
          </div>
        )}
      </TabsContent>

      <TabsContent value="failed" className="flex-1 overflow-y-auto">
        {groups.failed.length > 0 && (
          <div className="flex justify-end px-3 py-1">
            <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => handleClearAll(groups.failed.map(b => b.id))}>
              {t("tasks.clearAll")}
            </Button>
          </div>
        )}
        {groups.failed.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">{t("tasks.noFailed")}</p>
        ) : (
          <div className="flex flex-col divide-y px-2 pb-6">
            {groups.failed.map(b => <BatchItem key={b.id} batch={b} onDismiss={() => handleDismiss(b.id)} />)}
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
