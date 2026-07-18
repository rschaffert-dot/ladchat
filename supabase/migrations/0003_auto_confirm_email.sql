-- Dev: auto-bekräfta e-post för nya användare (ersätter dashboard-inställningen
-- "Confirm email"). Gör att man kan logga in direkt efter registrering.
-- OBS: ta bort denna trigger innan produktion om riktig e-postbekräftelse önskas.
create or replace function public.auto_confirm_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirm on auth.users;
create trigger on_auth_user_confirm
  before insert on auth.users
  for each row execute function public.auto_confirm_email();

revoke all on function public.auto_confirm_email() from public, anon, authenticated;
