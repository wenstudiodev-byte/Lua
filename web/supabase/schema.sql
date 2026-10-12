-- =====================================================================
-- Prometheus Playground — Skema database Supabase
-- Login + sistem token (1 token = 1.000 karakter) + panel admin
-- Jalankan seluruh file ini di Supabase: SQL Editor -> New query -> Run
-- =====================================================================

-- ---------- Konfigurasi ----------
-- Bonus token untuk user baru (ubah sesukamu)
-- dipakai di fungsi handle_new_user() di bawah: nilai 20.
-- Tarif: 1 token per 1000 karakter (ubah di consume_tokens()).

-- =====================================================================
-- 1) TABEL PROFILES (1 baris per user, menyimpan role & saldo token)
-- =====================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'user' check (role in ('user','admin')),
  tokens     integer not null default 20 check (tokens >= 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- =====================================================================
-- 2) TABEL LEDGER TRANSAKSI TOKEN (riwayat semua perubahan token)
-- =====================================================================
create table if not exists public.token_transactions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     integer not null,              -- + topup, - pemakaian
  reason     text not null,                 -- signup_bonus | obfuscate | topup | adjust
  chars      integer,                       -- jumlah karakter (untuk 'obfuscate')
  note       text,
  created_by uuid,                           -- admin yang melakukan (untuk topup)
  created_at timestamptz not null default now()
);

alter table public.token_transactions enable row level security;

-- =====================================================================
-- 3) HELPER: cek apakah user yang sedang login adalah admin
--    SECURITY DEFINER => bypass RLS, jadi tidak rekursif dengan policy.
-- =====================================================================
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- =====================================================================
-- 4) RLS POLICIES
--    - User: hanya bisa BACA baris miliknya sendiri.
--    - Admin: bisa BACA semua.
--    - Tidak ada UPDATE langsung dari client; semua lewat RPC di bawah.
-- =====================================================================
drop policy if exists "read own profile"       on public.profiles;
drop policy if exists "admin read all profiles" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "admin read all profiles" on public.profiles
  for select using (public.is_admin());

drop policy if exists "read own tx"       on public.token_transactions;
drop policy if exists "admin read all tx" on public.token_transactions;
create policy "read own tx" on public.token_transactions
  for select using (auth.uid() = user_id);
create policy "admin read all tx" on public.token_transactions
  for select using (public.is_admin());

-- =====================================================================
-- 5) TRIGGER: buat profil + bonus token saat user baru mendaftar
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role, tokens)
  values (new.id, new.email, 'user', 20)
  on conflict (id) do nothing;

  insert into public.token_transactions (user_id, amount, reason, note)
  values (new.id, 20, 'signup_bonus', 'Bonus pendaftaran');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 6) RPC: consume_tokens — potong token saat obfuscate (atomik)
--    Tarif: 1 token per 1000 karakter, minimum 1 token.
--    Dipanggil frontend: supabase.rpc('consume_tokens', { p_chars })
-- =====================================================================
create or replace function public.consume_tokens(p_chars integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_cost    integer;
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_chars is null or p_chars < 0 then
    p_chars := 0;
  end if;

  -- 1 token / 1000 karakter, minimal 1
  v_cost := greatest(1, ceil(p_chars::numeric / 1000))::integer;

  select tokens into v_balance from public.profiles where id = v_uid for update;
  if v_balance is null then
    raise exception 'NO_PROFILE';
  end if;
  if v_balance < v_cost then
    raise exception 'INSUFFICIENT_TOKENS';
  end if;

  update public.profiles set tokens = tokens - v_cost
  where id = v_uid
  returning tokens into v_balance;

  insert into public.token_transactions (user_id, amount, reason, chars)
  values (v_uid, -v_cost, 'obfuscate', p_chars);

  return v_balance;
end;
$$;

-- =====================================================================
-- 7) RPC: admin_adjust_tokens — admin tambah/kurang token user (jual/topup)
--    p_delta > 0 => topup (jual token), p_delta < 0 => koreksi/potong.
-- =====================================================================
create or replace function public.admin_adjust_tokens(
  p_user  uuid,
  p_delta integer,
  p_note  text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  update public.profiles
  set tokens = greatest(0, tokens + p_delta)
  where id = p_user
  returning tokens into v_balance;

  if v_balance is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  insert into public.token_transactions (user_id, amount, reason, note, created_by)
  values (p_user, p_delta,
          case when p_delta >= 0 then 'topup' else 'adjust' end,
          p_note, auth.uid());

  return v_balance;
end;
$$;

-- =====================================================================
-- 8) RPC: admin_list_users — daftar semua user + saldo token (admin only)
-- =====================================================================
create or replace function public.admin_list_users()
returns table (id uuid, email text, role text, tokens integer, created_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.email, p.role, p.tokens, p.created_at
  from public.profiles p
  where public.is_admin()
  order by p.created_at desc;
$$;

-- =====================================================================
-- 9) RPC: admin_set_role — jadikan user admin / balikin ke user
-- =====================================================================
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;
  if p_role not in ('user','admin') then
    raise exception 'BAD_ROLE';
  end if;
  update public.profiles set role = p_role where id = p_user;
