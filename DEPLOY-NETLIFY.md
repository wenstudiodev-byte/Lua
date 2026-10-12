# Deploy Prometheus Playground ke Netlify

Situs ini 100% statis & client-side, jadi gratis dan gampang di Netlify.
Ada **2 cara**. Pilih salah satu.

> **PENTING (versi dengan login/token):** sebelum deploy, selesaikan dulu
> `SETUP-SUPABASE.md` dan siapkan 2 env var: `VITE_SUPABASE_URL` dan
> `VITE_SUPABASE_ANON_KEY`. Untuk versi ini pakai **Cara 2 (Git)** dan set env var
> di Netlify, atau build lokal (`pnpm build`) setelah mengisi `web/.env.local`
> lalu drag folder `dist`. Tanpa env var, website hanya menampilkan pesan
> "Supabase belum dikonfigurasi".

---

## Cara 1 — Drag & Drop (paling cepat, tanpa Git)

Pakai folder hasil build yang sudah jadi (`dist`).

1. Buka https://app.netlify.com/drop
2. Tarik folder **`dist`** (ada di dalam `Prometheus-netlify-DIST.zip`, extract dulu) ke halaman itu.
3. Selesai — Netlify langsung kasih URL live.

> File `_redirects` sudah ikut di dalam `dist` supaya routing SPA jalan.

---

## Cara 2 — Deploy dari Git (otomatis rebuild tiap push)

Pakai repo lengkap (`Prometheus-netlify-REPO.zip`) yang sudah ada `netlify.toml`.

1. Push repo ini ke GitHub/GitLab kamu.
2. Di Netlify: **Add new site → Import an existing project** → pilih repo-nya.
3. Build settings ke-detect otomatis dari `netlify.toml`:
   - Build command: `corepack enable && pnpm install && pnpm --filter web build -- --base=/`
   - Publish directory: `web/dist`
4. Klik **Deploy**. Selesai.

---

## Catatan
- Obfuscation jalan sepenuhnya di browser (Lua via WASM) — nggak ada backend,
  kode user nggak dikirim ke server.
- File `.wasm` sudah di-set MIME `application/wasm` lewat `netlify.toml` / `_redirects`.
- Kalau mau deploy via CLI: `npm i -g netlify-cli` lalu `netlify deploy --prod --dir=web/dist`.
- Engine inti: Prometheus by levno-710 (lihat LICENSE).
