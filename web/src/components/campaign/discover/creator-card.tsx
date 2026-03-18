import { cn, formatNumber } from "@/lib/utils"
import { useLanguage } from "@/lib/i18n"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckIcon, XIcon, UsersIcon } from "lucide-react"

export interface CreatorWithStatus {
  id: string
  campaign_creator_id: string
  handle: string
  profile_url: string | null
  cover_url: string | null
  followers: number
  avg_views: number
  bio: string | null
  bio_link: string | null
  emails: string[]
  tier: string | null
  status: "unreviewed" | "approved" | "rejected"
  source_type: "search" | "similar"
  source_keyword: string | null
  source_handle: string | null
  nickname: string | null
  country_code: string | null
  total_likes: number
  video_count: number
  following_count: number
  verified: boolean
  engagement_rate: number
  median_views: number
  tcm_id: string | null
  tcm_link: string | null
  batch_id: string | null
}

interface CreatorCardProps {
  creator: CreatorWithStatus
  onSelect: (creator: CreatorWithStatus) => void
  onUpdateStatus: (creator: CreatorWithStatus, status: "approved" | "rejected") => void
  onFindSimilar: (creator: CreatorWithStatus) => void
}

export function CreatorCard({ creator, onSelect, onUpdateStatus, onFindSimilar }: CreatorCardProps) {
  const { t } = useLanguage()

  function statusBadge(status: string) {
    if (status === "approved") return <Badge variant="default" className="text-[10px]">{t("card.approved")}</Badge>
    if (status === "rejected") return <Badge variant="secondary" className="text-[10px]">{t("card.rejected")}</Badge>
    return null
  }

  return (
    <Card
      className={cn(
        "group flex flex-col overflow-hidden cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
        creator.status === "rejected" && "opacity-50 grayscale hover:grayscale-0 transition-opacity"
      )}
      onClick={() => onSelect(creator)}
    >
      <div className="aspect-video bg-muted relative w-full overflow-hidden shrink-0">
        {creator.cover_url ? (
          <img
            src={creator.cover_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <UsersIcon className="size-8 opacity-20" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          {statusBadge(creator.status)}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <h3 className="text-sm font-semibold truncate leading-none mb-1">
            @{creator.handle}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{t("discover.followers", { count: formatNumber(creator.followers) })}</span>
            <span>{t("discover.avgViews", { count: formatNumber(creator.avg_views) })}</span>
            {creator.engagement_rate > 0 && (
              <span>{t("card.engRate", { rate: (creator.engagement_rate * 100).toFixed(1) })}</span>
            )}
          </div>
        </div>

        {(creator.source_type === "similar" || creator.source_keyword) && (
          <div className="flex flex-wrap gap-1">
            {creator.source_type === "similar" ? (
              <Badge variant="outline" className="text-[10px]">
                {t("card.similar")}{creator.source_handle ? ` @${creator.source_handle}` : ""}
              </Badge>
            ) : creator.source_keyword ? (
              <Badge variant="outline" className="text-[10px]">#{creator.source_keyword}</Badge>
            ) : null}
          </div>
        )}

        <div className="flex gap-1.5 pt-2 mt-auto border-t" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant={creator.status === "approved" ? "default" : "outline"}
            className="flex-1 h-7 text-xs px-1"
            onClick={() => onUpdateStatus(creator, "approved")}
            title={t("card.approveCreator")}
          >
            <CheckIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("discover.approve")}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs px-1"
            onClick={() => onFindSimilar(creator)}
            title={t("card.findSimilarCreators")}
          >
            <UsersIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("card.similarBtn")}</span>
          </Button>
          <Button
            size="sm"
            variant={creator.status === "rejected" ? "secondary" : "ghost"}
            className="flex-1 h-7 text-xs px-1 text-muted-foreground hover:text-destructive"
            onClick={() => onUpdateStatus(creator, "rejected")}
            title={t("card.rejectCreator")}
          >
            <XIcon className="size-3.5" />
            <span className="hidden sm:inline">{t("discover.reject")}</span>
          </Button>
        </div>
      </div>
    </Card>
  )
}
