-- =====================================================================
-- HEMAT DATABASE (WEN STUDIO): jangan catat tiap obfuscate ke ledger.
-- consume_tokens tetap memotong token, tapi TIDAK menulis baris riwayat
-- (obfuscate bisa ribuan kali -> hemat storage). Top-up/redeem tetap tercatat.
-- Jalankan di Supabase SQL Editor. (schema.sql terbaru sudah memuat ini.)
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
