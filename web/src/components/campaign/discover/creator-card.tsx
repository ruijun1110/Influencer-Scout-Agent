import { useState } from "react"
import { cn, formatNumber } from "@/lib/utils"
import { useLanguage } from "@/lib/i18n"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { CheckIcon, XIcon, UsersIcon, PlayCircleIcon } from "lucide-react"

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
  /** Top videos by view count (stored in creators.raw_videos). */
  raw_videos: { video_id: string; desc: string; play_count: number; digg_count: number; cover_url: string | null }[]
  batch_id: string | null
  /** Video / marketplace cover from scout; null for similar-sourced rows. */
  preview_image_url: string | null
  /** TikTok video URL for the trigger video (click to play). */
  trigger_video_url: string | null
  trigger_video_views: number
  qualified: boolean
}

/** Card + sheet: use portrait layout when preview_image_url is available; fall back to avatar for similar without preview. */
export function discoverCardMedia(creator: CreatorWithStatus): {
  layout: "avatar" | "portrait"
  src: string | null
} {
  if (creator.preview_image_url) {
    return { layout: "portrait", src: creator.preview_image_url }
  }
  if (creator.source_type === "similar") {
    return { layout: "avatar", src: creator.cover_url }
  }
  return { layout: "portrait", src: creator.cover_url }
}

/** Compact number formatting for badges */
function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(n)
}

type CriteriaStatus = "pass" | "close" | "fail"

/** Evaluate a creator's value against a preset range filter. "close" = within 20% of threshold. */
function evalCriteria(value: number, filt: { min?: number; max?: number } | undefined): CriteriaStatus | null {
  if (!filt) return null
  const { min, max } = filt
  if (min != null && value < min) {
    return value >= min * 0.8 ? "close" : "fail"
  }
  if (max != null && value > max) {
    return value <= max * 1.2 ? "close" : "fail"
  }
  return "pass"
}

const criteriaColors: Record<CriteriaStatus, string> = {
  pass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  close: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  fail: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

function QualificationBadges({ creator, snapshot }: { creator: CreatorWithStatus; snapshot: Record<string, unknown> }) {
  const items: { label: string; value: string; status: CriteriaStatus }[] = []

  const fields: { key: string; label: string; creatorValue: number }[] = [
    { key: "followers", label: "Followers", creatorValue: creator.followers },
    { key: "avg_views", label: "Avg Views", creatorValue: creator.avg_views },
    { key: "total_likes", label: "Likes", creatorValue: creator.total_likes },
    { key: "video_count", label: "Videos", creatorValue: creator.video_count },
  ]

  for (const { key, label, creatorValue } of fields) {
    const filt = snapshot[key] as { min?: number; max?: number } | undefined
    const status = evalCriteria(creatorValue, filt)
    if (status) items.push({ label, value: compactNum(creatorValue), status })
  }

  // Engagement rate (stored as decimal)
  const engFilt = snapshot.engagement_rate as { min?: number; max?: number } | undefined
  const engStatus = evalCriteria(creator.engagement_rate, engFilt)
  if (engStatus) items.push({ label: "Eng", value: `${(creator.engagement_rate * 100).toFixed(1)}%`, status: engStatus })

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {items.map(({ label, value, status }) => (
        <span
          key={label}
          className={cn("inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] leading-tight font-medium", criteriaColors[status])}
        >
          {label}: {value}
        </span>
      ))}
    </div>
  )
}

interface CreatorCardProps {
  creator: CreatorWithStatus
  presetSnapshot?: Record<string, unknown> | null
  onSelect: (creator: CreatorWithStatus) => void
  onUpdateStatus: (creator: CreatorWithStatus, status: "approved" | "rejected") => void
  onFindSimilar: (creator: CreatorWithStatus) => void
  findingSimilar?: boolean
}

export function CreatorCard({ creator, presetSnapshot, onSelect, onUpdateStatus, onFindSimilar, findingSimilar }: CreatorCardProps) {
  const { t } = useLanguage()
  const media = discoverCardMedia(creator)
  const [imgError, setImgError] = useState(false)

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
      {media.layout === "avatar" ? (
        <div className="relative flex shrink-0 justify-center bg-muted/50 py-5">
          {media.src && !imgError ? (
            <img
              src={media.src}
              alt=""
              className="size-24 rounded-full object-cover shadow-md ring-2 ring-background transition-transform duration-500 group-hover:scale-105"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UsersIcon className="size-8 opacity-25" />
            </div>
          )}
          <div className="absolute right-2 top-2">{statusBadge(creator.status)}</div>
          {!creator.qualified && presetSnapshot && (
            <div className="absolute left-2 top-2">
              <Badge className="text-[10px] bg-red-600 text-white hover:bg-red-600 shadow-sm">
                {t("card.unqualified")}
              </Badge>
            </div>
          )}
        </div>
      ) : (
        <div className="relative flex w-full shrink-0 justify-center bg-muted">
          <div className="relative aspect-[9/16] w-full max-w-[min(100%,220px)] overflow-hidden">
            {media.src && !imgError ? (
              <>
                <img
                  src={media.src}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  onError={() => setImgError(true)}
                />
                {creator.trigger_video_url && (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(creator.trigger_video_url!, '_blank')
                    }}
                  >
                    <PlayCircleIcon className="size-12 text-white/80 drop-shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                )}
                {creator.trigger_video_views > 0 && (
                  <div className="absolute bottom-1 left-1 bg-black/60 rounded px-1.5 py-0.5 text-[10px] text-white tabular-nums">
                    {formatNumber(creator.trigger_video_views)} views
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full min-h-[200px] items-center justify-center text-muted-foreground">
                <UsersIcon className="size-8 opacity-20" />
              </div>
            )}
            <div className="absolute right-2 top-2">{statusBadge(creator.status)}</div>
            {!creator.qualified && presetSnapshot && (
              <div className="absolute left-2 top-2">
                <Badge className="text-[10px] bg-red-600 text-white hover:bg-red-600 shadow-sm">
                  {t("card.unqualified")}
                </Badge>
              </div>
            )}
          </div>
        </div>
      )}

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

        {/* Qualification criteria badges */}
        {presetSnapshot && <QualificationBadges creator={creator} snapshot={presetSnapshot} />}

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
            disabled={findingSimilar}
            title={t("card.findSimilarCreators")}
          >
            {findingSimilar ? <Spinner className="size-3.5" /> : <UsersIcon className="size-3.5" />}
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
