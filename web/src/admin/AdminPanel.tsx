import { ArrowLeft, Check, Coins, Copy, Loader2, MessageCircle, Plus, RefreshCw, ShieldCheck, Ticket, Trash2, UserCog, Users } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { ChatThread } from "@/components/ChatThread"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { supabase } from "@/lib/supabaseClient"

type AdminUser = {
  id: string
  email: string | null
  role: "user" | "admin"
  tokens: number
  created_at: string
}

type RedeemCode = {
  code: string
  tokens: number
  note: string | null
  used_by_email: string | null
  used_at: string | null
  created_at: string
}

type Tab = "users" | "codes" | "chat"

type Thread = {
  user_id: string
  email: string | null
  last_body: string | null
  last_at: string
  unread: number
}

export function AdminPanel({ onBack, selfId }: { onBack: () => void; selfId: string }) {
  const [tab, setTab] = useState<Tab>("users")

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden">
      <header className="sticky top-0 z-20 border-b glass">
        <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={onBack} aria-label="Kembali">
              <ArrowLeft />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg brand-bg text-white">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight">
                  Panel Admin <span className="brand-gradient">WEN STUDIO</span>
                </h1>
                <p className="text-xs text-muted-foreground">Kelola user & jual token</p>
              </div>
            </div>
          </div>
          <div className="flex items-center rounded-lg border glass p-1 text-sm">
            <button
              onClick={() => setTab("users")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === "users" ? "brand-bg text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Users className="size-4" /> User
            </button>
            <button
              onClick={() => setTab("codes")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === "codes" ? "brand-bg text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Ticket className="size-4" /> Kode
            </button>
            <button
              onClick={() => setTab("chat")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${tab === "chat" ? "brand-bg text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <MessageCircle className="size-4" /> Chat
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1100px] flex-1 overflow-hidden px-4 py-4">
        {tab === "users" ? <UsersTab selfId={selfId} /> : tab === "codes" ? <CodesTab /> : <ChatTab selfId={selfId} />}
      </section>
    </main>
  )
}

/* ============================ USERS ============================ */
function UsersTab({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.rpc("admin_list_users")
    setLoading(false)
    if (error) {
      toast.error("Gagal memuat user: " + error.message)
      return
    }
    setUsers((data ?? []) as AdminUser[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function adjust(userId: string, deltaStr: string) {
    const delta = parseInt(deltaStr, 10)
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Masukkan jumlah token (mis. 100 atau -50).")
      return
    }
    if (!supabase) return
    setBusyId(userId)
    const { data, error } = await supabase.rpc("admin_adjust_tokens", {
      p_user: userId,
      p_delta: delta,
      p_note: delta > 0 ? "Topup/jual token" : "Koreksi",
    })
    setBusyId(null)
    if (error) {
      toast.error("Gagal: " + error.message)
      return
    }
    toast.success(`Token diperbarui jadi ${data}`)
    setDrafts((d) => ({ ...d, [userId]: "" }))
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, tokens: data as number } : u)))
  }

  async function toggleRole(u: AdminUser) {
    if (!supabase) return
    const next = u.role === "admin" ? "user" : "admin"
    if (u.id === selfId && next === "user") {
      toast.error("Tidak bisa menurunkan role diri sendiri.")
      return
    }
    setBusyId(u.id)
    const { error } = await supabase.rpc("admin_set_role", { p_user: u.id, p_role: next })
    setBusyId(null)
    if (error) {
      toast.error("Gagal ubah role: " + error.message)
      return
    }
    toast.success(`Role ${u.email ?? u.id} jadi ${next}`)
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, role: next } : x)))
  }

  const filtered = users.filter((u) => (u.email ?? "").toLowerCase().includes(query.toLowerCase()))
  const totalTokens = users.reduce((s, u) => s + u.tokens, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Stat icon={<UserCog className="size-4" />} label={`${users.length} user`} />
        <Stat icon={<Coins className="size-4" />} label={`${totalTokens.toLocaleString()} token total`} />
        <Input placeholder="Cari email…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
        <Button variant="outline" onClick={() => void load()} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Muat ulang
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border glass">
        <ScrollArea className="h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 glass">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Token</th>
                <th className="px-4 py-2.5 font-medium">Tambah/Kurang</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Tidak ada user.</td></tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-2">
                      <span className="font-medium">{u.email ?? "—"}</span>
                      {u.id === selfId ? <span className="ml-2 text-xs text-muted-foreground">(kamu)</span> : null}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => void toggleRole(u)}
                        disabled={busyId === u.id}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${u.role === "admin" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"} hover:opacity-80`}
                        title="Klik untuk ubah role"
                      >
                        {u.role}
                      </button>
                    </td>
                    <td className="px-4 py-2 font-mono">{u.tokens.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          placeholder="mis. 100"
                          value={drafts[u.id] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
                          className="h-8 w-28"
                        />
                        <Button size="sm" onClick={() => void adjust(u.id, drafts[u.id] ?? "")} disabled={busyId === u.id}>
                          {busyId === u.id ? <Loader2 className="animate-spin" /> : "Terapkan"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Angka positif = tambah token, negatif (mis. <code>-50</code>) = kurangi. Klik label role untuk mengangkat/menurunkan admin.
      </p>
    </div>
  )
}

/* ============================ CODES ============================ */
function CodesTab() {
  const [codes, setCodes] = useState<RedeemCode[]>([])
  const [loading, setLoading] = useState(true)
  const [tokens, setTokens] = useState("500")
  const [count, setCount] = useState("1")
  const [note, setNote] = useState("")
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.rpc("admin_list_codes")
    setLoading(false)
    if (error) {
      toast.error("Gagal memuat kode: " + error.message)
      return
    }
    setCodes((data ?? []) as RedeemCode[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createCodes() {
    const t = parseInt(tokens, 10)
    const c = parseInt(count, 10)
    if (!Number.isFinite(t) || t <= 0) return toast.error("Token per kode harus > 0.")
    if (!Number.isFinite(c) || c <= 0 || c > 200) return toast.error("Jumlah kode 1–200.")
    if (!supabase) return
    setCreating(true)
    const { data, error } = await supabase.rpc("admin_create_codes", { p_tokens: t, p_count: c, p_note: note || null })
    setCreating(false)
    if (error) {
      toast.error("Gagal buat kode: " + error.message)
      return
    }
    const made = (data ?? []) as { code: string; tokens: number }[]
    toast.success(`${made.length} kode dibuat`)
    if (made.length > 0) {
      void navigator.clipboard.writeText(made.map((m) => m.code).join("\n")).catch(() => {})
    }
    setNote("")
    void load()
  }

  async function copyOne(code: string) {
    await navigator.clipboard.writeText(code)
    setCopied(code)
    window.setTimeout(() => setCopied(null), 1200)
  }

  const unused = codes.filter((c) => !c.used_at).length

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 rounded-xl border glass p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Ticket className="size-4 text-primary" /> Buat kode voucher (untuk dijual)
        </div>
        <div className="grid gap-3 sm:grid-cols-[150px_150px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>Token / kode</Label>
            <Input type="number" value={tokens} onChange={(e) => setTokens(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Jumlah kode</Label>
            <Input type="number" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Catatan (opsional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. promo Oktober" />
          </div>
          <Button onClick={() => void createCodes()} disabled={creating}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />} Buat
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Kode yang baru dibuat otomatis tersalin ke clipboard.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Stat icon={<Ticket className="size-4" />} label={`${codes.length} kode`} />
        <Stat icon={<Check className="size-4" />} label={`${unused} belum dipakai`} />
        <Button variant="outline" onClick={() => void load()} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Muat ulang
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border glass">
        <ScrollArea className="h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 glass">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Kode</th>
                <th className="px-4 py-2.5 font-medium">Token</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Catatan</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin" /></td></tr>
              ) : codes.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Belum ada kode. Buat di atas.</td></tr>
              ) : (
                codes.map((c) => (
                  <tr key={c.code} className="border-t">
                    <td className="px-4 py-2 font-mono font-medium">{c.code}</td>
                    <td className="px-4 py-2 font-mono">{c.tokens.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      {c.used_at ? (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">dipakai: {c.used_by_email ?? "—"}</span>
                      ) : (
                        <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">belum dipakai</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.note ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="outline" size="icon" className="size-7" onClick={() => void copyOne(c.code)} aria-label="Salin kode">
                        {copied === c.code ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  )
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border glass px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{icon}</span> {label}
    </div>
  )
}

/* ============================ CHAT ============================ */
function ChatTab({ selfId }: { selfId: string }) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.rpc("admin_list_threads")
    setLoading(false)
    if (error) {
      toast.error("Gagal memuat chat: " + error.message)
      return
    }
    const list = (data ?? []) as Thread[]
    setThreads(list)
    setSelected((cur) => cur ?? (list[0]?.user_id ?? null))
  }, [])

  useEffect(() => {
    void load()
    if (!supabase) return
    const channel = supabase
      .channel("admin-threads")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void load())
      .subscribe()
    return () => {
      void supabase!.removeChannel(channel)
    }
  }, [load])

  const selectedEmail = threads.find((t) => t.user_id === selected)?.email

  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    setConfirmClose(false)
  }, [selected])

  async function closeThread() {
    if (!selected || !supabase) return
    setClosing(true)
    const { data, error } = await supabase.rpc("admin_close_thread", { p_user: selected })
    setClosing(false)
    if (error) {
      toast.error("Gagal menutup chat: " + error.message)
      return
    }
    toast.success(`Chat ditutup — ${data ?? 0} pesan dihapus`)
    setConfirmClose(false)
    setSelected(null)
    void load()
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-[280px_1fr]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border glass">
        <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Percakapan</span>
          <Button variant="ghost" size="icon" className="size-6" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {threads.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Belum ada percakapan.</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.user_id}
                onClick={() => setSelected(t.user_id)}
                className={`flex w-full items-start gap-2 border-t px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 ${selected === t.user_id ? "bg-white/5" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.email ?? t.user_id.slice(0, 8)}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.last_body ?? ""}</div>
                </div>
                {t.unread > 0 ? (
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                    {t.unread > 9 ? "9+" : t.unread}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col">
        {selected ? (
          <>
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{selectedEmail ?? "User"}</span>
              {confirmClose ? (
                <div className="flex items-center gap-1.5">
                  <span className="hidden text-xs text-muted-foreground sm:inline">Hapus semua pesan?</span>
                  <Button variant="destructive" size="sm" onClick={() => void closeThread()} disabled={closing}>
                    {closing ? <Loader2 className="animate-spin" /> : <Trash2 className="size-3.5" />} Ya, hapus
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmClose(false)} disabled={closing}>
                    Batal
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmClose(true)}>
                  <Trash2 className="size-3.5" /> Tutup &amp; hapus
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <ChatThread key={selected} threadUserId={selected} asAdmin selfId={selfId} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border glass text-sm text-muted-foreground">
            Pilih percakapan di kiri.
          </div>
        )}
      </div>
    </div>
  )
}
