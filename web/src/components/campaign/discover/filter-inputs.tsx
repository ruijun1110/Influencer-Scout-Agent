import { useLanguage } from "@/lib/i18n"
import { NumberInput } from "@/components/ui/number-input"
import { Field, FieldLabel } from "@/components/ui/field"

interface FilterInputsProps {
  filters: Record<string, any>
  onChange: (filters: Record<string, any>) => void
  /** Show min_video_views field (only relevant for scout dialog, not adjust) */
  showMinVideoViews?: boolean
}

export function FilterInputs({ filters, onChange, showMinVideoViews = false }: FilterInputsProps) {
  const { t } = useLanguage()

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel className="text-xs">{t("settings.followers")}</FieldLabel>
        <div className="flex items-center gap-1">
          <NumberInput
            placeholder={t("settings.min")}
            value={filters.followers?.min ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              followers: { ...filters.followers, min: v },
            })}
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <NumberInput
            placeholder={t("settings.max")}
            value={filters.followers?.max ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              followers: { ...filters.followers, max: v },
            })}
            className="h-7 text-xs"
          />
        </div>
      </Field>
      <Field>
        <FieldLabel className="text-xs">{t("settings.avgViews")}</FieldLabel>
        <div className="flex items-center gap-1">
          <NumberInput
            placeholder={t("settings.min")}
            value={filters.avg_views?.min ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              avg_views: { ...filters.avg_views, min: v },
            })}
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <NumberInput
            placeholder={t("settings.max")}
            value={filters.avg_views?.max ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              avg_views: { ...filters.avg_views, max: v },
            })}
            className="h-7 text-xs"
          />
        </div>
      </Field>
      <Field>
        <FieldLabel className="text-xs">{t("settings.engagementRate")}</FieldLabel>
        <div className="flex items-center gap-1">
          <NumberInput
            placeholder={t("settings.min")}
            value={filters.engagement_rate?.min != null ? filters.engagement_rate.min * 100 : ""}
            onValueChange={(v) => onChange({
              ...filters,
              engagement_rate: { ...filters.engagement_rate, min: v != null ? v / 100 : null },
            })}
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </Field>
      <Field>
        <FieldLabel className="text-xs">{t("settings.totalLikes")}</FieldLabel>
        <div className="flex items-center gap-1">
          <NumberInput
            placeholder={t("settings.min")}
            value={filters.total_likes?.min ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              total_likes: { ...filters.total_likes, min: v },
            })}
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <NumberInput
            placeholder={t("settings.max")}
            value={filters.total_likes?.max ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              total_likes: { ...filters.total_likes, max: v },
            })}
            className="h-7 text-xs"
          />
        </div>
      </Field>
      <Field>
        <FieldLabel className="text-xs">{t("settings.videoCount")}</FieldLabel>
        <div className="flex items-center gap-1">
          <NumberInput
            placeholder={t("settings.min")}
            value={filters.video_count?.min ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              video_count: { ...filters.video_count, min: v },
            })}
            className="h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <NumberInput
            placeholder={t("settings.max")}
            value={filters.video_count?.max ?? ""}
            onValueChange={(v) => onChange({
              ...filters,
              video_count: { ...filters.video_count, max: v },
            })}
            className="h-7 text-xs"
          />
        </div>
      </Field>
      {showMinVideoViews && (
        <Field>
          <FieldLabel className="text-xs">{t("discover.minVideoViews")}</FieldLabel>
          <NumberInput
            value={filters.min_video_views ?? ""}
            onValueChange={(v) => onChange({ ...filters, min_video_views: v ?? undefined })}
            placeholder="e.g. 10000"
            className="h-8 text-sm"
          />
        </Field>
      )}
    </div>
  )
}
