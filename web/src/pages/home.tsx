import { Navigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { FolderIcon } from "lucide-react"
import { useLanguage } from "@/lib/i18n"

export default function HomePage() {
  const { user } = useAuth()
  const { t } = useLanguage()

  const { data, isLoading } = useQuery({
    queryKey: ["latest-campaign", user?.id],
    queryFn: async () => {
      if (!user) return null
      const { data, error } = await supabase
        .from("campaigns")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
    enabled: !!user,
  })

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    )
  }

  if (data?.id) {
    return <Navigate to={`/campaign/${data.id}?tab=discover`} replace />
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <FolderIcon className="size-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t("home.noCampaigns")}</EmptyTitle>
          <EmptyDescription>{t("home.noCampaignsDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
