import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { NavUser } from "@/components/nav-user"
import { NewCampaignDialog } from "@/components/new-campaign-dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ChevronsUpDownIcon,
  HashIcon,
  MailIcon,
  MegaphoneIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react"
import { useLanguage } from "@/lib/i18n"

interface Campaign {
  id: string
  name: string
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { id: routeCampaignId } = useParams()
  const [searchParams] = useSearchParams()
  const [lastCampaignId] = useState<string | undefined>(routeCampaignId)



  const activeCampaignId = routeCampaignId ?? lastCampaignId
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showNewCampaign, setShowNewCampaign] = useState(false)

  const activeTab = searchParams.get("tab") || "discover"
  const activeCampaign = campaigns.find((c) => c.id === activeCampaignId)

  useEffect(() => {
    if (!user) return
    supabase
      .from("campaigns")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCampaigns(data ?? [])
      })
  }, [user, activeCampaignId])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full rounded-lg outline-none ring-sidebar-ring focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0">
                <SidebarMenuButton
                  size="lg"
                  className="cursor-pointer"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <MegaphoneIcon className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {activeCampaign ? activeCampaign.name : t("sidebar.selectCampaign")}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                {campaigns.map((campaign) => (
                  <DropdownMenuItem
                    key={campaign.id}
                    onClick={() => navigate(`/campaign/${campaign.id}?tab=discover`)}
                    className="cursor-pointer"
                  >
                    <MegaphoneIcon className="mr-2 size-4" />
                    {campaign.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowNewCampaign(true)}
                  className="cursor-pointer"
                >
                  <PlusIcon className="mr-2 size-4" />
                  {t("sidebar.newCampaign")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {activeCampaignId && (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "discover"}
                  onClick={() => navigate(`/campaign/${activeCampaignId}?tab=discover`)}
                  className="cursor-pointer"
                >
                  <SearchIcon className="size-4" />
                  <span>{t("sidebar.discover")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "keywords"}
                  onClick={() => navigate(`/campaign/${activeCampaignId}?tab=keywords`)}
                  className="cursor-pointer"
                >
                  <HashIcon className="size-4" />
                  <span>{t("sidebar.keywords")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "outreach"}
                  onClick={() => navigate(`/campaign/${activeCampaignId}?tab=outreach`)}
                  className="cursor-pointer"
                >
                  <MailIcon className="size-4" />
                  <span>{t("sidebar.outreach")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "settings"}
                  onClick={() => navigate(`/campaign/${activeCampaignId}?tab=settings`)}
                  className="cursor-pointer"
                >
                  <SettingsIcon className="size-4" />
                  <span>{t("sidebar.settings")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
      <NewCampaignDialog open={showNewCampaign} onOpenChange={setShowNewCampaign} />
    </Sidebar>
  )
}
