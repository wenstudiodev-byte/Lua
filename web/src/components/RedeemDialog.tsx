import { Gift, Loader2, Ticket } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { useAuth } from "@/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabaseClient"

export function RedeemDialog() {
  const { setTokens } = useAuth()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  async function redeem() {
    const value = code.trim()
    if (!value) {
      toast.error("Masukkan kode dulu.")
      return
    }
    if (!supabase) return
    setBusy(true)
    const { data, error } = await supabase.rpc("redeem_code", { p_code: value })
    setBusy(false)
    if (error) {
      toast.error(translateRedeemError(error.message))
      return
    }
    if (typeof data === "number") setTokens(data)
    toast.success("Kode berhasil ditukar! Token kamu bertambah.")
    setCode("")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Ticket className="size-3.5" /> Tukar Kode
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-5 text-primary" /> Tukar Kode Token
          </DialogTitle>
          <DialogDescription>
            Masukkan kode voucher (mis. <code>WEN-XXXXXXXX</code>) untuk menambah token ke akunmu.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="redeem-code">Kode</Label>
          <Input
            id="redeem-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") void redeem()
            }}
            placeholder="WEN-XXXXXXXX"
            autoFocus
            className="font-mono tracking-wide"
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void redeem()} disabled={busy} className="w-full sm:w-auto">
            {busy ? <Loader2 className="animate-spin" /> : <Ticket />} Tukar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function translateRedeemError(msg: string): string {
  if (msg.includes("CODE_NOT_FOUND")) return "Kode tidak ditemukan."
  if (msg.includes("CODE_ALREADY_USED")) return "Kode ini sudah pernah dipakai."
  if (msg.includes("CODE_EMPTY")) return "Kode kosong."
  if (msg.includes("NOT_AUTHENTICATED")) return "Sesi habis, silakan login ulang."
  return "Gagal menukar kode: " + msg
}
