import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

// Capture the URL hash at module load — before Supabase JS auto-clears it.
// Invite links arrive as: #access_token=xxx&type=invite
// Recovery links arrive as: #access_token=xxx&type=recovery
const _initialHash = window.location.hash
const _initialAuthType = (() => {
  if (!_initialHash) return null
  const params = new URLSearchParams(_initialHash.substring(1))
  return params.get('type')
})()

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsPasswordSet, setNeedsPasswordSet] = useState(
    _initialAuthType === 'invite' || _initialAuthType === 'recovery'
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
        // Also catch password recovery triggered via forgot-password flow
        if (event === 'PASSWORD_RECOVERY') {
          setNeedsPasswordSet(true)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    // Immediately set user from the response — don't rely solely on onAuthStateChange
    // which can have a slight delay causing flicker
    if (data.session) {
      setSession(data.session)
      setUser(data.session.user)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return { user, session, loading, signIn, signOut, needsPasswordSet }
}
