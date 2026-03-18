import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { MOCK_CAMPAIGNS } from "@/lib/mock-data"
import { Skeleton } from "@/components/ui/skeleton"
import DiscoverTab from "@/components/campaign/discover-tab"
import KeywordsTab from "@/components/campaign/keywords-tab"
import OutreachTab from "@/components/campaign/outreach-tab"
import SettingsTab from "@/components/campaign/settings-tab"

interface Campaign {
  id: string
  name: string
  persona: string | null
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const [campaign, setCampaign] = useState<Campaign | null>(MOCK_CAMPAIGNS[0] as Campaign)
  const [loading, setLoading] = useState(false)

  const activeTab = searchParams.get("tab") || "discover"

  useEffect(() => {
    if (!id) return
    supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setCampaign(data)
        }
        setLoading(false)
      })
  }, [id])

  if (loading || !campaign) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {activeTab === "discover" && <DiscoverTab campaign={campaign} />}
      {activeTab === "keywords" && <KeywordsTab campaign={campaign} />}
      {activeTab === "outreach" && <OutreachTab campaign={campaign} />}
      {activeTab === "settings" && <SettingsTab campaign={campaign} />}
    </div>
  )
}
