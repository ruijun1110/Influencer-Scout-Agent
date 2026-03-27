import { useState, useMemo, useEffect } from "react"
import { useLanguage } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { SearchIcon, LayoutGridIcon, ListIcon, AlertCircleIcon, FilterIcon, SlidersHorizontalIcon } from "lucide-react"
import { FilterInputs } from "./filter-inputs"
import { checkQualifiedClient } from "@/lib/qualification"

interface DiscoverFilterProps {
  statusFilter: string
  setStatusFilter: (v: string) => void
  sortBy: string
  setSortBy: (v: string) => void
  batchFilter: string
  setBatchFilter: (v: string) => void
  keywordFilter: string[]
  setKeywordFilter: (v: string[]) => void
  presetFilter: string
  setPresetFilter: (v: string) => void
  showAll: boolean
  setShowAll: (v: boolean) => void
  viewMode: "card" | "table"
  setViewMode: (v: "card" | "table") => void
  batches: { id: string; source_type: string; source_params: Record<string, unknown>; created_at: string; name?: string | null }[]
  keywords: string[]
  presets: { id: string; name: string }[]
  totalCreators: number
  qualifiedCount: number
  activePresetSnapshot: Record<string, unknown> | null
  onOpenScout: () => void
  tikhubConfigured: boolean
  creators: Array<{ campaign_creator_id: string; batch_id: string | null; followers: number; avg_views: number; engagement_rate: number; total_likes: number; video_count: number; qualified: boolean }>
  onApplyFilters: (batchId: string, newFilters: Record<string, unknown>) => Promise<void>
}

function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(n)
}

function formatRange(obj: { min?: number; max?: number } | null | undefined): string | null {
  if (!obj) return null
  const { min, max } = obj
  if (min != null && max != null) return `${compactNum(min)} – ${compactNum(max)}`
  if (min != null) return `≥ ${compactNum(min)}`
  if (max != null) return `≤ ${compactNum(max)}`
  return null
}

function presetCriteriaTags(snapshot: Record<string, unknown>, t: (k: string) => string): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = []
  const fields = [
    { key: "followers", label: t("tasks.presetFollowers") },
    { key: "avg_views", label: t("tasks.presetAvgViews") },
    { key: "total_likes", label: t("tasks.presetTotalLikes") },
    { key: "video_count", label: t("tasks.presetVideoCount") },
  ]
  for (const { key, label } of fields) {
    const v = formatRange(snapshot[key] as { min?: number; max?: number } | undefined)
    if (v) items.push({ label, value: v })
  }
  const eng = snapshot.engagement_rate as { min?: number; max?: number } | undefined
  if (eng?.min != null) items.push({ label: t("tasks.presetEngagement"), value: `≥ ${(eng.min * 100).toFixed(1)}%` })
  const mvv = snapshot.min_video_views as number | undefined
  if (mvv != null) items.push({ label: t("tasks.presetMinVideoViews"), value: compactNum(mvv) })
  return items
}

