/** Validated public env for the SPA. */

/**
 * Supabase client public key: prefer new publishable key (`sb_publishable_…`);
 * fall back to legacy JWT anon key during migration. Same second argument to `createClient`.
 * @see https://supabase.com/docs/guides/api/api-keys
 */
export function getSupabaseEnv(): { url: string; publicKey: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim()
  const publishable = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim()
  const anonLegacy = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim()
  const publicKey = publishable || anonLegacy
  if (!url || !publicKey) {
    if (import.meta.env.MODE === "production") {
      console.warn(
        "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (or legacy VITE_SUPABASE_ANON_KEY) missing — configure before deploy (see .env.example at repo root)",
      )
      return {
        url: "https://placeholder.supabase.co",
        publicKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid",
      }
    }
    throw new Error(
      "Missing VITE_SUPABASE_URL and a client key — set VITE_SUPABASE_PUBLISHABLE_KEY (recommended) or VITE_SUPABASE_ANON_KEY (legacy). Copy .env.example → .env at repo root.",
    )
  }
  return { url, publicKey }
}
