-- ============================================================
-- Dagens story: medlemmar postar bilder som lever i 24 timmar och
-- visas som ringar överst i chatten. Bilderna bor i chat-media
-- (samma RLS som chattens bilder). Städjobb raderar gamla rader.
-- ============================================================

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  media_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists stories_group_idx on public.stories (group_id, created_at desc);

alter table public.stories enable row level security;

drop policy if exists "stories_select_member" on public.stories;
create policy "stories_select_member" on public.stories
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "stories_insert_own" on public.stories;
create policy "stories_insert_own" on public.stories
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_group_member(group_id));

drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_delete_own" on public.stories
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.cleanup_stories()
returns void language sql security definer set search_path = public as $$
  delete from public.stories where created_at < now() - interval '48 hours';
$$;
revoke all on function public.cleanup_stories() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'cleanup-stories') then
    perform cron.unschedule('cleanup-stories');
  end if;
  perform cron.schedule('cleanup-stories', '30 4 * * *', 'select public.cleanup_stories();');
end $$;
