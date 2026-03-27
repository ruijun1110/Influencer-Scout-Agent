import { useMemo } from "react"
import { cn, formatNumber } from "@/lib/utils"
import { useLanguage } from "@/lib/i18n"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { CheckIcon, XIcon, ExternalLinkIcon, UsersIcon, SlidersHorizontalIcon, ArrowUpIcon, ArrowDownIcon } from "lucide-react"
import type { CreatorWithStatus } from "./creator-card"

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

export type ColumnId = "handle" | "followers" | "avg_views" | "engagement_rate" | "total_likes" | "video_count" | "emails" | "status" | "source" | "actions"

const ALL_COLUMNS: {
  id: ColumnId
  labelKey: string
  align: "left" | "right"
  sortable: boolean
  defaultVisible: boolean
  getValue: (c: CreatorWithStatus) => string | number
}[] = [
  { id: "handle", labelKey: "outreach.handle", align: "left", sortable: true, defaultVisible: true, getValue: (c) => c.handle },
  { id: "followers", labelKey: "filter.followers", align: "right", sortable: true, defaultVisible: true, getValue: (c) => c.followers },
  { id: "avg_views", labelKey: "filter.avgViews", align: "right", sortable: true, defaultVisible: true, getValue: (c) => c.avg_views },
  { id: "engagement_rate", labelKey: "table.engRate", align: "right", sortable: true, defaultVisible: true, getValue: (c) => c.engagement_rate ?? 0 },
  { id: "total_likes", labelKey: "table.totalLikes", align: "right", sortable: true, defaultVisible: false, getValue: (c) => c.total_likes },
  { id: "video_count", labelKey: "table.videos", align: "right", sortable: true, defaultVisible: false, getValue: (c) => c.video_count },
  { id: "emails", labelKey: "table.emails", align: "right", sortable: true, defaultVisible: true, getValue: (c) => c.emails.length },
  { id: "status", labelKey: "keywords.status", align: "left", sortable: false, defaultVisible: true, getValue: (c) => c.status },
  { id: "source", labelKey: "discover.source", align: "left", sortable: false, defaultVisible: true, getValue: (c) => c.source_keyword ?? c.source_handle ?? "" },
  { id: "actions", labelKey: "keywords.actions", align: "right", sortable: false, defaultVisible: true, getValue: () => "" },
]

export const DEFAULT_VISIBLE: ColumnId[] = ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.id)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type CriteriaStatus = "pass" | "close" | "fail" | null

function evalCriteria(value: number, filt: { min?: number; max?: number } | undefined): CriteriaStatus {
  if (!filt) return null
  const { min, max } = filt
  if (min != null && value < min) return value >= min * 0.8 ? "close" : "fail"
  if (max != null && value > max) return value <= max * 1.2 ? "close" : "fail"
  return "pass"
}

const criteriaTextColor: Record<string, string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  close: "text-amber-600 dark:text-amber-400",
  fail: "text-red-600 dark:text-red-400",
}

