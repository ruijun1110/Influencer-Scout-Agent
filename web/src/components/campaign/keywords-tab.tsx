import { useEffect, useState, useCallback, type FormEvent } from "react"
import { useOutletContext } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useQueryClient } from "@tanstack/react-query"
import { invalidateCampaignData } from "@/lib/invalidation"
import { apiCall } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  PlusIcon,
  SparklesIcon,
  TrashIcon,
} from "lucide-react"

interface Campaign {
  id: string
  persona: string | null
}

interface Keyword {
  id: string
  keyword: string
  source: "manual" | "ai"
  created_at: string
}

export default function KeywordsTab() {
  const { campaign } = useOutletContext<{ campaign: Campaign }>()
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyword, setNewKeyword] = useState("")
  const [generating, setGenerating] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set())
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [sortOrder, setSortOrder] = useState<"newest" | "alpha">("newest")
  const fetchKeywords = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from("keywords")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })

      if (error) {
        toast.error(error.message)
        setKeywords([])
      } else {
        setKeywords((data as Keyword[]) ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [campaign.id])

  useEffect(() => {
    fetchKeywords()
  }, [fetchKeywords])

  async function addKeyword(e: FormEvent) {
    e.preventDefault()
    const raw = newKeyword.trim()
    if (!raw) return

    // Parse multiple keywords: comma/Chinese comma, or #hashtag separated
    let parsed: string[]
    if (raw.includes(",") || raw.includes("，")) {
      parsed = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    } else if (raw.includes("#")) {
      parsed = raw.split("#").map(s => s.trim()).filter(Boolean)
    } else {
      parsed = [raw]
    }

    // Dedupe against existing
    const existing = new Set(keywords.map(k => k.keyword))
    const toAdd = parsed.filter(kw => !existing.has(kw))
    if (toAdd.length === 0) return

    // Optimistic: add to local state
    const optimistics: Keyword[] = toAdd.map((kw, i) => ({
      id: `temp-${Date.now()}-${i}`,
      keyword: kw,
      source: "manual" as const,
      created_at: new Date().toISOString(),
    }))
    setKeywords((prev) => [...optimistics, ...prev])
    setNewKeyword("")

    try {
      const { error } = await supabase.from("keywords").insert(
        toAdd.map(kw => ({ campaign_id: campaign.id, keyword: kw, source: "manual" }))
      )
      if (error) throw error
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("keywords.addFailed"))
      // Rollback optimistic
      const tempIds = new Set(optimistics.map(o => o.id))
      setKeywords((prev) => prev.filter(k => !tempIds.has(k.id)))
      return
    }
    invalidateCampaignData(queryClient, campaign.id, ["keywords"])
  }

  async function generateKeywords() {
    if (!campaign.persona) return
    setGenerating(true)

    try {
      const existing = keywords.map((k) => k.keyword)
      const { keywords: generated } = await apiCall("/api/keywords/generate", {
        method: "POST",
        body: JSON.stringify({
          persona: campaign.persona,
          existing_keywords: existing,
        }),
      })

      setSuggestions(generated)
      setSelectedSuggestions(new Set(generated))
      setShowSuggestions(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("keywords.generateFailed"))
    } finally {
      setGenerating(false)
    }
  }

  async function addSelectedSuggestions() {
    const toAdd = Array.from(selectedSuggestions)
    if (toAdd.length === 0) return

    // Optimistic: add all to local state
    const optimisticEntries = toAdd.map((kw, i) => ({
      id: `temp-${Date.now()}-${i}`,
      keyword: kw,
      source: "ai" as const,
      created_at: new Date().toISOString(),
    }))
    setKeywords((prev) => [...optimisticEntries, ...prev])

    setShowSuggestions(false)
    setSuggestions([])
    setSelectedSuggestions(new Set())

    try {
      const { error } = await supabase.from("keywords").insert(
        toAdd.map((kw) => ({
          campaign_id: campaign.id,
          keyword: kw,
          source: "ai" as const,
        }))
      )
      if (error) throw error
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("keywords.addFailed"))
    }
    invalidateCampaignData(queryClient, campaign.id, ["keywords"])
  }

  async function deleteKeyword(kw: Keyword) {
    // Optimistic: remove from local state immediately
    setKeywords((prev) => prev.filter((k) => k.id !== kw.id))
    try {
      const { error } = await supabase.from("keywords").delete().eq("id", kw.id)
      if (error) throw error
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("keywords.deleteFailed"))
    }
    invalidateCampaignData(queryClient, campaign.id, ["keywords"])
  }

  const sortedKeywords = [...keywords].sort((a, b) => {
    if (sortOrder === "alpha") return a.keyword.localeCompare(b.keyword)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={addKeyword} className="flex items-center gap-2">
          <Input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder={t("discover.keywordInputPlaceholder")}
            className="w-64 h-9"
          />
          <Button type="submit" variant="outline" className="h-9">
            <PlusIcon data-icon />
            {t("keywords.add")}
          </Button>
        </form>

        <div className="relative group">
          <Button
            variant="outline"
            className="h-9"
            onClick={generateKeywords}
            disabled={generating || !campaign.persona}
          >
            {generating ? (
              <Spinner />
            ) : (
              <SparklesIcon data-icon />
            )}
            {t("keywords.generateAI")}
          </Button>
          {!campaign.persona && (
            <div className="absolute -bottom-8 left-0 hidden group-hover:block text-xs text-muted-foreground bg-popover border rounded px-2 py-1 shadow-sm whitespace-nowrap z-10">
              {t("keywords.personaRequired")}
            </div>
          )}
        </div>

        <Select value={sortOrder} onValueChange={(v) => { if (v) setSortOrder(v as "newest" | "alpha") }}>
          <SelectTrigger className="w-32 h-9">
            <span className="truncate">
              {sortOrder === "newest" ? t("keywords.sortNewest") : t("keywords.sortAlpha")}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("keywords.sortNewest")}</SelectItem>
            <SelectItem value="alpha">{t("keywords.sortAlpha")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : keywords.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("keywords.noKeywords")}</EmptyTitle>
            <EmptyDescription>{t("keywords.noKeywordsDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">{t("keywords.keyword")}</TableHead>
              <TableHead>{t("keywords.source")}</TableHead>
              <TableHead className="text-right">{t("keywords.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedKeywords.map((kw) => (
              <TableRow key={kw.id}>
                <TableCell className="font-medium py-3">{kw.keyword}</TableCell>
                <TableCell className="text-xs text-muted-foreground py-3">{kw.source}</TableCell>
                <TableCell className="text-right py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteKeyword(kw)}
                      title={t("keywords.delete")}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showSuggestions} onOpenChange={setShowSuggestions}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("keywords.suggestionsTitle")}</DialogTitle>
            <DialogDescription>
              {t("keywords.suggestionsDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {suggestions.map((kw) => (
              <label
                key={kw}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selectedSuggestions.has(kw)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedSuggestions)
                    if (checked) next.add(kw)
                    else next.delete(kw)
                    setSelectedSuggestions(next)
                  }}
                />
                <span className="text-sm">{kw}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSuggestions(false)}>
              {t("keywords.cancel")}
            </Button>
            <Button onClick={addSelectedSuggestions}>
              {t("keywords.addCount", { count: selectedSuggestions.size })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
