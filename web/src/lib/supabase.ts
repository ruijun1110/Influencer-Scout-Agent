import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from './env'

const { url, publicKey } = getSupabaseEnv()

export const supabase = createClient(url, publicKey)
