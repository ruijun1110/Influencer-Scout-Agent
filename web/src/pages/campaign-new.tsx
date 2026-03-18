import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription } from "@/components/ui/alert"

export default function CampaignNewPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState("")
  const [persona, setPersona] = useState("")
  const [minFollowers, setMinFollowers] = useState(0)
  const [minAvgViews, setMinAvgViews] = useState(0)
  const [recentVideoCount, setRecentVideoCount] = useState(10)
  const [maxResults, setMaxResults] = useState(20)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return

    setError(null)
    setSubmitting(true)

    const { data, error: insertError } = await supabase
      .from("campaigns")
      .insert({
        name,
        persona: persona || null,
        min_followers: minFollowers,
        min_avg_views: minAvgViews,
        recent_video_count: recentVideoCount,
        max_results_per_keyword: maxResults,
        owner_id: user.id,
      })
      .select("id")
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    navigate(`/campaign/${data.id}`, { replace: true })
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New Campaign</CardTitle>
          <CardDescription>
            Set up a new influencer scouting campaign
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Campaign Name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Beauty Q1 2026"
                  required
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="persona">Target Persona</FieldLabel>
                <Textarea
                  id="persona"
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Describe the type of creators you're looking for..."
                  rows={3}
                />
                <FieldDescription>
                  Used for AI keyword generation. Be specific about niche, audience, and content style.
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="minFollowers">Min Followers (soft)</FieldLabel>
                  <Input
                    id="minFollowers"
                    type="number"
                    min={0}
                    value={minFollowers}
                    onChange={(e) => setMinFollowers(Number(e.target.value))}
                  />
                  <FieldDescription>
                    Creators below this are hidden by default
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="minAvgViews">Min Avg Views (soft)</FieldLabel>
                  <Input
                    id="minAvgViews"
                    type="number"
                    min={0}
                    value={minAvgViews}
                    onChange={(e) => setMinAvgViews(Number(e.target.value))}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="recentVideoCount">Recent Videos to Check</FieldLabel>
                  <Input
                    id="recentVideoCount"
                    type="number"
                    min={1}
                    max={30}
                    value={recentVideoCount}
                    onChange={(e) => setRecentVideoCount(Number(e.target.value))}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="maxResults">Max Results per Keyword</FieldLabel>
                  <Input
                    id="maxResults"
                    type="number"
                    min={1}
                    max={50}
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                  />
                </Field>
              </div>

              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

              <div className="flex gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting && <Spinner />}
                  {submitting ? "Creating..." : "Create Campaign"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/")}
                >
                  Cancel
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
