import { useEffect, useState, useCallback, useMemo } from "react"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { MOCK_BATCHES, MOCK_TASKS } from "@/lib/mock-data"

export interface BatchTask {
  id: string
  batch_id: string | null
  source_type: string
  source_params: Record<string, unknown>
  preset_snapshot: Record<string, unknown> | null
  creator_count: number
  batch_created_at: string
  // Task fields
  task_id: string | null
  task_status: "queued" | "running" | "completed" | "failed" | "partial"
  task_progress: number
  task_total: number
  task_error: string | null
  task_meta: Record<string, unknown> | null
}

function mergeMockData(): BatchTask[] {
  return MOCK_BATCHES.map((b) => {
    const task = MOCK_TASKS.find((t) => t.id === b.task_id)
    return {
      id: b.id,
      batch_id: b.id,
      source_type: b.source_type,
      source_params: b.source_params,
      preset_snapshot: b.preset_snapshot,
      creator_count: b.creator_count,
      batch_created_at: b.created_at,
      task_id: b.task_id,
      task_status: task?.status ?? "completed",
      task_progress: task?.progress ?? 0,
      task_total: 0,
      task_error: null,
      task_meta: task?.meta ?? null,
    }
  })
}

export function useTasks() {
  const { user } = useAuth()
  const [batches, setBatches] = useState<BatchTask[]>(mergeMockData())

  const upsertBatch = useCallback((taskPayload: Record<string, unknown>) => {
    setBatches((prev) => {
      const taskId = taskPayload.id as string
      const idx = prev.findIndex((b) => b.task_id === taskId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          task_status: (taskPayload.status as BatchTask["task_status"]) ?? next[idx].task_status,
          task_progress: (taskPayload.progress as number) ?? next[idx].task_progress,
          task_total: (taskPayload.total as number) ?? next[idx].task_total,
          task_error: (taskPayload.error as string) ?? null,
          task_meta: (taskPayload.meta as Record<string, unknown>) ?? next[idx].task_meta,
          creator_count: ((taskPayload.meta as Record<string, unknown>)?.result_count as number) ?? next[idx].creator_count,
        }
        return next
      }
      // New task — create a placeholder batch entry
      const meta = (taskPayload.meta as Record<string, unknown>) ?? {}
      return [{
        id: taskId,
        batch_id: null,
        source_type: (meta.source_type as string) ?? "scout",
        source_params: (meta.source_params as Record<string, unknown>) ?? {},
        preset_snapshot: null,
        creator_count: 0,
        batch_created_at: (taskPayload.created_at as string) ?? new Date().toISOString(),
        task_id: taskId,
        task_status: (taskPayload.status as BatchTask["task_status"]) ?? "queued",
        task_progress: (taskPayload.progress as number) ?? 0,
        task_total: (taskPayload.total as number) ?? 0,
        task_error: null,
        task_meta: meta,
      }, ...prev]
    })
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function fetchBatches() {
      // Fetch batches with their task data
      const { data: batchData } = await supabase
        .from("scout_batches")
        .select("id, source_type, source_params, preset_snapshot, creator_count, created_at, task_id")
        .order("created_at", { ascending: false })
        .limit(50)

      if (cancelled || !batchData || batchData.length === 0) return

      // Fetch tasks for these batches
      const taskIds = batchData.map((b) => b.task_id).filter(Boolean)
      let taskMap: Record<string, Record<string, unknown>> = {}
      if (taskIds.length > 0) {
        const { data: taskData } = await supabase
          .from("tasks")
          .select("id, status, progress, total, error, meta")
          .in("id", taskIds)
        if (taskData) {
          taskMap = Object.fromEntries(taskData.map((t) => [t.id, t]))
        }
      }

      const merged: BatchTask[] = batchData.map((b) => {
        const t = b.task_id ? taskMap[b.task_id] : null
        return {
          id: b.id,
          batch_id: b.id,
          source_type: b.source_type,
          source_params: b.source_params ?? {},
          preset_snapshot: b.preset_snapshot,
          creator_count: b.creator_count,
          batch_created_at: b.created_at,
          task_id: b.task_id,
          task_status: (t?.status as BatchTask["task_status"]) ?? "completed",
          task_progress: (t?.progress as number) ?? 0,
          task_total: (t?.total as number) ?? 0,
          task_error: (t?.error as string) ?? null,
          task_meta: (t?.meta as Record<string, unknown>) ?? null,
        }
      })

      setBatches(merged)
    }

    void fetchBatches()

    // Listen for task updates
    const channel = supabase
      .channel("tasks-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (payload.new && "id" in payload.new) upsertBatch(payload.new)
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (payload.new && "id" in payload.new) upsertBatch(payload.new)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [user, upsertBatch])

  const activeBatches = useMemo(
    () => batches.filter((b) => b.task_status === "running" || b.task_status === "queued"),
    [batches]
  )

  return { batches, activeBatches }
}