function formatBatchLabel(batch: { source_type: string; created_at: string; name?: string | null }) {
  if (batch.name) return batch.name
  const date = new Date(batch.created_at)
  const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${monthDay} · ${batch.source_type}`
}

export function DiscoverFilterBar({
  statusFilter,
  setStatusFilter,
  sortBy,
  setSortBy,
  batchFilter,
  setBatchFilter,
  presetFilter,
  setPresetFilter,
  showAll,
  setShowAll,
  viewMode,
  setViewMode,
  batches,
  presets,
  totalCreators,
  qualifiedCount,
  activePresetSnapshot,
  onOpenScout,
  tikhubConfigured,
  creators,
  onApplyFilters,
}: DiscoverFilterProps) {
  const { t } = useLanguage()

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustedFilters, setAdjustedFilters] = useState<Record<string, any>>({})
  const [applying, setApplying] = useState(false)

  // Initialize adjustedFilters from activePresetSnapshot when popover opens
  useEffect(() => {
    if (adjustOpen && activePresetSnapshot) {
      setAdjustedFilters({ ...activePresetSnapshot })
    }
  }, [adjustOpen, activePresetSnapshot])

  const batchCreatorsForPreview = useMemo(
    () => creators.filter(c => c.batch_id === batchFilter),
    [creators, batchFilter]
  )

  const previewCount = useMemo(
    () => batchCreatorsForPreview.filter(c => checkQualifiedClient(c, adjustedFilters)).length,
    [batchCreatorsForPreview, adjustedFilters]
  )

  const currentQualifiedCount = useMemo(
    () => batchCreatorsForPreview.filter(c => c.qualified).length,
    [batchCreatorsForPreview]
  )

  async function handleApply() {
    setApplying(true)
    try {
      await onApplyFilters(batchFilter, adjustedFilters)
      setAdjustOpen(false)
    } finally {
      setApplying(false)
    }
  }

  function statusLabel(value: string): string {
    const map: Record<string, string> = {
      all: t("filter.allStatus"),
      unreviewed: t("filter.unreviewed"),
      approved: t("filter.approved"),
      rejected: t("filter.rejected"),
    }
    return map[value] || value
  }

  function sortLabel(value: string): string {
    const map: Record<string, string> = {
      newest: t("filter.newest"),
      followers: t("filter.followers"),
      avg_views: t("filter.avgViews"),
    }
    return map[value] || value
  }

  function presetLabel(value: string): string {
    if (value === "all") return t("filter.allPresets")
    return presets.find((p) => p.id === value)?.name || value
  }

  function batchLabel(value: string): string {
    if (value === "all") return t("filter.allBatches")
    const batch = batches.find((b) => b.id === value)
    return batch ? formatBatchLabel(batch) : value
  }

  return (
    <div className="flex flex-col gap-4 mb-6">
      {/* Row 1: Scout button + count */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={onOpenScout} disabled={!tikhubConfigured} className="shadow-sm">
            <SearchIcon className="size-4 mr-2" />
            {t("filter.scout")}
          </Button>
          {!tikhubConfigured && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertCircleIcon className="size-3 shrink-0" />
              {t("filter.scoutNoApiKey")}
            </span>
          )}
        </div>
        <div className="h-6 w-px bg-border hidden sm:block mx-1" />
        <span className="text-sm text-muted-foreground font-medium">
          {showAll
            ? t("filter.qualifiedOfTotal", { qualified: qualifiedCount, total: totalCreators })
            : t("filter.profiles", { count: totalCreators })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant={viewMode === "card" ? "secondary" : "ghost"}
            className="size-8"
            onClick={() => setViewMode("card")}
          >
            <LayoutGridIcon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant={viewMode === "table" ? "secondary" : "ghost"}
            className="size-8"
            onClick={() => setViewMode("table")}
          >
            <ListIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Row 2: Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-36 h-9">
            <span className="truncate">{statusLabel(statusFilter)}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.allStatus")}</SelectItem>
            <SelectItem value="unreviewed">{t("filter.unreviewed")}</SelectItem>
            <SelectItem value="approved">{t("filter.approved")}</SelectItem>
            <SelectItem value="rejected">{t("filter.rejected")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v ?? "newest")}>
          <SelectTrigger className="w-36 h-9">
            <span className="truncate">{sortLabel(sortBy)}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("filter.newest")}</SelectItem>
            <SelectItem value="followers">{t("filter.followers")}</SelectItem>
            <SelectItem value="avg_views">{t("filter.avgViews")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={presetFilter} onValueChange={(v) => setPresetFilter(v ?? "all")}>
          <SelectTrigger className="w-36 h-9">
            <span className="truncate">{presetLabel(presetFilter)}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.allPresets")}</SelectItem>
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={batchFilter} onValueChange={(v) => setBatchFilter(v ?? "all")}>
          <SelectTrigger className="w-44 h-9">
            <span className="truncate">{batchLabel(batchFilter)}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.allBatches")}</SelectItem>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {formatBatchLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={showAll}
            onCheckedChange={(checked) => setShowAll(!!checked)}
          />
          <span className="text-sm">{t("filter.showUnqualified")}</span>
        </label>
      </div>

      {/* Row 3: Active qualification criteria (shown when "Show unqualified" is on) */}
      {showAll && activePresetSnapshot && (() => {
        const tags = presetCriteriaTags(activePresetSnapshot, t)
        if (tags.length === 0) return null
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <FilterIcon className="size-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">{t("filter.qualifiedWhen")}</span>
            {tags.map(({ label, value }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] leading-tight font-medium"
              >
                {label}: {value}
              </span>
            ))}

            {/* Adjust Filters Popover */}
            {batchFilter !== "all" && (
              <Popover open={adjustOpen} onOpenChange={setAdjustOpen}>
                <PopoverTrigger
                  render={
                    <Button size="sm" variant="outline" className="h-6 text-xs gap-1" type="button" />
                  }
                >
                  <SlidersHorizontalIcon className="size-3" />
                  {t("filter.adjustFilters")}
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4" side="bottom" align="end">
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">{t("filter.adjustFilters")}</p>
                    <FilterInputs filters={adjustedFilters} onChange={setAdjustedFilters} />
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-xs text-muted-foreground">
                        {t("filter.previewCount", { count: previewCount, current: currentQualifiedCount })}
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdjustOpen(false)}>
                          {t("filter.cancel")}
                        </Button>
                        <Button size="sm" className="h-7 text-xs" onClick={handleApply} disabled={applying}>
                          {t("filter.apply")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )
      })()}
    </div>
  )
}
