-- 0040: Alla medlemmar får sätta gruppikonen, inte bara ägaren.
--
-- groups_update_owner (0001) tillåter bara ägaren att UPDATE:a groups-raden
-- — rimligt för t.ex. namnbyte, men "gruppchatten själva sätter ikonen"
-- ska gälla alla medlemmar. RLS är radbaserad, inte kolumnbaserad, så en
-- SECURITY DEFINER-RPC med egen behörighetskontroll är rätt verktyg i
-- stället för att luckra upp update-policyn för hela raden.
create or replace function public.set_group_icon(gid uuid, path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_member(gid) then
    raise exception 'not a member of this group';
  end if;
  update public.groups set icon_path = path where id = gid;
end;
$$;

revoke all on function public.set_group_icon(uuid, text) from public, anon;
grant execute on function public.set_group_icon(uuid, text) to authenticated;
