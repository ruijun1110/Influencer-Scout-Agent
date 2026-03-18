import { useEffect, useState, useCallback, type FormEvent } from "react"
import { supabase } from "@/lib/supabase"
import { apiCall } from "@/lib/api"
import { useLanguage } from "@/lib/i18n"
import { MOCK_KEYWORDS } from "@/lib/mock-data"
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

export default function KeywordsTab({ campaign }: { campaign: Campaign }) {
  const { t } = useLanguage()
  const [keywords, setKeywords] = useState<Keyword[]>(MOCK_KEYWORDS)
  const [loading, setLoading] = useState(false)
  const [newKeyword, setNewKeyword] = useState("")
  const [generating, setGenerating] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set())
  const [showSuggestions, setShowSuggestions] = useState(false)
  const fetchKeywords = useCallback(async () => {
    const { data } = await supabase
      .from("keywords")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })

    if (data && data.length > 0) setKeywords(data as Keyword[])
    setLoading(false)
  }, [campaign.id])

  useEffect(() => {
    fetchKeywords()
  }, [fetchKeywords])

  async function addKeyword(e: FormEvent) {
    e.preventDefault()
    if (!newKeyword.trim()) return

    await supabase.from("keywords").insert({
      campaign_id: campaign.id,
      keyword: newKeyword.trim(),
      source: "manual",
    })

    setNewKeyword("")
    fetchKeywords()
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
    } catch {
      // error handled by apiCall
    } finally {
      setGenerating(false)
    }
  }

  async function addSelectedSuggestions() {
    const toAdd = Array.from(selectedSuggestions)
    if (toAdd.length === 0) return

    await supabase.from("keywords").insert(
      toAdd.map((kw) => ({
        campaign_id: campaign.id,
        keyword: kw,
        source: "ai" as const,
      }))
    )

    setShowSuggestions(false)
    setSuggestions([])
    setSelectedSuggestions(new Set())
    fetchKeywords()
  }

  async function deleteKeyword(kw: Keyword) {
    await supabase.from("keywords").delete().eq("id", kw.id)
    fetchKeywords()
  }

  const sortedKeywords = [...keywords].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={addKeyword} className="flex gap-2">
          <Input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder={t("keywords.addPlaceholder")}
            className="w-48 h-9"
          />
          <Button type="submit" size="sm" variant="outline">
            <PlusIcon data-icon />
            {t("keywords.add")}
          </Button>
        </form>

        <Button
          size="sm"
          variant="outline"
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
              <TableHead>{t("keywords.added")}</TableHead>
              <TableHead className="text-right">{t("keywords.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedKeywords.map((kw) => (
              <TableRow key={kw.id}>
                <TableCell className="font-medium py-3">{kw.keyword}</TableCell>
                <TableCell className="text-xs text-muted-foreground py-3">{kw.source}</TableCell>
                <TableCell className="text-xs text-muted-foreground py-3">{formatDate(kw.created_at)}</TableCell>
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
