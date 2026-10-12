# Setup WEN STUDIO Lua Obfuscator (Supabase)

Fitur: **login (+ CAPTCHA opsional)**, **sistem token** (1 token = 1.000 karakter),
**limit otomatis**, **panel admin** (top-up manual + generate kode), **redeem
code/voucher**, **private chat admin↔user**, **riwayat transaksi token**, dan
**obfuscate server-side opsional** (anti-bypass).

> **Sudah pernah setup versi sebelumnya?** Jalankan file-file ini di SQL Editor
> sesuai yang belum (urut): **`add-redeem.sql`** → **`add-v3.sql`** →
> **`add-admin-email.sql`** (auto-admin) → **`add-v5-noledger.sql`**
> (hemat DB: obfuscate tidak dicatat) → **`add-v6-closechat.sql`**
> (admin tutup & hapus chat). Install baru: cukup `schema.sql`.

> **Catatan v5:** chat sekarang berupa **bubble mengambang di pojok kanan bawah**
> (bukan tombol header). Obfuscate **tidak lagi dicatat** di database (hemat
> storage) — hasilnya tinggal **copy** atau **download**. Riwayat top-up/redeem
> tetap ada di database untuk admin.

Obfuscate tetap jalan di browser. Supabase hanya dipakai untuk login & database token.
Semua logika token sudah diuji (potong token, limit, proteksi admin) — tinggal sambungkan.

---

## 1. Buat project Supabase (gratis)

1. Daftar/masuk di https://supabase.com → **New project**.
2. Isi nama & password database, pilih region terdekat (mis. Singapore), **Create**.
3. Tunggu ±1 menit sampai project siap.

## 2. Jalankan skema database

1. Di project Supabase: menu kiri **SQL Editor** → **New query**.
2. Buka file **`web/supabase/schema.sql`**, copy SELURUH isinya, tempel, klik **Run**.
3. Harus muncul "Success". Ini membuat tabel `profiles`, `token_transactions`,
   dan semua fungsi (potong token, top-up admin, dll).

## 3. Matikan verifikasi email (biar login langsung jalan)

1. Menu **Authentication** → **Sign In / Providers** → **Email**.
2. Matikan **Confirm email** (toggle off) → Save.

> Kalau ini dibiarkan nyala, user baru harus klik link verifikasi di email dulu
> sebelum bisa login. Untuk layanan jual token, biasanya dimatikan.

## 4. Ambil API keys

1. Menu **Project Settings** (ikon gear) → **API**.
2. Catat 2 nilai:
   - **Project URL** → untuk `VITE_SUPABASE_URL`
   - **anon public key** → untuk `VITE_SUPABASE_ANON_KEY`

> Anon key aman ditaruh di frontend (memang dirancang publik; keamanan dijaga
> oleh Row Level Security + fungsi di database).

## 5. Set environment variable

