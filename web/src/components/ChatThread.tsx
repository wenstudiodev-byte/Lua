import { Loader2, Send } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { supabase } from "@/lib/supabaseClient"

export type Message = {
  id: number
  user_id: string
  sender_id: string
  sender_is_admin: boolean
  body: string
  created_at: string
}

export function ChatThread({
  threadUserId,
  asAdmin,
  selfId,
}: {
  threadUserId: string
  asAdmin: boolean
  selfId: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const markRead = useCallback(async () => {
    if (!supabase) return
    await supabase.rpc("mark_thread_read", { p_user: threadUserId }).then(() => {}, () => {})
  }, [threadUserId])

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from("messages")
      .select("id, user_id, sender_id, sender_is_admin, body, created_at")
      .eq("user_id", threadUserId)
      .order("created_at", { ascending: true })
      .limit(500)
    setLoading(false)
    if (error) {
      toast.error("Gagal memuat chat: " + error.message)
      return
    }
    setMessages((data ?? []) as Message[])
    void markRead()
  }, [threadUserId, markRead])

  useEffect(() => {
    void load()
    const sb = supabase
    if (!sb) return
    const channel = sb
      .channel(`msg-${threadUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${threadUserId}` },
        (payload) => {
          const row = payload.new as Message
          setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]))
          if (row.sender_id !== selfId) void markRead()
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [threadUserId, selfId, load, markRead])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  async function send() {
    const body = text.trim()
    if (!body) return
    if (!supabase) return
    setSending(true)
    const { error } = await supabase.from("messages").insert({
      user_id: threadUserId,
      sender_id: selfId,
      sender_is_admin: asAdmin,
      body,
    })
    setSending(false)
    if (error) {
      toast.error("Gagal kirim: " + error.message)
      return
    }
    setText("")
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border glass">
        <ScrollArea className="h-full">
          <div className="space-y-2 p-3">
            {loading ? (
              <div className="flex h-32 items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {asAdmin ? "Belum ada pesan di thread ini." : "Belum ada pesan. Sapa admin untuk mulai."}
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === selfId
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                        mine ? "brand-bg text-white" : "border glass"
                      }`}
                    >
                      {!mine ? (
                        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                          {m.sender_is_admin ? "Admin" : "User"}
                        </div>
                      ) : null}
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`mt-0.5 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                        {new Date(m.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>
      <div className="mt-2 flex shrink-0 items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Tulis pesan…"
          disabled={sending}
        />
        <Button onClick={() => void send()} disabled={sending || !text.trim()}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  )
}
