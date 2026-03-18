import { useLanguage } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  batches: { id: string; source_type: string; source_params: Record<string, unknown>; created_at: string }[]
  keywords: string[]
  presets: { id: string; name: string }[]
  totalCreators: number
  onOpenScout: () => void
}

function formatBatchLabel(batch: { source_type: string; created_at: string }) {
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
            <SelectValue placeholder={t("filter.status")} />
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
            <SelectValue placeholder={t("filter.sortBy")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("filter.newest")}</SelectItem>
            <SelectItem value="followers">{t("filter.followers")}</SelectItem>
            <SelectItem value="avg_views">{t("filter.avgViews")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={presetFilter} onValueChange={(v) => setPresetFilter(v ?? "all")}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder={t("filter.preset")} />
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
            <SelectValue placeholder={t("filter.batch")} />
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