interface CreatorTableProps {
  creators: CreatorWithStatus[]
  batchSnapshotMap: Record<string, Record<string, unknown>>
  onSelect: (creator: CreatorWithStatus) => void
  onUpdateStatus: (creator: CreatorWithStatus, status: "approved" | "rejected") => void
  onFindSimilar: (creator: CreatorWithStatus) => void
  findingSimilarId: string | null
  visibleColumns: ColumnId[]
  onVisibleColumnsChange: (cols: ColumnId[]) => void
  sortColumn: ColumnId | null
  sortDir: "asc" | "desc"
  onSort: (col: ColumnId) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreatorTable({
  creators,
  batchSnapshotMap,
  onSelect,
  onUpdateStatus,
  onFindSimilar,
  findingSimilarId,
  visibleColumns,
  onVisibleColumnsChange,
  sortColumn,
  sortDir,
  onSort,
}: CreatorTableProps) {
  const { t } = useLanguage()

  // Sorted creators
  const sortedCreators = useMemo(() => {
    if (!sortColumn) return creators
    const col = ALL_COLUMNS.find(c => c.id === sortColumn)
    if (!col) return creators
    return [...creators].sort((a, b) => {
      const aVal = col.getValue(a)
      const bVal = col.getValue(b)
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal))
    })
  }, [creators, sortColumn, sortDir])

  // Which columns to render (handle and actions always shown)
  const activeColumns = ALL_COLUMNS.filter(
    col => col.id === "handle" || col.id === "actions" || visibleColumns.includes(col.id)
  )

  function statusBadge(status: string) {
    if (status === "approved") return <Badge variant="default" className="text-[10px]">{t("card.approved")}</Badge>
    if (status === "rejected") return <Badge variant="secondary" className="text-[10px]">{t("card.rejected")}</Badge>
    return <Badge variant="outline" className="text-[10px]">{t("filter.unreviewed")}</Badge>
  }

  function getCriteriaColor(c: CreatorWithStatus, key: string, value: number): string {
    const snap = c.batch_id ? batchSnapshotMap[c.batch_id] : null
    if (!snap) return ""
    const status = evalCriteria(value, snap[key] as { min?: number; max?: number } | undefined)
    return status ? criteriaTextColor[status] : ""
  }

  function renderCell(col: (typeof ALL_COLUMNS)[number], c: CreatorWithStatus) {
    const cellClass = `${col.align === "right" ? "text-right " : ""}text-sm py-2.5`
    switch (col.id) {
      case "handle":
        return (
          <TableCell key={col.id} className="font-medium py-2.5">
            <div className="flex items-center gap-1.5">
              {!c.qualified && (
                <span className="inline-block size-2 rounded-full bg-red-500 shrink-0" title={t("card.unqualified")} />
              )}
              @{c.handle}
              {c.profile_url && (
                <a
                  href={c.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </div>
          </TableCell>
        )
      case "followers":
        return <TableCell key={col.id} className={cn(cellClass, getCriteriaColor(c, "followers", c.followers))}>{formatNumber(c.followers)}</TableCell>
      case "avg_views":
        return <TableCell key={col.id} className={cn(cellClass, getCriteriaColor(c, "avg_views", c.avg_views))}>{formatNumber(c.avg_views)}</TableCell>
      case "engagement_rate":
        return <TableCell key={col.id} className={cn(cellClass, getCriteriaColor(c, "engagement_rate", c.engagement_rate))}>{c.engagement_rate ? `${(c.engagement_rate * 100).toFixed(1)}%` : "\u2014"}</TableCell>
      case "total_likes":
        return <TableCell key={col.id} className={cn(cellClass, getCriteriaColor(c, "total_likes", c.total_likes))}>{formatNumber(c.total_likes)}</TableCell>
      case "video_count":
        return <TableCell key={col.id} className={cn(cellClass, getCriteriaColor(c, "video_count", c.video_count))}>{c.video_count || "\u2014"}</TableCell>
      case "emails":
        return (
          <TableCell key={col.id} className={cellClass}>
            {c.emails.length > 0 ? <Badge variant="outline" className="text-[10px]">{c.emails.length}</Badge> : "\u2014"}
          </TableCell>
        )
      case "status":
        return <TableCell key={col.id} className="py-2.5">{statusBadge(c.status)}</TableCell>
      case "source":
        return (
          <TableCell key={col.id} className="text-xs text-muted-foreground py-2.5">
            {c.source_type === "similar"
              ? `~ ${c.source_handle || ""}`
              : c.source_keyword ? `#${c.source_keyword}` : "\u2014"}
          </TableCell>
        )
      case "actions":
        return (
          <TableCell key={col.id} className="text-right py-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-1">
              <Button
                size="icon"
                variant={c.status === "approved" ? "default" : "outline"}
                className="size-7"
                onClick={() => onUpdateStatus(c, "approved")}
              >
                <CheckIcon className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={() => onFindSimilar(c)}
                disabled={findingSimilarId === c.id}
                title="Find similar"
              >
                {findingSimilarId === c.id ? <Spinner className="size-3.5" /> : <UsersIcon className="size-3.5" />}
              </Button>
              <Button
                size="icon"
                variant={c.status === "rejected" ? "secondary" : "ghost"}
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => onUpdateStatus(c, "rejected")}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          </TableCell>
        )
      default:
        return null
    }
  }

  return (
    <div className="overflow-x-auto pb-10">
      <div className="flex justify-end mb-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" />}
          >
              <SlidersHorizontalIcon className="size-3.5" />
              {t("table.columns")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ALL_COLUMNS.filter(c => c.id !== "handle" && c.id !== "actions").map(col => (
              <DropdownMenuCheckboxItem
                key={col.id}
                checked={visibleColumns.includes(col.id)}
                onCheckedChange={(checked) => {
                  if (checked) onVisibleColumnsChange([...visibleColumns, col.id])
                  else onVisibleColumnsChange(visibleColumns.filter(c => c !== col.id))
                }}
              >
                {t(col.labelKey)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {activeColumns.map(col => (
              <TableHead
                key={col.id}
                className={cn(
                  col.align === "right" && "text-right",
                  col.id === "handle" && "w-[160px]",
                  col.sortable && "cursor-pointer select-none hover:text-foreground"
                )}
                onClick={col.sortable ? () => onSort(col.id) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {t(col.labelKey)}
                  {col.sortable && sortColumn === col.id && (
                    sortDir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedCreators.map((c) => (
              <TableRow
                key={c.campaign_creator_id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onSelect(c)}
              >
                {activeColumns.map(col => renderCell(col, c))}
              </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
