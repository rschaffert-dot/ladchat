-- ============================================================
-- Utökade profiler: för- och efternamn, telefon och avatarbild.
-- Registreringsformuläret skickar namn/telefon som user-metadata,
-- och handle_new_user speglar det till profiles. Avatarbilder lagras
-- i en publik bucket (profilbild som visas för andra medlemmar).
-- ============================================================

alter table public.profiles
  add column first_name  text,
  add column last_name   text,
  add column phone       text,
  add column avatar_path text;

-- Uppdatera speglingen av nya auth-användare så namn/telefon från
-- registreringen (raw_user_meta_data) fångas. Faller tillbaka på Googles
-- fält (name/full_name) och sist e-postprefix för display_name.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fname text := nullif(trim(coalesce(meta->>'first_name', meta->>'given_name', '')), '');
  lname text := nullif(trim(coalesce(meta->>'last_name', meta->>'family_name', '')), '');
  full  text := nullif(trim(concat_ws(' ', fname, lname)), '');
begin
  insert into public.profiles (id, email, display_name, first_name, last_name, phone)
  values (
    new.id,
    new.email,
    coalesce(
      full,
      nullif(trim(coalesce(meta->>'full_name', meta->>'name', '')), ''),
      split_part(coalesce(new.email, 'anvandare'), '@', 1)
    ),
    fname,
    lname,
    nullif(trim(coalesce(meta->>'phone', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- Lagring: avatarbilder ----------
-- Publik bucket, sökväg "{user_id}/avatar-ts.ext". Alla kan läsa (visas i
-- chatt/topplista), men var och en skriver bara i sin egen mapp.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
