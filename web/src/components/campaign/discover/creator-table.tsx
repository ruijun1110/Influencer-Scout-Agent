import { formatNumber } from "@/lib/utils"
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
import { CheckIcon, XIcon, ExternalLinkIcon } from "lucide-react"
import type { CreatorWithStatus } from "./creator-card"

interface CreatorTableProps {
  creators: CreatorWithStatus[]
  presetMatchSet: Set<string> | null
  onSelect: (creator: CreatorWithStatus) => void
  onUpdateStatus: (creator: CreatorWithStatus, status: "approved" | "rejected") => void
}

export function CreatorTable({ creators, presetMatchSet, onSelect, onUpdateStatus }: CreatorTableProps) {
  const { t } = useLanguage()

  function statusBadge(status: string) {
    if (status === "approved") return <Badge variant="default" className="text-[10px]">{t("card.approved")}</Badge>
    if (status === "rejected") return <Badge variant="secondary" className="text-[10px]">{t("card.rejected")}</Badge>
    return <Badge variant="outline" className="text-[10px]">{t("filter.unreviewed")}</Badge>
  }

  return (
    <div className="overflow-x-auto pb-10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">{t("outreach.handle")}</TableHead>
            <TableHead className="text-right">{t("filter.followers")}</TableHead>
            <TableHead className="text-right">{t("filter.avgViews")}</TableHead>
            <TableHead className="text-right">{t("table.engRate")}</TableHead>
            <TableHead className="text-right">{t("table.totalLikes")}</TableHead>
            <TableHead className="text-right">{t("table.videos")}</TableHead>
            <TableHead className="text-right">{t("table.emails")}</TableHead>
            <TableHead>{t("keywords.status")}</TableHead>
            <TableHead>{t("discover.source")}</TableHead>
            <TableHead className="text-right">{t("keywords.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {creators.map((c) => {
            const dimmed = presetMatchSet && !presetMatchSet.has(c.campaign_creator_id)
            return (
              <TableRow
                key={c.campaign_creator_id}
                className={`cursor-pointer hover:bg-muted/50 ${dimmed ? "opacity-40 grayscale" : ""}`}
                onClick={() => onSelect(c)}
              >
                <TableCell className="font-medium py-2.5">
                  <div className="flex items-center gap-1.5">
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
                <TableCell className="text-right text-sm py-2.5">{formatNumber(c.followers)}</TableCell>
                <TableCell className="text-right text-sm py-2.5">{formatNumber(c.avg_views)}</TableCell>
                <TableCell className="text-right text-sm py-2.5">{c.engagement_rate ? `${(c.engagement_rate * 100).toFixed(1)}%` : "\u2014"}</TableCell>
                <TableCell className="text-right text-sm py-2.5">{formatNumber(c.total_likes)}</TableCell>
                <TableCell className="text-right text-sm py-2.5">{c.video_count || "\u2014"}</TableCell>
                <TableCell className="text-right text-sm py-2.5">
                  {c.emails.length > 0 ? (
                    <Badge variant="outline" className="text-[10px]">{c.emails.length}</Badge>
                  ) : "\u2014"}
                </TableCell>
                <TableCell className="py-2.5">{statusBadge(c.status)}</TableCell>
                <TableCell className="text-xs text-muted-foreground py-2.5">
                  {c.source_type === "similar"
                    ? `~ ${c.source_handle || ""}`
                    : c.source_keyword ? `#${c.source_keyword}` : "\u2014"}
                </TableCell>
                <TableCell className="text-right py-2.5" onClick={(e) => e.stopPropagation()}>
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
                      variant={c.status === "rejected" ? "secondary" : "ghost"}
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onUpdateStatus(c, "rejected")}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