### Kalau jalan lokal
Buat file **`web/.env.local`** (contoh ada di `web/.env.example`):
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```
Lalu:
```bash
cd web
pnpm install
pnpm dev     # buka http://localhost:5173
```

### Kalau deploy ke Netlify (Git)
Di Netlify: **Site settings → Environment variables → Add**, tambahkan:
- `VITE_SUPABASE_URL` = Project URL kamu
- `VITE_SUPABASE_ANON_KEY` = anon key kamu

Lalu deploy (lihat `DEPLOY-NETLIFY.md`). Netlify build otomatis pakai env ini.

> Catatan: paket "drag & drop" (dist siap jadi) TIDAK dipakai untuk versi ini,
> karena key Supabase harus ikut saat build. Pakai build lokal atau Netlify-Git.

## 6. Admin (OTOMATIS via email)

Email **`wenstudiodev@gmail.com`** sudah di-set jadi admin otomatis (lihat
`add-admin-email.sql` / fungsi `handle_new_user` di schema). Jadi:

1. Buka website → tab **Daftar** → daftar pakai **wenstudiodev@gmail.com**.
2. Langsung jadi admin (saldo 100.000 token). Tombol **Admin** langsung muncul —
   tidak perlu SQL manual lagi.

> **Keamanan:** daftarkan email admin ini LEBIH DULU (email unik, tak bisa dipakai
> 2x), atau nyalakan "Confirm email" supaya hanya pemilik email asli yang bisa
> mendaftarkannya menjadi admin.

**Menambah admin lain:** dua cara —
- Login sebagai admin → panel **Admin → tab User** → klik label role user jadi `admin`, atau
- Tambahkan email ke array `v_admins` di `add-admin-email.sql`, jalankan ulang di SQL Editor.

---

## Cara pakai

**Sebagai user:**
- Login → saldo token tampil di kanan atas.
- Tiap Obfuscate yang berhasil memotong token = `ceil(jumlah_karakter / 1000)` (min 1).
- Kalau token habis, Obfuscate ditolak sampai di-top-up admin.

**Sebagai admin (tombol Admin):**
- Tab **User:** lihat semua user & saldo token.
  - **Jual/top-up manual:** isi angka positif (mis. `100`) di kolom user → **Terapkan**.
  - **Kurangi token:** isi angka negatif (mis. `-50`).
  - **Angkat admin:** klik label role (`user`/`admin`) untuk menukarnya.
- Tab **Kode (redeem/voucher):**
  - Isi **Token/kode** (mis. 500) + **Jumlah kode** (mis. 10) → **Buat**.
  - Kode (format `WEN-XXXXXXXX`) otomatis tersalin ke clipboard — tinggal jual.
  - Tabel menampilkan status tiap kode (belum dipakai / dipakai oleh siapa).

**Alur jualan pakai redeem code:**
1. Admin buat kode senilai X token, jual ke pembeli (via transfer/QRIS/dll).
2. Pembeli login → klik **Tukar Kode** → masukkan kode → token langsung nambah.
3. Tiap kode hanya bisa dipakai 1x. Aman: user tidak bisa menambah tokennya
   sendiri selain lewat kode yang valid.

## Mengubah tarif / bonus
- **Bonus user baru (anti-farming):** default sekarang **2** token. Ubah angka `2`
  di fungsi `handle_new_user()` (schema.sql / add-v3.sql), jalankan ulang di SQL Editor.
- **Tarif token:** ubah `1000` di fungsi `consume_tokens()` (schema.sql) DAN
  `CHARS_PER_TOKEN` di `web/src/lib/supabaseClient.ts`, lalu build ulang.

---

# Fitur tambahan (v3)

## 💬 Private chat admin↔user
Otomatis aktif setelah `add-v3.sql`. User klik **bubble chat di pojok kanan
bawah** (ada badge pesan belum dibaca), admin buka tab **Chat** di panel admin.
Realtime (Supabase Realtime). RLS menjamin user cuma bisa lihat/kirim thread-nya.

**Tutup & hapus chat (hemat DB):** di tab Chat admin, pilih percakapan lalu klik
**Tutup & hapus** → semua pesan thread itu dihapus permanen dari database.
Berguna untuk membersihkan storage setelah urusan user selesai.

## 🛡️ Perketat login
1. **Verifikasi email:** di Supabase → Authentication → nyalakan **Confirm email**
   (kebalikan dari langkah 3 di atas) kalau mau anti email palsu.
2. **CAPTCHA (Cloudflare Turnstile, opsional):**
   - Buat site di https://dash.cloudflare.com/ → Turnstile → dapat **Site Key** + **Secret**.
   - Di Supabase: Authentication → Settings → **Bot and Abuse Protection** →
     aktifkan Turnstile, tempel **Secret**.
   - Set env `VITE_TURNSTILE_SITE_KEY` = Site Key, build ulang. CAPTCHA otomatis
     muncul di form login/daftar.
3. **Anti-farming:** bonus signup sudah diturunkan jadi 2 token.

## 🔒 Obfuscate server-side (anti-bypass) — OPSIONAL
Secara default obfuscate jalan di browser (token = lapisan akses). Kalau mau token
**benar-benar mengunci** (engine tidak dikirim ke browser, tidak bisa di-skip):

1. Set env **`VITE_SERVER_OBFUSCATE=1`** (lokal di `.env.local`, atau di Netlify).
2. Set juga env server (TANPA prefix VITE) di Netlify: **`SUPABASE_URL`** dan
   **`SUPABASE_ANON_KEY`** (nilai sama dengan yang VITE).
3. Deploy ke **Netlify via Git** (bukan drag-drop) — `netlify.toml` sudah
   mengatur function `obfuscate` + bundling engine Lua-nya.
4. Saat build, script `gen-lua-bundle.mjs` otomatis menyiapkan engine untuk server.

Saat mode ini aktif: tombol Obfuscate memanggil `/.netlify/functions/obfuscate`,
yang memverifikasi login + memotong token di server sebelum mengembalikan hasil.
Sudah diverifikasi: dengan mode ini, **engine Prometheus tidak ikut ke bundle browser**.

> Catatan: preset **Strong** bisa berat; function serverless punya batas waktu
> (±10 dtk). Untuk script besar/preset berat, pakai Medium atau mode client-side.

## Catatan keamanan
- Mode **client-side** (default): token = lapisan bisnis/akses, bukan DRM — user
  teknis bisa pakai CLI Prometheus langsung. Cukup untuk jualan ke komunitas.
- Mode **server-side**: token benar-benar mengunci compute & output.
- Semua perubahan token lewat fungsi database bersanksi (SECURITY DEFINER + cek
  admin + RLS) — user tidak bisa menambah tokennya sendiri dari browser.
- Chat & data user dilindungi RLS (sudah diuji: user tidak bisa intip thread lain).
- Link "share" membuka hasil tanpa memotong token (hanya menampilkan ulang).
