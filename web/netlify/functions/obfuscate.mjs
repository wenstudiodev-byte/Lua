// Netlify Function (v2): obfuscate server-side, GATED by login + token.
// Lua engine runs here (not in the browser), so tokens truly gate the output.
import { createClient } from "@supabase/supabase-js"

import { runPrometheusNode } from "./_obfuscate-core.mjs"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const MAX_SOURCE_CHARS = 200_000

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: "Server belum dikonfigurasi (SUPABASE_URL / SUPABASE_ANON_KEY)." }, 500)
  }

  // 1) Ambil token login dari header
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) return json({ error: "Harus login." }, 401)

  // 2) Baca body
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: "Body tidak valid." }, 400)
  }
  const source = typeof body?.source === "string" ? body.source : ""
  if (!source.trim()) return json({ error: "Kode kosong." }, 400)
  if (source.length > MAX_SOURCE_CHARS) {
    return json({ error: `Kode terlalu panjang (maks ${MAX_SOURCE_CHARS} karakter).` }, 413)
  }

  // 3) Verifikasi user via Supabase (client memakai token user -> RLS aktif)
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: "Sesi tidak valid, login ulang." }, 401)

  // 4) Obfuscate dulu (kalau gagal, tidak memotong token)
  const result = await runPrometheusNode({
    source,
    preset: body?.preset,
    luaVersion: body?.luaVersion,
    prettyPrint: Boolean(body?.prettyPrint),
    seed: Number(body?.seed) || 1,
    filename: "server-input.lua",
  })
  if (!result.ok) {
    return json({ ok: false, error: result.error, logs: result.logs }, 422)
  }

  // 5) Potong token (atomik, server-side) — tidak bisa di-skip dari browser
  const { data: balance, error: chargeErr } = await supabase.rpc("consume_tokens", {
    p_chars: source.length,
  })
  if (chargeErr) {
    const insufficient = chargeErr.message.includes("INSUFFICIENT_TOKENS")
    return json(
      { ok: false, error: insufficient ? "Token tidak cukup." : "Gagal memotong token: " + chargeErr.message },
      insufficient ? 402 : 400,
    )
  }

  return json({ ok: true, output: result.output, balance, logs: result.logs })
}
