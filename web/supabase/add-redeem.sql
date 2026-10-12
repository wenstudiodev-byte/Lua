-- =====================================================================
-- TAMBAHAN: Sistem Redeem Code / Voucher Token (WEN STUDIO)
-- Jalankan di Supabase SQL Editor JIKA kamu sudah pernah menjalankan
-- schema.sql versi sebelumnya. (schema.sql terbaru sudah memuat ini.)
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
