import { MessageCircle, X } from "lucide-react"
import { useEffect, useState } from "react"

import { useAuth } from "@/auth/AuthProvider"
import { ChatThread } from "@/components/ChatThread"
import { supabase } from "@/lib/supabaseClient"

// Floating chat bubble (pojok kanan bawah) yang pop saat dipencet.
export function ChatBubble() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const uid = user?.id

  useEffect(() => {
    if (!supabase || !uid) return
    let active = true
    const sb = supabase
    const refresh = async () => {
      const { count } = await sb
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("sender_is_admin", true)
        .eq("read_by_user", false)
      if (active) setUnread(count ?? 0)
    }
    void refresh()
    const channel = sb
      .channel(`bubble-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${uid}` },
        () => void refresh(),
      )
      .subscribe()
    return () => {
      active = false
      void sb.removeChannel(channel)
    }
  }, [uid])

  useEffect(() => {
    if (open) setUnread(0)
  }, [open])

  if (!uid) return null

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div className="flex h-[70vh] max-h-[560px] w-[88vw] max-w-sm flex-col overflow-hidden rounded-2xl border glass shadow-2xl brand-glow">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4 text-primary" /> Chat dengan Admin
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              aria-label="Tutup chat"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <ChatThread threadUserId={uid} asAdmin={false} selfId={uid} />
          </div>
        </div>
      ) : null}

      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-14 items-center justify-center rounded-full brand-bg text-white shadow-xl brand-glow transition-transform hover:scale-105 active:scale-95"
        aria-label={open ? "Tutup chat" : "Buka chat"}
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        {!open && unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-[color:var(--background)]">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
    </div>
  )
}