end;
$$;

-- =====================================================================
-- 10) GRANTS — izinkan user terautentikasi memanggil RPC
--     (keamanan tetap dijaga oleh cek di dalam fungsi + RLS)
-- =====================================================================
grant execute on function public.is_admin()                               to authenticated;
grant execute on function public.consume_tokens(integer)                  to authenticated;
grant execute on function public.admin_adjust_tokens(uuid,integer,text)   to authenticated;
grant execute on function public.admin_list_users()                       to authenticated;
grant execute on function public.admin_set_role(uuid,text)                to authenticated;

-- =====================================================================
-- SELESAI.
-- Langkah terakhir (jadikan dirimu admin) — setelah daftar lewat website,
-- ganti email di bawah lalu jalankan:
--
--   update public.profiles set role = 'admin' where email = 'EMAIL_KAMU@contoh.com';
--
-- =====================================================================


-- =====================================================================
-- 11) SISTEM REDEEM CODE / VOUCHER (lihat juga add-redeem.sql)
-- =====================================================================
-- Tabel kode voucher
create table if not exists public.redeem_codes (
  code       text primary key,
  tokens     integer not null check (tokens > 0),
  note       text,
  created_by uuid,
  created_at timestamptz not null default now(),
  used_by    uuid references auth.users(id) on delete set null,
  used_at    timestamptz
);

alter table public.redeem_codes enable row level security;

-- Hanya admin yang boleh membaca daftar kode. User "menukarkan" lewat RPC.
drop policy if exists "admin read codes" on public.redeem_codes;
create policy "admin read codes" on public.redeem_codes
  for select using (public.is_admin());

-- RPC: user menukar kode -> token bertambah ke akunnya sendiri (atomik)
create or replace function public.redeem_code(p_code text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text := upper(trim(p_code));
  v_tokens  integer;
  v_used    uuid;
  v_balance integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_code is null or v_code = '' then raise exception 'CODE_EMPTY'; end if;

  select tokens, used_by into v_tokens, v_used
  from public.redeem_codes where code = v_code for update;

  if v_tokens is null then raise exception 'CODE_NOT_FOUND'; end if;
  if v_used is not null then raise exception 'CODE_ALREADY_USED'; end if;

  update public.redeem_codes set used_by = v_uid, used_at = now() where code = v_code;
  update public.profiles set tokens = tokens + v_tokens where id = v_uid
    returning tokens into v_balance;
  insert into public.token_transactions (user_id, amount, reason, note)
    values (v_uid, v_tokens, 'redeem', 'Kode: ' || v_code);

  return v_balance;
end;
$$;

-- RPC: admin membuat sejumlah kode (untuk dijual)
create or replace function public.admin_create_codes(
  p_tokens integer,
  p_count  integer,
  p_note   text default null
)
returns table (code text, tokens integer)
language plpgsql security definer set search_path = public as $$
declare
  i      integer;
  v_code text;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_tokens is null or p_tokens <= 0 then raise exception 'BAD_TOKENS'; end if;
  if p_count  is null or p_count  <= 0 or p_count > 200 then raise exception 'BAD_COUNT'; end if;

  for i in 1..p_count loop
    loop
      v_code := 'WEN-' || upper(substring(replace(gen_random_uuid()::text, '-', '') for 8));
      begin
        insert into public.redeem_codes (code, tokens, note, created_by)
        values (v_code, p_tokens, p_note, auth.uid());
        exit;
      exception when unique_violation then
        -- bentrok (sangat jarang) -> ulang buat kode baru
      end;
    end loop;
    code := v_code; tokens := p_tokens; return next;
  end loop;
end;
$$;

-- RPC: admin melihat semua kode + statusnya
create or replace function public.admin_list_codes()
returns table (
  code text, tokens integer, note text,
  used_by_email text, used_at timestamptz, created_at timestamptz
)
language sql security definer set search_path = public as $$
  select c.code, c.tokens, c.note,
         (select email from public.profiles p where p.id = c.used_by) as used_by_email,
         c.used_at, c.created_at
  from public.redeem_codes c
  where public.is_admin()
  order by c.created_at desc;
$$;

grant execute on function public.redeem_code(text)                       to authenticated;
grant execute on function public.admin_create_codes(integer,integer,text) to authenticated;
grant execute on function public.admin_list_codes()                      to authenticated;


-- =====================================================================
-- 12) CHAT + ANTI-FARMING (lihat juga add-v3.sql)
-- =====================================================================
-- ---------- 1) ANTI-FARMING: kecilkan bonus signup (20 -> 2) ----------
-- Supaya daftar email palsu tidak dapat banyak token gratis.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role, tokens)
  values (new.id, new.email, 'user', 2)          -- bonus kecil (ubah sesuai selera)
  on conflict (id) do nothing;

  insert into public.token_transactions (user_id, amount, reason, note)
  values (new.id, 2, 'signup_bonus', 'Bonus pendaftaran');

  return new;
end;
$$;

