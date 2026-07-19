-- Radera turnering (endast tävlingsledning). Kaskaderar via on delete cascade
-- till anmälningar, uppdrag, bidrag, röster och resultat.

create or replace function public.delete_tournament(tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  delete from public.tournaments where id = tid;
end;
$$;

revoke all on function public.delete_tournament(uuid) from public, anon;
grant execute on function public.delete_tournament(uuid) to authenticated;
