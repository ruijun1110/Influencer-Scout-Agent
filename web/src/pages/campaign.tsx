import { useParams, Outlet } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useLanguage } from "@/lib/i18n"

interface Campaign {
  id: string
  name: string
  persona: string | null
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useLanguage()

  const { data: campaign, isLoading: loading, isError: notFound } = useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      if (!id) throw new Error("no id")
      const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).single()
      if (error || !data) throw new Error("not found")
      return data as Campaign
    },
    enabled: !!id,
  })

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    )
  }

  if (notFound || !campaign) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("campaign.notFound")}</EmptyTitle>
            <EmptyDescription>{t("campaign.notFoundDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Outlet context={{ campaign }} />
    </div>
  )
}
