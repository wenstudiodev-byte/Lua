# Prometheus Playground — Website Lokal

Website obfuscator Lua yang jalan **100% di browser** (pakai Lua-WASM), tanpa
server backend. Cocok buat proteksi script Lua/Roblox kamu.

## Yang dibutuhkan
- **Node.js** versi 18+ (cek: `node -v`)
- **pnpm** (package manager repo ini)

Kalau belum punya pnpm, aktifin lewat corepack (sudah bawaan Node):
```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

## Langkah menjalankan

1. Buka terminal, masuk ke folder repo ini:
   ```bash
   cd Prometheus
   ```

2. Install dependency (sekali aja):
   ```bash
   pnpm install
   ```

3. Jalankan dev server:
   ```bash
   cd web
   pnpm dev
   ```

4. Buka browser ke alamat yang muncul, biasanya:
   ```
   http://localhost:5173/
   ```

Selesai. Tempel kode Lua di panel **Lua input**, atur **Preset**
(Minify / Weak / Medium / Strong), lalu klik tombol **Obfuscate** di kanan atas.
Hasilnya muncul di panel **Obfuscated output**, dan log tiap langkah pipeline
muncul di panel **Logs**.

## Mode produksi (opsional)
Kalau mau build statis buat di-host:
```bash
cd web
pnpm build      # hasil ada di web/dist
pnpm preview    # preview hasil build
```

## Catatan
- Obfuscation jalan sepenuhnya di browser kamu — kode nggak dikirim ke mana-mana.
- Tombol **Run** di tiap panel bisa buat ngetes jalanin kode Lua langsung.
- Preset: Minify (cuma perkecil), Weak, Medium, Strong (paling berat/aman).
- Engine inti: Prometheus by levno-710 (lisensi ada di file LICENSE).
