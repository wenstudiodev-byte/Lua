-- =====================================================================
-- TAMBAHAN v3 (WEN STUDIO): Private chat admin<->user + anti-farming
-- Jalankan di Supabase SQL Editor jika sudah pakai versi sebelumnya.
-- (schema.sql terbaru sudah memuat ini.)
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
