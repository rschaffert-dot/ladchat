-- 0038: Tagga LadReal-systemmeddelandet så klienten kan känna igen det.
--
-- ladreal_tick() satte tidigare bara content='LadReal! ...' med tom
-- metadata ('{}'::jsonb) — klienten hade ingen strukturerad väg att skilja
-- ut just detta systemmeddelande från övriga (comeback, questar, dueller
-- m.fl.) för att visa det som en egen kompakt badge i stället för en
-- generisk pill i meddelandeflödet.
CREATE OR REPLACE FUNCTION public.ladreal_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
  local_hour integer := extract(hour from now() at time zone 'Europe/Stockholm')::integer;
begin
  for g in select id from public.groups loop
    insert into public.ladreal_state (group_id, fire_date, fire_hour)
      values (g.id, current_date, 9 + floor(random() * 12)::integer)
      on conflict (group_id) do update
        set fire_date = current_date, fire_hour = 9 + floor(random() * 12)::integer
        where public.ladreal_state.fire_date is distinct from current_date;

    update public.ladreal_state ls set fired_at = now()
      where ls.group_id = g.id and ls.fire_date = current_date
        and ls.fire_hour = local_hour
        and (ls.fired_at is null or ls.fired_at::date < current_date);
    if found then
      insert into public.messages (group_id, user_id, content, kind, metadata)
        select g.id, gr.owner_id,
          'LadReal! Posta en bild av vad du gör JUST NU inom 15 minuter — +15p till alla som hinner!',
          'system', jsonb_build_object('reason', 'ladreal')
        from public.groups gr where gr.id = g.id;
    end if;
  end loop;
end;
$function$;
