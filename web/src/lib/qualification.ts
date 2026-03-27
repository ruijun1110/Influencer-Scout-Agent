/**
 * Client-side qualification check — mirrors backend _check_qualified().
 * Checks: followers, avg_views, engagement_rate, total_likes, video_count ranges.
 */
export function checkQualifiedClient(
  creator: { followers: number; avg_views: number; engagement_rate: number; total_likes: number; video_count: number },
  filters: Record<string, unknown>
): boolean {
  const checks: Record<string, number> = {
    followers: creator.followers,
    avg_views: creator.avg_views,
    total_likes: creator.total_likes,
    video_count: creator.video_count,
    engagement_rate: creator.engagement_rate,
  }
  for (const [key, value] of Object.entries(checks)) {
    const filt = filters[key] as { min?: number; max?: number } | undefined
    if (!filt || typeof filt !== "object") continue
    if (filt.min != null && value < filt.min) return false
    if (filt.max != null && value > filt.max) return false
  }
  return true
}
