-- =====================================================================
-- CLOSE/HAPUS CHAT (WEN STUDIO): admin menutup percakapan user dan
-- MENGHAPUS semua pesannya dari database (bersihin storage).
-- Jalankan di Supabase SQL Editor. (schema.sql terbaru sudah memuat ini.)
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
