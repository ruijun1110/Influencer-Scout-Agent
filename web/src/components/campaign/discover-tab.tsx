import { useState, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { formatNumber } from "@/lib/utils"
import { apiCall } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { MOCK_CREATORS, MOCK_KEYWORDS, MOCK_BATCHES, MOCK_PRESETS } from "@/lib/mock-data"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { ExternalLinkIcon, MailIcon, UsersIcon, CheckIcon, XIcon, SparklesIcon } from "lucide-react"

import { CreatorCard, type CreatorWithStatus } from "./discover/creator-card"
import { CreatorTable } from "./discover/creator-table"
import { DiscoverFilterBar } from "./discover/filter-bar"

interface Campaign {
  id: string
  name: string
  persona: string | null
}

export default function DiscoverTab({ campaign }: { campaign: Campaign }) {
  const { t } = useLanguage()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<string>("all")
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

  // Scout dialog state
  const [showScoutDialog, setShowScoutDialog] = useState(false)
  const [scoutSourceType, setScoutSourceType] = useState<"keyword_creator" | "keyword_video" | "similar">("keyword_creator")
  const [scoutKeywords, setScoutKeywords] = useState<Set<string>>(new Set())
  const [scoutCountry, setScoutCountry] = useState("US")

  const [scoutMaxResults, setScoutMaxResults] = useState(20)
  const [scoutHandle, setScoutHandle] = useState("")
  const [scoutPreset, setScoutPreset] = useState("none")
  const [scoutSuggestions, setScoutSuggestions] = useState<string[]>([])
  const [scoutGenerating, setScoutGenerating] = useState(false)
  const [scoutRunning, setScoutRunning] = useState(false)
  const [showInlinePreset, setShowInlinePreset] = useState(false)
  const [inlinePresetName, setInlinePresetName] = useState("")
  const [inlinePresetFilters, setInlinePresetFilters] = useState<Record<string, any>>({})

  // 1. Fetch Keywords for Filter
  const { data: keywords = [] } = useQuery({
    queryKey: ["campaign-keywords", campaign.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("keywords")
        .select("keyword")
        .eq("campaign_id", campaign.id)
      const keywords = data?.map((k) => k.keyword) || []
      return keywords.length > 0 ? keywords : MOCK_KEYWORDS.map((k) => k.keyword)
    }
  })

  // 2. Fetch Batches
  const { data: batches = [] } = useQuery({
    queryKey: ["scout-batches", campaign.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("scout_batches")
        .select("id, source_type, source_params, created_at")
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })
      return data || MOCK_BATCHES
    }
  })

  // 3. Fetch Presets
  const { data: presets = [] } = useQuery({
    queryKey: ["scout-presets", campaign.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("scout_presets")
        .select("id, name, is_default, filters")
        .eq("campaign_id", campaign.id)
        .order("created_at")
      return data || MOCK_PRESETS
    }
  })

  // 4. Fetch Creators
  const { data: creators = [], isLoading } = useQuery({
    queryKey: ["campaign-creators", campaign.id, statusFilter, sortBy, batchFilter, keywordFilter],
    queryFn: async () => {
      let query = supabase
        .from("campaign_creators")
        .select(`
          id, status, source_type, source_keyword, source_handle, batch_id,
          creator:creators(id, handle, profile_url, cover_url, followers, avg_views, bio, bio_link, emails, tier,
            nickname, country_code, total_likes, video_count, following_count, verified, engagement_rate, median_views, tcm_id, tcm_link)
        `)
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })

      if (statusFilter !== "all") query = query.eq("status", statusFilter)

      const { data } = await query
      if (!data || data.length === 0) return MOCK_CREATORS

      const mapped = data.filter((d) => d.creator).map((d) => {
        const c = d.creator as unknown as Record<string, unknown>
        return {
          id: c.id as string,
          campaign_creator_id: d.id as string,
          handle: c.handle as string,
          profile_url: c.profile_url as string,
          cover_url: c.cover_url as string,
          followers: c.followers as number,
          avg_views: c.avg_views as number,
          bio: c.bio as string,
          bio_link: c.bio_link as string | null,
          emails: (c.emails as string[]) || [],
          tier: c.tier,
          status: d.status,
          source_type: d.source_type,
          source_keyword: d.source_keyword,
          source_handle: d.source_handle as string | null ?? null,
          batch_id: d.batch_id,
          nickname: c.nickname as string | null,
          country_code: c.country_code as string | null,
          total_likes: c.total_likes as number,
          video_count: c.video_count as number,
          following_count: c.following_count as number,
          verified: c.verified as boolean,
          engagement_rate: c.engagement_rate as number,
          median_views: c.median_views as number,
          tcm_id: c.tcm_id as string | null,
          tcm_link: c.tcm_link as string | null,
        } as CreatorWithStatus
      })

      if (mapped.length === 0) return MOCK_CREATORS
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

    // Preset filter (only if not "show all")
    if (presetFilter !== "all" && !showAll) {
      const preset = presets.find(p => p.id === presetFilter)
      if (preset?.filters) {
        const f = preset.filters as Record<string, any>
        result = result.filter(c => {
          if (f.followers?.min != null && c.followers < f.followers.min) return false
          if (f.followers?.max != null && c.followers > f.followers.max) return false
          if (f.avg_views?.min != null && c.avg_views < f.avg_views.min) return false
          if (f.avg_views?.max != null && c.avg_views > f.avg_views.max) return false
          if (f.engagement_rate?.min != null && c.engagement_rate < f.engagement_rate.min) return false
          if (f.engagement_rate?.max != null && c.engagement_rate > f.engagement_rate.max) return false
          if (f.total_likes?.min != null && c.total_likes < f.total_likes.min) return false
          if (f.total_likes?.max != null && c.total_likes > f.total_likes.max) return false
          if (f.video_count?.min != null && c.video_count < f.video_count.min) return false
          if (f.video_count?.max != null && c.video_count > f.video_count.max) return false
          if (f.has_email === true && c.emails.length === 0) return false
          if (f.has_email === false && c.emails.length > 0) return false
          return true
        })
      }
    }

    // Sort
    if (sortBy === "followers") {
      result.sort((a, b) => b.followers - a.followers)
    } else if (sortBy === "avg_views") {
      result.sort((a, b) => b.avg_views - a.avg_views)
    }
    // "newest" = default order from query (created_at desc)

    return result
  }, [creators, statusFilter, batchFilter, keywordFilter, presetFilter, showAll, presets, sortBy])

  // Preset match set for dimming non-matching cards when showAll is on
  const presetMatchSet = useMemo(() => {
    if (presetFilter === "all" || !showAll) return null
    const preset = presets.find(p => p.id === presetFilter)
    if (!preset?.filters) return null
    const f = preset.filters as Record<string, any>
    const matching = new Set<string>()
    for (const c of creators) {
      let match = true
      if (f.followers?.min != null && c.followers < f.followers.min) match = false
      if (f.followers?.max != null && c.followers > f.followers.max) match = false
      if (f.avg_views?.min != null && c.avg_views < f.avg_views.min) match = false
      if (f.avg_views?.max != null && c.avg_views > f.avg_views.max) match = false
      if (f.engagement_rate?.min != null && c.engagement_rate < f.engagement_rate.min) match = false
      if (f.engagement_rate?.max != null && c.engagement_rate > f.engagement_rate.max) match = false
      if (f.has_email === true && c.emails.length === 0) match = false
      if (match) matching.add(c.campaign_creator_id)
    }
    return matching
  }, [creators, presets, presetFilter, showAll])

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
    mutationFn: async (creatorId: string) => {
      await apiCall("/api/scout/similar", {
        method: "POST",
        body: JSON.stringify({ campaign_id: campaign.id, creator_id: creatorId }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-creators", campaign.id] })
    }
  })

  function handleUpdateStatus(creator: CreatorWithStatus, status: "approved" | "rejected") {
    updateStatusMutation.mutate({ id: creator.campaign_creator_id, status })
    if (selectedCreator?.campaign_creator_id === creator.campaign_creator_id) {
       setSelectedCreator({ ...creator, status })
    }
  }

  function handleFindSimilar(creator: CreatorWithStatus) {
    findSimilarMutation.mutate(creator.id)
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
        onOpenScout={() => setShowScoutDialog(true)}
      />

      {isLoading ? (
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
                className={presetMatchSet && !presetMatchSet.has(creator.campaign_creator_id) ? "opacity-40 grayscale" : ""}
              >
                <CreatorCard
                  creator={creator}
                  onSelect={setSelectedCreator}
                  onUpdateStatus={handleUpdateStatus}
                  onFindSimilar={handleFindSimilar}
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
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-4 px-4">
                {selectedCreator.cover_url && (
                  <img
                    src={selectedCreator.cover_url}
                    alt=""
                    className="w-full rounded-lg"
                  />
                )}

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

                {selectedCreator.emails.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("discover.emails")}</p>
                    {selectedCreator.emails.map((email) => (
                      <div key={email} className="flex items-center gap-2 text-sm">
                        <MailIcon className="size-3 text-muted-foreground" />
                        {email}
                      </div>
                    ))}
                  </div>
                )}

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

                <div className="flex gap-2 pt-2">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("discover.scoutTitle")}</DialogTitle>
            <DialogDescription>
              {t("discover.scoutDesc")}
            </DialogDescription>
          </DialogHeader>

          {/* Source type */}
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("discover.sourceType")}</FieldLabel>
              <div className="flex gap-2">
                {(["keyword_creator", "keyword_video", "similar"] as const).map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={scoutSourceType === type ? "default" : "outline"}
                    onClick={() => setScoutSourceType(type)}
                    type="button"
                  >
                    {type === "keyword_creator" ? t("discover.sourceCreator")
                      : type === "keyword_video" ? t("discover.sourceVideo")
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
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start mt-1"
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
                        setScoutKeywords(new Set(generated))
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

                  {scoutSuggestions.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      {scoutSuggestions.map((kw) => (
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
                  )}
                </Field>

                <div className="grid gap-4 grid-cols-2">
                  <Field>
                    <FieldLabel>{t("discover.country")}</FieldLabel>
                    <Select value={scoutCountry} onValueChange={(v) => { if (v) setScoutCountry(v) }}>
                      <SelectTrigger>
                        <span className="truncate">{scoutCountry || t("discover.selectCountry")}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">US</SelectItem>
                        <SelectItem value="JP">JP</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>{t("discover.maxResults")}</FieldLabel>
                    <Input
                      type="number"
                      value={scoutMaxResults}
                      onChange={(e) => setScoutMaxResults(Number(e.target.value))}
                      min={1}
                      max={100}
                    />
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

            {/* Preset */}
            <Field>
              <FieldLabel>{t("discover.preset")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Select value={scoutPreset} onValueChange={(v) => {
                  if (v === "__new__") {
                    setShowInlinePreset(true)
                    setScoutPreset("none")
                  } else {
                    if (v) setScoutPreset(v)
                    setShowInlinePreset(false)
                  }
                }}>
                  <SelectTrigger className="w-48">
                    <span className="truncate">
                      {scoutPreset === "none" ? t("discover.noPreset") : presets.find(p => p.id === scoutPreset)?.name || scoutPreset}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("discover.noPreset")}</SelectItem>
                    {presets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                    <SelectItem value="__new__">{t("discover.newPreset")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {showInlinePreset && (
                <div className="rounded-md border p-3 mt-2 flex flex-col gap-3">
                  <Field>
                    <FieldLabel>{t("settings.presetName")}</FieldLabel>
                    <Input
                      value={inlinePresetName}
                      onChange={(e) => setInlinePresetName(e.target.value)}
                      placeholder={t("settings.presetName")}
                      className="h-8 text-sm"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.followers")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder={t("settings.min")}
                          value={inlinePresetFilters.followers?.min ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            followers: { ...f.followers, min: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          placeholder={t("settings.max")}
                          value={inlinePresetFilters.followers?.max ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            followers: { ...f.followers, max: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.avgViews")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder={t("settings.min")}
                          value={inlinePresetFilters.avg_views?.min ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            avg_views: { ...f.avg_views, min: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          placeholder={t("settings.max")}
                          value={inlinePresetFilters.avg_views?.max ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            avg_views: { ...f.avg_views, max: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.engagementRate")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder={t("settings.min")}
                          value={inlinePresetFilters.engagement_rate?.min != null ? inlinePresetFilters.engagement_rate.min * 100 : ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            engagement_rate: { ...f.engagement_rate, min: e.target.value ? Number(e.target.value) / 100 : null },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.totalLikes")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder={t("settings.min")}
                          value={inlinePresetFilters.total_likes?.min ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            total_likes: { ...f.total_likes, min: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          placeholder={t("settings.max")}
                          value={inlinePresetFilters.total_likes?.max ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            total_likes: { ...f.total_likes, max: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.videoCount")}</FieldLabel>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder={t("settings.min")}
                          value={inlinePresetFilters.video_count?.min ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            video_count: { ...f.video_count, min: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">-</span>
                        <Input
                          type="number"
                          placeholder={t("settings.max")}
                          value={inlinePresetFilters.video_count?.max ?? ""}
                          onChange={(e) => setInlinePresetFilters(f => ({
                            ...f,
                            video_count: { ...f.video_count, max: e.target.value ? Number(e.target.value) : null },
                          }))}
                          className="h-7 text-xs"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel className="text-xs">{t("settings.hasEmail")}</FieldLabel>
                      <Select
                        value={inlinePresetFilters.has_email === true ? "yes" : inlinePresetFilters.has_email === false ? "no" : "any"}
                        onValueChange={(v) => setInlinePresetFilters(f => ({
                          ...f,
                          has_email: v === "yes" ? true : v === "no" ? false : null,
                        }))}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <span className="truncate">
                            {inlinePresetFilters.has_email === true ? t("settings.yes")
                              : inlinePresetFilters.has_email === false ? t("settings.no")
                              : t("settings.any")}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">{t("settings.any")}</SelectItem>
                          <SelectItem value="yes">{t("settings.yes")}</SelectItem>
                          <SelectItem value="no">{t("settings.no")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      type="button"
                      onClick={() => {
                        setShowInlinePreset(false)
                        setInlinePresetName("")
                        setInlinePresetFilters({})
                      }}
                    >
                      {t("keywords.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      type="button"
                      disabled={!inlinePresetName.trim()}
                      onClick={async () => {
                        const { data } = await supabase.from("scout_presets").insert({
                          campaign_id: campaign.id,
                          name: inlinePresetName.trim(),
                          is_default: false,
                          filters: inlinePresetFilters,
                        }).select("id").single()
                        if (data) {
                          setScoutPreset(data.id)
                          queryClient.invalidateQueries({ queryKey: ["scout-presets", campaign.id] })
                        }
                        setShowInlinePreset(false)
                        setInlinePresetName("")
                        setInlinePresetFilters({})
                      }}
                    >
                      {t("discover.add")}
                    </Button>
                  </div>
                </div>
              )}
            </Field>
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
                  await apiCall("/api/scout/run", {
                    method: "POST",
                    body: JSON.stringify({
                      campaign_id: campaign.id,
                      source_type: scoutSourceType,
                      ...(scoutSourceType !== "similar"
                        ? {
                            keywords: Array.from(scoutKeywords),
                            country: scoutCountry,
                            max_results: scoutMaxResults,
                          }
                        : {
                            handle: scoutHandle.trim(),
                          }),
                      preset_id: scoutPreset !== "none" ? scoutPreset : undefined,
                    }),
                  })
                  setShowScoutDialog(false)
                  setScoutKeywords(new Set())
                  setScoutSuggestions([])
                  setScoutHandle("")
                  queryClient.invalidateQueries({ queryKey: ["campaign-creators", campaign.id] })
                  queryClient.invalidateQueries({ queryKey: ["scout-batches", campaign.id] })
                } catch {
                  // error handled by apiCall
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
    </div>
  )
}
