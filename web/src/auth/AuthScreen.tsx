import { FileCode2, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { useAuth } from "@/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isSupabaseConfigured } from "@/lib/supabaseClient"
import { Turnstile, isCaptchaEnabled } from "@/components/Turnstile"

type Mode = "login" | "register"

export function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      toast.error("Isi email dan password.")
      return
    }
    if (password.length < 6) {
      toast.error("Password minimal 6 karakter.")
      return
    }
    if (isCaptchaEnabled && !captchaToken) {
      toast.error("Selesaikan verifikasi CAPTCHA dulu.")
      return
    }
    setBusy(true)
    try {
      if (mode === "login") {
        const { error } = await signIn(email, password, captchaToken ?? undefined)
        if (error) {
          toast.error(translateError(error))
          return
        }
        toast.success("Berhasil masuk")
      } else {
        const { error, needsConfirm } = await signUp(email, password, captchaToken ?? undefined)
        if (error) {
          toast.error(translateError(error))
          return
        }
        if (needsConfirm) {
          toast.success("Cek email kamu untuk verifikasi, lalu login.")
          setMode("login")
        } else {
          toast.success("Akun dibuat & langsung masuk")
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl brand-bg brand-glow text-white">
            <FileCode2 className="size-7" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              <span className="brand-gradient">WEN STUDIO</span>
            </h1>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Lua Obfuscator
            </p>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <strong>Supabase belum dikonfigurasi.</strong> Set <code>VITE_SUPABASE_URL</code> dan{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> di file <code>web/.env.local</code> (atau di env Netlify),
            lalu build ulang. Lihat <code>SETUP-SUPABASE.md</code>.
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border glass p-6 shadow-xl">
          <div className="flex rounded-md border bg-background p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded px-3 py-1.5 font-medium transition-colors ${mode === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded px-3 py-1.5 font-medium transition-colors ${mode === "register" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Daftar
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy || !isSupabaseConfigured} placeholder="kamu@contoh.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || !isSupabaseConfigured} placeholder="minimal 6 karakter" />
          </div>

          {isCaptchaEnabled ? <Turnstile onToken={setCaptchaToken} /> : null}

          <Button type="submit" className="w-full" disabled={busy || !isSupabaseConfigured}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {mode === "login" ? "Masuk" : "Daftar"}
          </Button>

          {mode === "register" ? (
            <p className="text-center text-xs text-muted-foreground">User baru dapat bonus token otomatis.</p>
          ) : null}
        </form>
        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          Proteksi script Lua kamu — cepat &amp; aman di browser. · Engine: Prometheus
        </p>
      </div>
    </main>
  )
}

function translateError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes("invalid login")) return "Email atau password salah."
  if (m.includes("already registered") || m.includes("already been registered")) return "Email sudah terdaftar. Silakan masuk."
  if (m.includes("email not confirmed")) return "Email belum diverifikasi. Cek inbox kamu."
  if (m.includes("rate limit")) return "Terlalu banyak percobaan. Coba lagi nanti."
  return msg
}
