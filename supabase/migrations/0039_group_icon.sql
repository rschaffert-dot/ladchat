-- 0039: Egen gruppikon.
--
-- Grupplistans ruta blir en mosaik av medlemmarnas bilder (klientsidan)
-- om ingen egen ikon är satt — den här migrationen lägger bara till
-- lagringsplatsen: en kolumn på groups + en publik bucket dit alla
-- medlemmar i gruppen får ladda upp en bild.

alter table public.groups add column if not exists icon_path text;

insert into storage.buckets (id, name, public)
values ('group-icons', 'group-icons', true)
on conflict (id) do nothing;

-- Sökväg: "{group_id}/icon-<ts>.<ext>" — is_group_member() (från 0001)
-- avgör om den inloggade användaren får skriva i den mappen.
drop policy if exists "group_icons_insert_member" on storage.objects;
create policy "group_icons_insert_member" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-icons'
    and public.is_group_member(split_part(name, '/', 1)::uuid)
  );

drop policy if exists "group_icons_update_member" on storage.objects;
create policy "group_icons_update_member" on storage.objects for update to authenticated
  using (
    bucket_id = 'group-icons'
    and public.is_group_member(split_part(name, '/', 1)::uuid)
  )
  with check (
    bucket_id = 'group-icons'
    and public.is_group_member(split_part(name, '/', 1)::uuid)
  );

drop policy if exists "group_icons_delete_member" on storage.objects;
create policy "group_icons_delete_member" on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-icons'
    and public.is_group_member(split_part(name, '/', 1)::uuid)
  );
