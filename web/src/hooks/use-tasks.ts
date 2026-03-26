import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useLanguage } from "@/lib/i18n"
import { toast } from "sonner"

export interface BatchTask {
  id: string
  campaign_id: string
  batch_id: string | null
  source_type: string
  source_params: Record<string, unknown>
  preset_snapshot: Record<string, unknown> | null
  creator_count: number
  batch_created_at: string
  task_id: string | null
  task_status: "queued" | "running" | "completed" | "failed" | "partial"
  task_progress: number
  task_total: number
  task_error: string | null
  task_meta: Record<string, unknown> | null
  /**
   * For similar + creator_id: `creators.handle` (same join as Discover cards).
   * undefined = not loaded yet; null = no row; string = handle.
   */
  seed_creator_handle?: string | null
  batch_name: string | null
}

const POLL_MS = 5000

type TasksContextValue = {
  batches: BatchTask[]
  activeBatches: BatchTask[]
  refetch: () => Promise<void>
}

const TasksContext = createContext<TasksContextValue | null>(null)

function useTasksState(): TasksContextValue {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [batches, setBatches] = useState<BatchTask[]>([])
  // Track which task IDs we've already shown a completion toast for (prevents duplicates)
  const toastedRef = useRef<Set<string>>(new Set())

  const upsertBatch = useCallback((taskPayload: Record<string, unknown>) => {
    const taskId = taskPayload.id as string
    const newStatus = taskPayload.status as string | undefined

    setBatches((prev) => {
      const idx = prev.findIndex((b) => b.task_id === taskId)
      if (idx >= 0) {
        const next = [...prev]
        const cid = (taskPayload.campaign_id as string) ?? next[idx].campaign_id
        const prevRow = next[idx]
        const prevStatus = prevRow.task_status
        const resolvedStatus = (newStatus as BatchTask["task_status"]) ?? prevStatus

        // Fire toast ONLY if status actually changed and we haven't toasted this transition
        const toastKey = `${taskId}:${resolvedStatus}`
        if (prevStatus !== resolvedStatus && !toastedRef.current.has(toastKey)) {
          toastedRef.current.add(toastKey)
          // Schedule toast outside the state updater
          queueMicrotask(() => {
            if (resolvedStatus === "completed") {
              const count = ((taskPayload.meta as Record<string, unknown>)?.result_count as number) ?? prevRow.creator_count
              toast.success(t("tasks.scoutCompleted", { count }), {
                duration: Infinity,
                action: { label: "OK", onClick: () => {} },
              })
            } else if (resolvedStatus === "failed") {
              const errMsg = (taskPayload.error as string) || (taskPayload.meta as Record<string, unknown>)?.error as string || ""
              toast.error(errMsg ? `${t("tasks.taskFailed")}: ${errMsg}` : t("tasks.taskFailed"))
            } else if (resolvedStatus === "partial") {
              const count = ((taskPayload.meta as Record<string, unknown>)?.result_count as number) ?? prevRow.creator_count
              toast.warning(t("tasks.scoutPartial", { count }), {
                duration: Infinity,
                action: { label: "OK", onClick: () => {} },
              })
            }
          })
        }

        next[idx] = {
          ...prevRow,
          campaign_id: cid,
          task_status: resolvedStatus,
          task_progress:
            (taskPayload.progress as number) ?? prevRow.task_progress,
          task_total: (taskPayload.total as number) ?? prevRow.task_total,
          task_error:
            (taskPayload.error as string | null | undefined) ?? prevRow.task_error ?? null,
          task_meta:
            (taskPayload.meta as Record<string, unknown>) ?? prevRow.task_meta,
          creator_count:
            ((taskPayload.meta as Record<string, unknown>)?.result_count as number) ??
            prevRow.creator_count,
          seed_creator_handle: prevRow.seed_creator_handle,
          batch_name: prevRow.batch_name,
        }
        return next
      }
      const meta = (taskPayload.meta as Record<string, unknown>) ?? {}
      const campaignId = (taskPayload.campaign_id as string) ?? ""
      return [
        {
          id: taskId,
          campaign_id: campaignId,
          batch_id: null,
          source_type: (meta.source_type as string) ?? "scout",
          source_params: (meta.source_params as Record<string, unknown>) ?? {},
          preset_snapshot: null,
          creator_count: 0,
          batch_created_at:
            (taskPayload.created_at as string) ?? new Date().toISOString(),
          task_id: taskId,
          task_status:
            (taskPayload.status as BatchTask["task_status"]) ?? "queued",
          task_progress: (taskPayload.progress as number) ?? 0,
          task_total: (taskPayload.total as number) ?? 0,
          task_error: (taskPayload.error as string | null | undefined) ?? null,
          task_meta: meta,
          batch_name: null,
        },
        ...prev,
      ]
    })
  }, [])

  const fetchBatches = useCallback(async () => {
    if (!user) return

    const { data: batchData, error } = await supabase
      .from("scout_batches")
      .select(
        "id, campaign_id, source_type, source_params, preset_snapshot, creator_count, created_at, task_id, name"
      )
      .order("created_at", { ascending: false })
      .limit(50)
      .is("dismissed_at", null)

    if (error || !batchData?.length) {
      setBatches([])
      return
    }

    const taskIds = batchData.map((b) => b.task_id).filter(Boolean) as string[]
    let taskMap: Record<string, Record<string, unknown>> = {}
    if (taskIds.length > 0) {
      const { data: taskData, error: taskErr } = await supabase
        .from("tasks")
        .select("id, status, progress, total, error, meta, campaign_id")
        .in("id", taskIds)
      if (taskErr) {
        console.warn("[useTasks] tasks select failed:", taskErr.message)
      }
      if (taskData) {
        taskMap = Object.fromEntries(taskData.map((t) => [t.id, t]))
      }
    }

    const merged: BatchTask[] = batchData.map((b) => {
      const t = b.task_id ? taskMap[b.task_id] : null
      return {
        id: b.id,
        campaign_id: b.campaign_id as string,
        batch_id: b.id,
        source_type: b.source_type,
        source_params: (b.source_params as Record<string, unknown>) ?? {},
        preset_snapshot: b.preset_snapshot as Record<string, unknown> | null,
        creator_count: b.creator_count,
        batch_created_at: b.created_at,
        task_id: b.task_id,
        task_status:
          (t?.status as BatchTask["task_status"]) ??
          (b.task_id ? "queued" : "completed"),
        task_progress: (t?.progress as number) ?? 0,
        task_total: (t?.total as number) ?? 0,
        task_error: (t?.error as string) ?? null,
        task_meta: (t?.meta as Record<string, unknown>) ?? null,
        batch_name: (b as Record<string, unknown>).name as string ?? null,
      }
    })

    const similarCreatorIds = [
      ...new Set(
        merged
          .filter((b) => b.source_type === "similar")
          .map((b) => String(b.source_params.creator_id ?? "").trim())
          .filter(Boolean),
      ),
    ]

    let handleByCreatorId: Record<string, string> = {}
    if (similarCreatorIds.length > 0) {
      const { data: creatorRows } = await supabase
        .from("creators")
        .select("id, handle")
        .in("id", similarCreatorIds)
      if (creatorRows) {
        handleByCreatorId = Object.fromEntries(
          creatorRows.map((r) => [r.id as string, String(r.handle ?? "").trim()]),
        )
      }
    }

    const withSeedHandles: BatchTask[] = merged.map((b) => {
      if (b.source_type !== "similar") return b
      const cid = String(b.source_params.creator_id ?? "").trim()
      if (!cid) return b
      const h = handleByCreatorId[cid]
      return {
        ...b,
        seed_creator_handle: h !== undefined && h !== "" ? h : null,
      }
    })

    setBatches(withSeedHandles)
  }, [user])

  useEffect(() => {
    if (!user) return
    const todo = batches.filter(
      (b) =>
        b.source_type === "similar" &&
        String(b.source_params.creator_id ?? "").trim() !== "" &&
        b.seed_creator_handle === undefined,
    )
    if (todo.length === 0) return
    const ids = [
      ...new Set(todo.map((b) => String(b.source_params.creator_id ?? "").trim())),
    ]
    let cancelled = false
    void (async () => {
      const { data } = await supabase.from("creators").select("id, handle").in("id", ids)
      if (cancelled) return
      const map = Object.fromEntries(
        (data ?? []).map((r) => [r.id as string, String(r.handle ?? "").trim()]),
      )
      setBatches((prev) =>
        prev.map((b) => {
          if (b.source_type !== "similar" || b.seed_creator_handle !== undefined) return b
          const cid = String(b.source_params.creator_id ?? "").trim()
          if (!cid) return b
          const h = map[cid]
          return {
            ...b,
            seed_creator_handle: h && h !== "" ? h : null,
          }
        }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [user, batches])

  useEffect(() => {
    if (!user) {
      setBatches([])
      return
    }
    void fetchBatches()

    const channel = supabase
      .channel("tasks-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (payload.new && "id" in payload.new) upsertBatch(payload.new)
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (payload.new && "id" in payload.new) upsertBatch(payload.new)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user, fetchBatches, upsertBatch])

  const hasActive = useMemo(
    () =>
      batches.some(
        (b) => b.task_status === "running" || b.task_status === "queued"
      ),
    [batches]
  )

  useEffect(() => {
    if (!user || !hasActive) return
    const id = window.setInterval(() => {
      void fetchBatches()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [user, hasActive, fetchBatches])

  useEffect(() => {
    if (!user) return
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchBatches()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [user, fetchBatches])

  const activeBatches = useMemo(
    () =>
      batches.filter(
        (b) => b.task_status === "running" || b.task_status === "queued"
      ),
    [batches]
  )

  return {
    batches,
    activeBatches,
    refetch: fetchBatches,
  }
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const value = useTasksState()
  return createElement(TasksContext.Provider, { value }, children)
}

export function useTasks() {
  const ctx = useContext(TasksContext)
  if (!ctx) {
    throw new Error("useTasks must be used within TasksProvider")
  }
  return ctx
}
