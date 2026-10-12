-- =====================================================================
-- AUTO-ADMIN via email (WEN STUDIO)
-- Email di daftar ini otomatis jadi admin saat mendaftar — tanpa SQL manual.
-- Jalankan di Supabase SQL Editor. (schema.sql terbaru sudah memuat ini.)
--
-- PENTING (keamanan): kalau "Confirm email" DIMATIKAN, siapa pun yang daftar
-- pakai email di daftar ini langsung jadi admin. Maka:
--   - DAFTARKAN email admin ini LEBIH DULU (email unik, tidak bisa dipakai 2x), ATAU
--   - Nyalakan "Confirm email" di Authentication supaya hanya pemilik email asli
--     yang bisa mendaftarkannya.
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