-- ---------- 2) PRIVATE CHAT ----------
-- Satu "thread" per user (customer). Admin bisa balas thread siapa pun.
create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade, -- pemilik thread
  sender_id       uuid not null references auth.users(id) on delete cascade, -- pengirim
  sender_is_admin boolean not null default false,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  read_by_user    boolean not null default false,
  read_by_admin   boolean not null default false
);
create index if not exists idx_messages_user on public.messages(user_id, created_at);

alter table public.messages enable row level security;

-- Baca: pemilik thread atau admin
drop policy if exists "msg select" on public.messages;
create policy "msg select" on public.messages
  for select using (auth.uid() = user_id or public.is_admin());

-- Kirim oleh user (hanya ke thread-nya sendiri, tidak boleh ngaku admin)
drop policy if exists "msg insert user" on public.messages;
create policy "msg insert user" on public.messages
  for insert with check (
    sender_id = auth.uid() and user_id = auth.uid() and sender_is_admin = false
  );

-- Kirim oleh admin (ke thread mana pun)
drop policy if exists "msg insert admin" on public.messages;
create policy "msg insert admin" on public.messages
  for insert with check (
    public.is_admin() and sender_id = auth.uid() and sender_is_admin = true
  );

-- Update (tandai sudah dibaca): pemilik thread atau admin
drop policy if exists "msg update" on public.messages;
create policy "msg update" on public.messages
  for update using (auth.uid() = user_id or public.is_admin());

-- Realtime (abaikan error jika sudah ditambahkan)
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when others then null;
end $$;

-- RPC: admin melihat daftar thread (user yang pernah chat) + unread
create or replace function public.admin_list_threads()
returns table (user_id uuid, email text, last_body text, last_at timestamptz, unread integer)
language sql security definer set search_path = public as $$
  select m.user_id,
         (select email from public.profiles p where p.id = m.user_id) as email,
         (select body from public.messages mm where mm.user_id = m.user_id order by created_at desc limit 1) as last_body,
         max(m.created_at) as last_at,
         count(*) filter (where m.read_by_admin = false and m.sender_is_admin = false)::int as unread
  from public.messages m
  where public.is_admin()
  group by m.user_id
  order by max(m.created_at) desc;
$$;

-- RPC: tandai thread sudah dibaca
create or replace function public.mark_thread_read(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    update public.messages set read_by_admin = true
      where user_id = p_user and sender_is_admin = false and read_by_admin = false;
  elsif auth.uid() = p_user then
    update public.messages set read_by_user = true
      where user_id = p_user and sender_is_admin = true and read_by_user = false;
  else
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

grant execute on function public.admin_list_threads() to authenticated;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- ---------- 3) GRANT eksplisit untuk akses client (anti "permission denied") ----------
grant select on public.profiles            to authenticated;
grant select on public.token_transactions  to authenticated;
grant select, insert, update on public.messages to authenticated;


-- =====================================================================
-- 13) AUTO-ADMIN via email (lihat juga add-admin-email.sql)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role   text := 'user';
  v_tokens integer := 2;                                   -- bonus user biasa
  v_admins text[] := array['wenstudiodev@gmail.com'];      -- <<< daftar email admin
begin
  if new.email = any (v_admins) then
    v_role := 'admin';
    v_tokens := 100000;                                    -- saldo besar utk admin
  end if;

  insert into public.profiles (id, email, role, tokens)
  values (new.id, new.email, v_role, v_tokens)
  on conflict (id) do nothing;

  insert into public.token_transactions (user_id, amount, reason, note)
  values (new.id, v_tokens, 'signup_bonus',
          case when v_role = 'admin' then 'Admin utama' else 'Bonus pendaftaran' end);

  return new;
end;
$$;

-- Jika email admin SUDAH terlanjur daftar sebelumnya, promosikan sekarang:
update public.profiles set role = 'admin'
where email = 'wenstudiodev@gmail.com' and role <> 'admin';


-- =====================================================================
-- 14) HEMAT DB: consume_tokens tanpa ledger (lihat add-v5-noledger.sql)
-- =====================================================================
create or replace function public.consume_tokens(p_chars integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_cost    integer;
  v_balance integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_chars is null or p_chars < 0 then p_chars := 0; end if;

  v_cost := greatest(1, ceil(p_chars::numeric / 1000))::integer;

  select tokens into v_balance from public.profiles where id = v_uid for update;
  if v_balance is null then raise exception 'NO_PROFILE'; end if;
  if v_balance < v_cost then raise exception 'INSUFFICIENT_TOKENS'; end if;

  update public.profiles set tokens = tokens - v_cost
  where id = v_uid
  returning tokens into v_balance;

  -- (sengaja TIDAK insert ke token_transactions biar hemat database)
  return v_balance;
end;
$$;


-- =====================================================================
-- 15) CLOSE/HAPUS CHAT oleh admin (lihat add-v6-closechat.sql)
-- =====================================================================
create or replace function public.admin_close_thread(p_user uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  delete from public.messages where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;  -- jumlah pesan yang dihapus
end;
$$;

grant execute on function public.admin_close_thread(uuid) to authenticated;
