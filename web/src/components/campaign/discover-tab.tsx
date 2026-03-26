import { useState, useMemo, useRef, useEffect } from "react"
import { useOutletContext } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { cn, formatNumber } from "@/lib/utils"
import { apiCall } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { NumberInput } from "@/components/ui/number-input"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { ExternalLinkIcon, MailIcon, UsersIcon, CheckIcon, XIcon, SparklesIcon, PlayCircleIcon, ChevronDownIcon } from "lucide-react"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"

import {
  CreatorCard,
  discoverCardMedia,
  type CreatorWithStatus,
} from "./discover/creator-card"
import { CreatorTable, type ColumnId, DEFAULT_VISIBLE } from "./discover/creator-table"
import { DiscoverFilterBar } from "./discover/filter-bar"
import { useTasks } from "@/hooks/use-tasks"

interface Campaign {
  id: string
  name: string
  persona: string | null
}

export default function DiscoverTab() {
  const { campaign } = useOutletContext<{ campaign: Campaign }>()
  const { t } = useLanguage()
  const { batches: taskBatches, refetch: refetchTasks } = useTasks()
  const queryClient = useQueryClient()

  // Auto-refresh when a scout task completes
  const prevStatusesRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const prev = prevStatusesRef.current
    let shouldRefresh = false
    const next: Record<string, string> = {}
    for (const b of taskBatches) {
      if (b.task_id) {
        next[b.task_id] = b.task_status
        const prevStatus = prev[b.task_id]
        if (
          prevStatus &&
          prevStatus !== b.task_status &&
          (b.task_status === "completed" || b.task_status === "partial" || b.task_status === "failed")
        ) {
          shouldRefresh = true
        }
      }
    }
    prevStatusesRef.current = next
    if (shouldRefresh) {
      queryClient.invalidateQueries({ queryKey: ["campaign-creators", campaign.id] })
      queryClient.invalidateQueries({ queryKey: ["campaign-keywords", campaign.id] })
      queryClient.invalidateQueries({ queryKey: ["scout-batches", campaign.id] })
    }
  }, [taskBatches, queryClient, campaign.id])

  const [findingSimilarId, setFindingSimilarId] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>("unreviewed")
  const [sortBy, setSortBy] = useState<string>("newest")
  const [batchFilter, setBatchFilter] = useState<string>("all")
  const [keywordFilter, setKeywordFilter] = useState<string[]>([])
  const [presetFilter, setPresetFilter] = useState<string>("all")
  const [showAll, setShowAll] = useState(false)
  const [viewMode, setViewMode] = useState<"card" | "table">(() => {
    const stored = localStorage.getItem("discover-view-mode")
    return stored === "table" ? "table" : "card"
  })

  function handleSetViewMode(mode: "card" | "table") {
    setViewMode(mode)
    localStorage.setItem("discover-view-mode", mode)
  }

  const [selectedCreator, setSelectedCreator] = useState<CreatorWithStatus | null>(null)

  // Table column visibility & sort
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => {
    const stored = localStorage.getItem("table-columns")
    if (stored) try { return JSON.parse(stored) } catch { /* ignore */ }
    return [...DEFAULT_VISIBLE]
  })
  const [tableSortColumn, setTableSortColumn] = useState<ColumnId | null>(null)
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc")

  function handleVisibleColumnsChange(cols: ColumnId[]) {
    setVisibleColumns(cols)
    localStorage.setItem("table-columns", JSON.stringify(cols))
  }

  function handleTableSort(col: ColumnId) {
    if (tableSortColumn === col) {
      setTableSortDir(d => d === "asc" ? "desc" : "asc")
    } else {
      setTableSortColumn(col)
      setTableSortDir("desc")
    }
  }

  // Scout dialog state
  const [showScoutDialog, setShowScoutDialog] = useState(false)
  const [scoutSourceType, setScoutSourceType] = useState<"keyword_video" | "similar">("keyword_video")
  const [scoutKeywords, setScoutKeywords] = useState<Set<string>>(new Set())

  const [scoutTargetPerKeyword, setScoutTargetPerKeyword] = useState(20)
  const [scoutCountry, setScoutCountry] = useState("US")
  const [scoutHandle, setScoutHandle] = useState("")
  const [scoutSuggestions, setScoutSuggestions] = useState<string[]>([])
  const [scoutSuggestSelected, setScoutSuggestSelected] = useState<Set<string>>(new Set())
  const [showSuggestionsDialog, setShowSuggestionsDialog] = useState(false)
  const [scoutGenerating, setScoutGenerating] = useState(false)
  const [scoutRunning, setScoutRunning] = useState(false)
  const [newScoutKeyword, setNewScoutKeyword] = useState("")
  const [scoutBatchName, setScoutBatchName] = useState("")
  const [showFilters, setShowFilters] = useState(true)
  const [showSavePresetForm, setShowSavePresetForm] = useState(false)
  const [inlinePresetName, setInlinePresetName] = useState("")
  const [scoutFilters, setScoutFilters] = useState<Record<string, any>>({})

  // 1. Fetch Keywords for Filter
  const { data: keywords = [] } = useQuery({
    queryKey: ["campaign-keywords", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keywords")
        .select("keyword")
        .eq("campaign_id", campaign.id)
      if (error) {
        toast.error(error.message)
        return []
      }
      return data?.map((k) => k.keyword) ?? []
    }
  })

  // 2. Fetch API key status
  const { data: apiKeys } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiCall("/api/api-keys"),
  })
  const tikhubConfigured = apiKeys?.configured === true

  // 3. Fetch Batches
  const { data: batches = [] } = useQuery({
    queryKey: ["scout-batches", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_batches")
        .select("id, source_type, source_params, preset_snapshot, created_at, name")
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })
      if (error) {
        toast.error(error.message)
        return []
      }
      return data ?? []
    }
  })

  // 3. Fetch Presets
  const { data: presets = [] } = useQuery({
    queryKey: ["scout-presets", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scout_presets")
        .select("id, name, is_default, filters")
        .eq("campaign_id", campaign.id)
        .order("created_at")
      if (error) {
        toast.error(error.message)
        return []
      }
      return data ?? []
    }
  })

  // 4. Fetch Creators
  const { data: creators = [], isLoading, isError } = useQuery({
    queryKey: ["campaign-creators", campaign.id, statusFilter, sortBy, batchFilter, keywordFilter],
    queryFn: async () => {
      // Two-step fetch avoids PostgREST "ambiguous relationship" / bad embed hints when
      // campaign_creators has multiple FKs to creators (e.g. creator_id + source_creator_id).
      let ccQuery = supabase
        .from("campaign_creators")
        .select(
          "id, status, source_type, source_keyword, source_handle, batch_id, creator_id, preview_image_url, trigger_video_url, trigger_video_views, qualified"
        )
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: statusFilter === "unreviewed" })

      if (statusFilter !== "all") ccQuery = ccQuery.eq("status", statusFilter)

      const { data: ccRows, error: ccError } = await ccQuery
      if (ccError) {
        toast.error(ccError.message)
        throw new Error(ccError.message)
      }
      if (!ccRows?.length) return []

      const creatorIds = [
        ...new Set(
          ccRows.map((r) => r.creator_id).filter((id): id is string => Boolean(id))
        ),
      ]
      if (creatorIds.length === 0) return []

      const { data: creatorRows, error: cError } = await supabase
        .from("creators")
        .select(
          "id, handle, profile_url, cover_url, followers, avg_views, bio, bio_link, emails, tier, nickname, country_code, total_likes, video_count, following_count, verified, engagement_rate, median_views, tcm_id, tcm_link, raw_videos"
        )
        .in("id", creatorIds)

      if (cError) {
        toast.error(cError.message)
        throw new Error(cError.message)
      }

      const byId = new Map((creatorRows ?? []).map((c) => [c.id, c]))

      const mapped: CreatorWithStatus[] = []
      for (const d of ccRows) {
        if (!d.creator_id) continue
        const c = byId.get(d.creator_id)
        if (!c) continue
        mapped.push({
          id: c.id,
          campaign_creator_id: d.id,
          handle: c.handle,
          profile_url: c.profile_url,
          cover_url: c.cover_url,
          followers: c.followers ?? 0,
          avg_views: c.avg_views ?? 0,
          bio: c.bio ?? "",
          bio_link: c.bio_link,
          emails: c.emails ?? [],
          tier: c.tier,
          status: d.status,
          source_type: d.source_type,
          source_keyword: d.source_keyword,
          source_handle: d.source_handle ?? null,
          batch_id: d.batch_id,
          nickname: c.nickname ?? null,
          country_code: c.country_code ?? null,
          total_likes: c.total_likes ?? 0,
          video_count: c.video_count ?? 0,
          following_count: c.following_count ?? 0,
          verified: c.verified ?? false,
          engagement_rate: c.engagement_rate ?? 0,
          median_views: c.median_views ?? 0,
          tcm_id: c.tcm_id ?? null,
          tcm_link: c.tcm_link ?? null,
          raw_videos: (c.raw_videos as any[]) ?? [],
          preview_image_url: d.preview_image_url ?? null,
          trigger_video_url: d.trigger_video_url ?? null,
          trigger_video_views: d.trigger_video_views ?? 0,
          qualified: d.qualified ?? true,
        })
      }

      return mapped
    }
  })

  // Client-side filtering and sorting
  const filteredCreators = useMemo(() => {
    let result = [...creators]

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter(c => c.status === statusFilter)
    }

    // Batch filter
    if (batchFilter !== "all") {
      result = result.filter(c => c.batch_id === batchFilter)
    }

    // Keyword filter
    if (keywordFilter.length > 0) {
      result = result.filter(c => c.source_keyword && keywordFilter.includes(c.source_keyword))
    }

    // Qualified filter (hide unqualified unless showAll is on)
    if (!showAll) {
      result = result.filter(c => c.qualified)
    }

    // Sort
    if (sortBy === "followers") {
      result.sort((a, b) => b.followers - a.followers)
    } else if (sortBy === "avg_views") {
      result.sort((a, b) => b.avg_views - a.avg_views)
    }
    // "newest" = default order from query (created_at desc)

    return result
  }, [creators, statusFilter, batchFilter, keywordFilter, showAll, sortBy])

  // Preset match set for dimming non-matching cards when showAll is on
  const presetMatchSet = useMemo(() => {
    if (!showAll) return null
    return new Set(creators.filter(c => c.qualified).map(c => c.campaign_creator_id))
  }, [creators, showAll])

  // 5. Mutations
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: "approved" | "rejected" }) => {
      await supabase
        .from("campaign_creators")
        .update({ status })
        .eq("id", id)
    },
    onMutate: async ({ id, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["campaign-creators", campaign.id] })
      // Optimistically update ALL cached queries that start with this key
      queryClient.setQueriesData<CreatorWithStatus[]>(
        { queryKey: ["campaign-creators", campaign.id] },
        (old) => old?.map((c) => c.campaign_creator_id === id ? { ...c, status } : c)
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-creators", campaign.id] })
    }
  })

  const findSimilarMutation = useMutation({
    mutationFn: async ({ creatorId, handle }: { creatorId: string; handle: string }) => {
      await apiCall("/api/scout/run", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaign.id,
          source_type: "similar",
          source_params: { creator_id: creatorId, creator_handle: handle },
        }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-creators", campaign.id] })
      queryClient.invalidateQueries({ queryKey: ["scout-batches", campaign.id] })
      void refetchTasks()
      toast.success(t("discover.scoutQueued"))
    },
    onError: (e: Error) => {
      toast.error(e.message)
    },
    onSettled: () => setFindingSimilarId(null),
  })

  function handleUpdateStatus(creator: CreatorWithStatus, status: "approved" | "rejected") {
    updateStatusMutation.mutate({ id: creator.campaign_creator_id, status })
    if (selectedCreator?.campaign_creator_id === creator.campaign_creator_id) {
       setSelectedCreator({ ...creator, status })
    }
  }

  function handleFindSimilar(creator: CreatorWithStatus) {
    if (findingSimilarId) return
    setFindingSimilarId(creator.id)
    findSimilarMutation.mutate({ creatorId: creator.id, handle: creator.handle })
  }

  async function handleAddScoutKeyword() {
    const kw = newScoutKeyword.trim()
    if (!kw) return
    setNewScoutKeyword("")
    try {
      const { error } = await supabase.from("keywords").insert({
        campaign_id: campaign.id,
        keyword: kw,
        source: "manual",
      })
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ["campaign-keywords", campaign.id] })
      setScoutKeywords(prev => new Set([...prev, kw]))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("keywords.addFailed"))
    }
  }

  function renderDiscoverSheetHero(c: CreatorWithStatus) {
    const media = discoverCardMedia(c)
    if (!media.src) return null
    if (media.layout === "avatar") {
      return (
        <div className="flex justify-center pt-1">
          <img
            src={media.src}
            alt=""
            className="size-28 rounded-full object-cover shadow-md ring-2 ring-border"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        </div>
      )
    }
    return (
      <div className="flex justify-center">
        <div className="group/hero relative aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-xl bg-muted">
          <img src={media.src} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
          {c.trigger_video_url && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors cursor-pointer"
              onClick={() => window.open(c.trigger_video_url!, '_blank')}
            >
              <PlayCircleIcon className="size-14 text-white/80 drop-shadow-lg opacity-60 group-hover/hero:opacity-100 transition-opacity" />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <DiscoverFilterBar
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        sortBy={sortBy}
        setSortBy={setSortBy}
        batchFilter={batchFilter}
        setBatchFilter={setBatchFilter}
        keywordFilter={keywordFilter}
        setKeywordFilter={setKeywordFilter}
        presetFilter={presetFilter}
        setPresetFilter={setPresetFilter}
        showAll={showAll}
        setShowAll={setShowAll}
        viewMode={viewMode}
        setViewMode={handleSetViewMode}
        batches={batches}
        keywords={keywords}
        presets={presets}
        totalCreators={filteredCreators.length}
        qualifiedCount={creators.filter(c => c.qualified).length}
        activePresetSnapshot={
          batchFilter !== "all"
            ? (batches.find(b => b.id === batchFilter) as Record<string, unknown>)?.preset_snapshot as Record<string, unknown> | null ?? null
            : null
        }
        onOpenScout={() => setShowScoutDialog(true)}
        tikhubConfigured={tikhubConfigured}
      />

      {isError ? (
        <Empty className="py-24">
          <EmptyHeader>
            <EmptyTitle>{t("discover.loadError")}</EmptyTitle>
            <EmptyDescription>{t("discover.loadErrorDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      ) : filteredCreators.length === 0 ? (
        <Empty className="py-24">
          <EmptyHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
               <UsersIcon className="size-6 text-muted-foreground" />
            </div>
            <EmptyTitle>{t("discover.noCreators")}</EmptyTitle>
            <EmptyDescription>{t("discover.noCreatorsDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        viewMode === "card" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 pb-10">
            {filteredCreators.map((creator) => (
              <div
                key={creator.campaign_creator_id}
                className={presetMatchSet && !presetMatchSet.has(creator.campaign_creator_id) ? "relative opacity-50" : ""}
              >
                <CreatorCard
                  creator={creator}
                  onSelect={setSelectedCreator}
                  onUpdateStatus={handleUpdateStatus}
                  onFindSimilar={handleFindSimilar}
                  findingSimilar={findingSimilarId === creator.id}
                />
              </div>
            ))}
          </div>
        ) : (
          <CreatorTable
            creators={filteredCreators}
            presetMatchSet={presetMatchSet}
            onSelect={setSelectedCreator}
            onUpdateStatus={handleUpdateStatus}
            onFindSimilar={handleFindSimilar}
            findingSimilarId={findingSimilarId}
            visibleColumns={visibleColumns}
            onVisibleColumnsChange={handleVisibleColumnsChange}
            sortColumn={tableSortColumn}
            sortDir={tableSortDir}
            onSort={handleTableSort}
          />
        )
      )}

      <Sheet open={!!selectedCreator} onOpenChange={() => setSelectedCreator(null)}>
        <SheetContent className="overflow-y-auto">
          {selectedCreator && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  @{selectedCreator.handle}
                  {selectedCreator.profile_url && (
                    <a
                      href={selectedCreator.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {t("discover.followers", { count: formatNumber(selectedCreator.followers) })}
                  {" / "}
                  {t("discover.avgViews", { count: formatNumber(selectedCreator.avg_views) })}
                  {selectedCreator.engagement_rate > 0 && (
                    <> {" / "} {t("card.engRate", { rate: (selectedCreator.engagement_rate * 100).toFixed(1) })}</>
                  )}
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-4 px-4 pb-24">
                {renderDiscoverSheetHero(selectedCreator)}

                {selectedCreator.bio && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.bio")}</p>
                    <p className="text-sm">{selectedCreator.bio}</p>
                  </div>
                )}

                {selectedCreator.bio_link && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.link")}</p>
                    <a
                      href={selectedCreator.bio_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all"
                    >
                      {selectedCreator.bio_link}
                    </a>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.emails")}</p>
                  {selectedCreator.emails.length > 0 ? (
                    selectedCreator.emails.map((email) => (
                      <div key={email} className="flex items-center gap-2 text-sm">
                        <MailIcon className="size-3 text-muted-foreground" />
                        {email}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("discover.noEmail")}</p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.source")}</p>
                  <p className="text-sm">
                    {selectedCreator.source_type === "search"
                      ? t("discover.keywordSource", { keyword: selectedCreator.source_keyword ?? "" })
                      : t("discover.similarLookup")}
                  </p>
                </div>

                {selectedCreator.tier && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.tier")}</p>
                    <Badge variant="outline">{selectedCreator.tier}</Badge>
                  </div>
                )}

                {selectedCreator.raw_videos.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">{t("discover.topVideos")}</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {selectedCreator.raw_videos.slice(0, 3).map((v) => (
                        <a
                          key={v.video_id}
                          href={`https://www.tiktok.com/@${selectedCreator.handle}/video/${v.video_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 w-28 rounded-lg overflow-hidden border hover:border-primary/50 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="aspect-[9/16] bg-muted relative">
                            {v.cover_url ? (
                              <img src={v.cover_url} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                            ) : (
                              <div className="flex h-full items-center justify-center text-muted-foreground text-xs">No cover</div>
                            )}
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3">
                              <p className="text-[10px] text-white font-medium tabular-nums">{formatNumber(v.play_count)} views</p>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="sticky bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent pt-6 px-4 pb-6">
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant={selectedCreator.status === "approved" ? "default" : "outline"}
                    onClick={() => handleUpdateStatus(selectedCreator, "approved")}
                  >
                    <CheckIcon data-icon />
                    {t("discover.approve")}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleFindSimilar(selectedCreator)}
                    disabled={findSimilarMutation.isPending}
                  >
                    {findSimilarMutation.isPending && <Spinner />}
                    {t("discover.findSimilar")}
                  </Button>
                  <Button
                    className="flex-1"
                    variant={selectedCreator.status === "rejected" ? "secondary" : "ghost"}
                    onClick={() => handleUpdateStatus(selectedCreator, "rejected")}
                  >
                    <XIcon data-icon />
                    {t("discover.reject")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={showScoutDialog} onOpenChange={setShowScoutDialog}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("discover.scoutTitle")}</DialogTitle>
            <DialogDescription>
              {t("discover.scoutDesc")}
            </DialogDescription>
          </DialogHeader>

          {/* Batch name (Item 3) */}
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("discover.batchName")}</FieldLabel>
              <Input
                value={scoutBatchName}
                onChange={(e) => setScoutBatchName(e.target.value)}
                placeholder={t("discover.batchNamePlaceholder")}
                className="h-8 text-sm"
              />
            </Field>

            {/* Source type (Item 4: removed keyword_creator) */}
            <Field>
              <FieldLabel>{t("discover.sourceType")}</FieldLabel>
              <div className="flex gap-2">
                {(["keyword_video", "similar"] as const).map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={scoutSourceType === type ? "default" : "outline"}
                    onClick={() => setScoutSourceType(type)}
                    type="button"
                  >
                    {type === "keyword_video" ? t("discover.sourceVideo")
                      : t("discover.sourceSimilar")}
                  </Button>
                ))}
              </div>
            </Field>

            {/* Source config */}
            {scoutSourceType !== "similar" ? (
              <div className="flex flex-col gap-4">
                <Field>
                  <FieldLabel>{t("discover.selectKeywords")}</FieldLabel>
                  {scoutKeywords.size > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {Array.from(scoutKeywords).map((kw) => (
                        <Badge key={kw} variant="secondary" className="text-xs gap-1">
                          {kw}
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Set(scoutKeywords)
                              next.delete(kw)
                              setScoutKeywords(next)
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  {/* Item 2: Add new keyword inline */}
                  <div className="flex gap-1.5 mb-2">
                    <Input
                      value={newScoutKeyword}
                      onChange={(e) => setNewScoutKeyword(e.target.value)}
                      placeholder={t("keywords.addPlaceholder")}
                      className="h-8 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddScoutKeyword() } }}
                    />
                    <Button size="sm" variant="outline" className="h-8 shrink-0" type="button" onClick={handleAddScoutKeyword}>
                      {t("discover.add")}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-md border p-2">
                    {keywords.map((kw) => (
                      <label
                        key={kw}
                        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted cursor-pointer text-sm"
                      >
                        <Checkbox
                          checked={scoutKeywords.has(kw)}
                          onCheckedChange={(checked) => {
                            const next = new Set(scoutKeywords)
                            if (checked) next.add(kw)
                            else next.delete(kw)
                            setScoutKeywords(next)
                          }}
                        />
                        {kw}
                      </label>
                    ))}
                  </div>
                  <div className="relative group self-start mt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={scoutGenerating || !campaign.persona}
                    type="button"
                    onClick={async () => {
                      if (!campaign.persona) return
                      setScoutGenerating(true)
                      try {
                        const existing = keywords
                        const { keywords: generated } = await apiCall("/api/keywords/generate", {
                          method: "POST",
                          body: JSON.stringify({
                            persona: campaign.persona,
                            existing_keywords: existing,
                          }),
                        })
                        setScoutSuggestions(generated)
                        // Don't auto-select — let user review first
                      } catch {
                        // error handled by apiCall
                      } finally {
                        setScoutGenerating(false)
                      }
                    }}
                  >
                    {scoutGenerating ? <Spinner /> : <SparklesIcon data-icon />}
                    {t("discover.generateAI")}
                  </Button>
                  {!campaign.persona && (
                    <div className="absolute -bottom-7 left-0 hidden group-hover:block text-xs text-muted-foreground bg-popover border rounded px-2 py-1 shadow-sm whitespace-nowrap z-10">
                      {t("keywords.personaRequired")}
                    </div>
                  )}
                  </div>

                  {scoutSuggestions.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      <p className="text-xs text-muted-foreground">
                        {t("discover.suggestionsHint", { count: scoutSuggestions.length })}
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        className="self-start"
                        onClick={() => {
                          setScoutSuggestSelected(new Set(scoutSuggestions))
                          setShowSuggestionsDialog(true)
                        }}
                      >
                        <CheckIcon className="size-3.5 mr-1" />
                        {t("discover.reviewAndAdd")}
                      </Button>
                    </div>
                  )}
                </Field>

                <div className="grid gap-4 grid-cols-2">
                  <Field>
                    <FieldLabel>{t("discover.country")}</FieldLabel>
                    <Select value={scoutCountry} onValueChange={(v) => setScoutCountry(v ?? "")}>
                      <SelectTrigger>
                        <span className="truncate">{scoutCountry || t("discover.anyCountry")}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">US</SelectItem>
                        <SelectItem value="JP">JP</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>{t("discover.targetPerKeyword")}</FieldLabel>
                    <NumberInput
                      value={scoutTargetPerKeyword}
                      onValueChange={(v) => setScoutTargetPerKeyword(v ?? 0)}
                      min={1}
                      max={100}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">{t("discover.targetPerKeywordHint")}</p>
                  </Field>
                </div>
              </div>
            ) : (
              <Field>
                <FieldLabel>{t("discover.creatorInput")}</FieldLabel>
                <Input
                  value={scoutHandle}
                  onChange={(e) => setScoutHandle(e.target.value)}
                  placeholder={t("discover.creatorInputPlaceholder")}
                />
                <p className="text-[11px] text-muted-foreground mt-1">{t("discover.creatorInputHint")}</p>
              </Field>
            )}

            {/* Filters (Item 5: optional, collapsible) */}
            <Collapsible open={showFilters} onOpenChange={setShowFilters}>
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="self-start -ml-2 text-sm gap-1" type="button" />}
              >
                  <ChevronDownIcon className={cn("size-3.5 transition-transform", showFilters && "rotate-180")} />
                  {t("discover.filters")}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="rounded-md border p-3 mt-1 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.followers")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <NumberInput
                          placeholder={t("settings.min")}
                          value={scoutFilters.followers?.min ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            followers: { ...f.followers, min: v },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <NumberInput
                          placeholder={t("settings.max")}
                          value={scoutFilters.followers?.max ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            followers: { ...f.followers, max: v },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.avgViews")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <NumberInput
                          placeholder={t("settings.min")}
                          value={scoutFilters.avg_views?.min ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            avg_views: { ...f.avg_views, min: v },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <NumberInput
                          placeholder={t("settings.max")}
                          value={scoutFilters.avg_views?.max ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            avg_views: { ...f.avg_views, max: v },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.engagementRate")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <NumberInput
                          placeholder={t("settings.min")}
                          value={scoutFilters.engagement_rate?.min != null ? scoutFilters.engagement_rate.min * 100 : ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            engagement_rate: { ...f.engagement_rate, min: v != null ? v / 100 : null },
                          }))}
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
                          value={scoutFilters.total_likes?.min ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            total_likes: { ...f.total_likes, min: v },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <NumberInput
                          placeholder={t("settings.max")}
                          value={scoutFilters.total_likes?.max ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            total_likes: { ...f.total_likes, max: v },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.videoCount")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <NumberInput
                          placeholder={t("settings.min")}
                          value={scoutFilters.video_count?.min ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            video_count: { ...f.video_count, min: v },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <NumberInput
                          placeholder={t("settings.max")}
                          value={scoutFilters.video_count?.max ?? ""}
                          onValueChange={(v) => setScoutFilters(f => ({
                            ...f,
                            video_count: { ...f.video_count, max: v },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("discover.minVideoViews")}</FieldLabel>
                      <NumberInput
                        value={scoutFilters.min_video_views ?? ""}
                        onValueChange={(v) => setScoutFilters((f: Record<string, unknown>) => ({...f, min_video_views: v ?? undefined}))}
                        placeholder="e.g. 10000"
                        className="h-8 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Load preset */}
                    <Select value="" onValueChange={(presetId) => {
                      const preset = presets.find(p => p.id === presetId)
                      if (preset?.filters) setScoutFilters(preset.filters as Record<string, any>)
                    }}>
                      <SelectTrigger className="w-40 h-7 text-xs">
                        <span>{t("discover.loadPreset")}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Save as preset */}
                    <Button size="sm" variant="outline" className="h-7 text-xs" type="button" onClick={() => setShowSavePresetForm(true)}>
                      {t("discover.saveAsPreset")}
                    </Button>
                  </div>
                  {showSavePresetForm && (
                    <div className="flex gap-1.5">
                      <Input value={inlinePresetName} onChange={(e) => setInlinePresetName(e.target.value)} placeholder={t("settings.presetName")} className="h-7 text-xs" />
                      <Button size="sm" className="h-7 text-xs shrink-0" type="button" disabled={!inlinePresetName.trim()} onClick={async () => {
                        try {
                          const { error } = await supabase.from("scout_presets").insert({ campaign_id: campaign.id, name: inlinePresetName.trim(), is_default: false, filters: scoutFilters }).select("id").single()
                          if (error) throw error
                          queryClient.invalidateQueries({ queryKey: ["scout-presets", campaign.id] })
                          setShowSavePresetForm(false)
                          setInlinePresetName("")
                          toast.success(t("discover.presetSaved"))
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : t("discover.presetSaveFailed"))
                        }
                      }}>{t("discover.save")}</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" type="button" onClick={() => setShowSavePresetForm(false)}>{t("keywords.cancel")}</Button>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <Button
              disabled={
                scoutRunning ||
                (scoutSourceType !== "similar" && scoutKeywords.size === 0) ||
                (scoutSourceType === "similar" && !scoutHandle.trim())
              }
              onClick={async () => {
                setScoutRunning(true)
                try {
                  let source_params: Record<string, unknown>
                  if (scoutSourceType === "keyword_video") {
                    source_params = {
                      keywords: Array.from(scoutKeywords),
                      target_per_keyword: scoutTargetPerKeyword,
                      ...(scoutCountry ? { country: scoutCountry } : {}),
                    }
                  } else {
                    source_params = { creator_handle: scoutHandle.trim() }
                  }
                  const hasFilters = Object.values(scoutFilters).some(v => v != null)
                  await apiCall("/api/scout/run", {
                    method: "POST",
                    body: JSON.stringify({
                      campaign_id: campaign.id,
                      source_type: scoutSourceType,
                      source_params,
                      ...(hasFilters ? { filters: scoutFilters } : {}),
                      ...(scoutBatchName.trim() ? { name: scoutBatchName.trim() } : {}),
                    }),
                  })
                  setShowScoutDialog(false)
                  setScoutKeywords(new Set())
                  setScoutSuggestions([])
                  setScoutHandle("")
                  setScoutBatchName("")
                  queryClient.invalidateQueries({ queryKey: ["campaign-creators", campaign.id] })
                  queryClient.invalidateQueries({ queryKey: ["scout-batches", campaign.id] })
                  void refetchTasks()
                  toast.success(t("discover.scoutQueued"))
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("tasks.scoutFailedFallback"))
                } finally {
                  setScoutRunning(false)
                }
              }}
            >
              {scoutRunning ? <Spinner /> : null}
              {t("discover.startScouting", { count: scoutSourceType !== "similar" ? scoutKeywords.size : 1 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI keyword suggestions confirmation dialog — same pattern as keywords-tab */}
      <Dialog open={showSuggestionsDialog} onOpenChange={setShowSuggestionsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keywords.suggestionsTitle")}</DialogTitle>
            <DialogDescription>{t("keywords.suggestionsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {scoutSuggestions.map((kw) => (
              <label
                key={kw}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={scoutSuggestSelected.has(kw)}
                  onCheckedChange={(checked) => {
                    const next = new Set(scoutSuggestSelected)
                    if (checked) next.add(kw)
                    else next.delete(kw)
                    setScoutSuggestSelected(next)
                  }}
                />
                <span className="text-sm">{kw}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSuggestionsDialog(false)}>
              {t("keywords.cancel")}
            </Button>
            <Button
              disabled={scoutSuggestSelected.size === 0}
              onClick={async () => {
                const toAdd = [...scoutSuggestSelected].filter(kw => !keywords.includes(kw))
                if (toAdd.length === 0) {
                  toast.info(t("discover.keywordsAlreadySaved"))
                  setShowSuggestionsDialog(false)
                  return
                }
                try {
                  const { error } = await supabase.from("keywords").insert(
                    toAdd.map(kw => ({ campaign_id: campaign.id, keyword: kw, source: "ai" }))
                  )
                  if (error) throw error
                  queryClient.invalidateQueries({ queryKey: ["campaign-keywords", campaign.id] })
                  // Also select them for scouting
                  setScoutKeywords(prev => new Set([...prev, ...toAdd]))
                  toast.success(t("discover.keywordsAdded", { count: toAdd.length }))
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("keywords.addFailed"))
                }
                setShowSuggestionsDialog(false)
              }}
            >
              {t("keywords.addCount", { count: scoutSuggestSelected.size })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
