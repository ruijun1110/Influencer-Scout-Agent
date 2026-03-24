import type { QueryClient } from "@tanstack/react-query"

const scopeToKey: Record<string, string> = {
  creators: "campaign-creators",
  keywords: "campaign-keywords",
  presets: "scout-presets",
  batches: "scout-batches",
  campaign: "campaign",
}

export function invalidateCampaignData(
  queryClient: QueryClient,
  campaignId: string,
  scopes: string[]
) {
  for (const scope of scopes) {
    const key = scopeToKey[scope]
    if (key) {
      queryClient.invalidateQueries({ queryKey: [key, campaignId] })
    }
  }
}
