import { useLanguage } from "@/lib/i18n"
import { CheckCircleIcon, XCircleIcon, ChevronDownIcon } from "lucide-react"
import type { BatchTask } from "@/hooks/use-tasks"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { apiCall } from "@/lib/api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const params = batch.source_params
  if (batch.source_type === "similar") {
    return `${t("tasks.similarTo")} ${(params.creator_handle as string) ?? ""}`
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

function BatchItem({ batch }: { batch: BatchTask }) {
  const { t } = useLanguage()
  const isActive = batch.task_status === "running" || batch.task_status === "queued"
  const params = batch.source_params
  const keywords = (params.keywords as string[] | undefined) ?? []

  async function handleRetry() {
    try {
      await apiCall("/api/scout/run", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: params.campaign_id || undefined,
          source_type: batch.source_type,
          source_params: params,
        }),
      })
    } catch {
      // handled by apiCall
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

            {/* Similar handle */}
            {batch.source_type === "similar" && params.creator_handle ? (
              <>
                <dt className="text-muted-foreground">{t("tasks.creator")}</dt>
                <dd className="font-medium">{String(params.creator_handle)}</dd>
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

            {/* Preset */}
            {batch.preset_snapshot ? (
              <>
                <dt className="text-muted-foreground">{t("tasks.preset")}</dt>
                <dd>
                  {Object.entries(batch.preset_snapshot)
                    .filter(([, v]) => v != null)
                    .map(([k]) => k)
                    .join(", ") || "—"}
                </dd>
              </>
            ) : null}

            {/* Result */}
            {batch.task_status === "completed" && (
              <>
                <dt className="text-muted-foreground">{t("tasks.result")}</dt>
                <dd>{t("tasks.creatorsFound", { count: batch.creator_count })}</dd>
              </>
            )}

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

  if (batches.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("tasks.empty")}</EmptyTitle>
            <EmptyDescription>{t("tasks.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const sortedBatches = [...batches].sort((a, b) => {
    const statusOrder: Record<string, number> = { running: 0, queued: 1, failed: 2, partial: 3, completed: 4 }
    const aOrder = statusOrder[a.task_status] ?? 5
    const bOrder = statusOrder[b.task_status] ?? 5
    if (aOrder !== bOrder) return aOrder - bOrder
    return new Date(b.batch_created_at).getTime() - new Date(a.batch_created_at).getTime()
  })

  return (
    <div className="flex flex-col divide-y px-2 py-1">
      {sortedBatches.map((batch) => (
        <BatchItem key={batch.id} batch={batch} />
      ))}
    </div>
  )
}
