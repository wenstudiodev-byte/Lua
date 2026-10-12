import type { Session, User } from "@supabase/supabase-js"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { supabase } from "@/lib/supabaseClient"

export type Profile = {
  id: string
  email: string | null
  role: "user" | "admin"
  tokens: number
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null; needsConfirm: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  setTokens: (tokens: number) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, role, tokens")
      .eq("id", uid)
      .single()
    if (!error && data) {
      setProfile(data as Profile)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const uid = session?.user?.id
    if (uid) await loadProfile(uid)
  }, [session?.user?.id, loadProfile])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user?.id) {
        void loadProfile(data.session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession?.user?.id) {
        void loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string) => {
    if (!supabase) return { error: "Supabase belum dikonfigurasi." }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    return { error: error ? error.message : null }
  }, [])

  const signUp = useCallback(async (email: string, password: string, captchaToken?: string) => {
    if (!supabase) return { error: "Supabase belum dikonfigurasi.", needsConfirm: false }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (error) return { error: error.message, needsConfirm: false }
    // Jika email confirmation aktif, session null sampai user verifikasi email.
    const needsConfirm = !data.session
    return { error: null, needsConfirm }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const setTokens = useCallback((tokens: number) => {
    setProfile((p) => (p ? { ...p, tokens } : p))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      isAdmin: profile?.role === "admin",
      signIn,
      signUp,
      signOut,
      refreshProfile,
      setTokens,
    }),
    [session, profile, loading, signIn, signUp, signOut, refreshProfile, setTokens],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
