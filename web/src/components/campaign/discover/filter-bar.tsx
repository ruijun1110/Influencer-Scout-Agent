import { useLanguage } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchIcon, LayoutGridIcon, ListIcon } from "lucide-react"

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
  onOpenScout: () => void
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
  onOpenScout
}: DiscoverFilterProps) {
  const { t } = useLanguage()

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
        <Button onClick={onOpenScout} className="shrink-0 shadow-sm">
          <SearchIcon className="size-4 mr-2" />
          {t("filter.scout")}
        </Button>
        <div className="h-6 w-px bg-border hidden sm:block mx-1" />
        <span className="text-sm text-muted-foreground font-medium">
          {t("filter.profiles", { count: totalCreators })}
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
          <span className="text-sm">{t("filter.showAll")}</span>
        </label>
      </div>
    </div>
  )
}
