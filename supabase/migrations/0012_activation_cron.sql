-- ============================================================
-- Schemalägg 48h-kollen. Kräver att pg_cron-tillägget är aktiverat
-- (Supabase: Dashboard → Database → Extensions → pg_cron).
--
-- Denna migration är avsiktligt separerad från 0011 så att kärnan
-- (tabeller + funktioner) kan appliceras även innan pg_cron slås på.
-- Om tillägget saknas hoppar den bara över schemaläggningen med en notice.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron är inte aktiverat — hoppar över schemaläggning. Aktivera tillägget och kör om denna migration.';
    return;
  end if;

  -- Ta bort ev. tidigare schema med samma namn så migrationen blir idempotent.
  if exists (select 1 from cron.job where jobname = 'process-inactive-groups') then
    perform cron.unschedule('process-inactive-groups');
  end if;

  -- Varje hel timme: avsluta förfallna aktiveringar + starta nya i tysta grupper.
  perform cron.schedule(
    'process-inactive-groups',
    '0 * * * *',
    'select public.process_inactive_groups();'
  );
end $$;
