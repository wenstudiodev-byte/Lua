import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// Null jika env belum di-set; UI akan menampilkan panduan konfigurasi.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

// Mode obfuscate server-side (anti-bypass). Aktif jika VITE_SERVER_OBFUSCATE=1.
export const SERVER_OBFUSCATE = import.meta.env.VITE_SERVER_OBFUSCATE === "1"

// Tarif token: 1 token per 1000 karakter, minimal 1. (Harus sama dgn SQL.)
export const CHARS_PER_TOKEN = 1000

export function tokenCostForChars(chars: number): number {
  if (!chars || chars < 0) return 1
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN))
}
