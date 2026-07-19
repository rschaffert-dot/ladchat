-- ============================================================
-- Poängjakten: obligatoriskt bevis. Varje klarmarkering måste nu ha en
-- bild eller video uppladdad till chat-media ({group_id}/{user_id}/...),
-- så att vittnet kan granska bragden innan bekräftelse. Bucketens
-- befintliga RLS täcker detta: spelaren laddar upp i sin egen mapp och
-- alla gruppmedlemmar (inkl. vittnet) kan läsa.
-- ============================================================

drop function if exists public.hunt_claim(integer, uuid, uuid, boolean);

create or replace function public.hunt_claim(
  cid integer, gid uuid, witness uuid, proof text, bonus boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  ch record;
  existing record;
  claimant_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if witness = auth.uid() then raise exception 'witness cannot be yourself'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if not exists (
    select 1 from public.group_members where group_id = gid and user_id = witness
  ) then
    raise exception 'witness not a member of the group';
  end if;

  -- Beviset måste ligga i spelarens egen mapp under gruppens i chat-media.
  if proof is null or btrim(proof) = '' then
    raise exception 'proof required';
  end if;
  if position(gid::text || '/' || auth.uid()::text || '/' in proof) <> 1 then
    raise exception 'invalid proof path';
  end if;

  select * into ch from public.hunt_challenges where id = cid;
  if not found then raise exception 'unknown challenge'; end if;
  if ch.bonus_points is null then bonus := false; end if;

  select * into existing
    from public.hunt_completions
    where challenge_id = cid and user_id = auth.uid();

  if found then
    if existing.status <> 'denied' then raise exception 'already claimed'; end if;
    update public.hunt_completions
      set group_id = gid, witness_user_id = witness, bonus_claimed = bonus,
          proof_url = proof, status = 'pending', created_at = now(), responded_at = null
      where id = existing.id;
  else
    insert into public.hunt_completions
      (challenge_id, user_id, group_id, witness_user_id, bonus_claimed, proof_url)
      values (cid, auth.uid(), gid, witness, bonus, proof);
  end if;

  select coalesce(display_name, email, 'Någon') into claimant_name
    from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, group_id, kind, content)
    values (
      witness, gid, 'hunt_witness',
      '🃏 ' || claimant_name || ' vill att du intygar "' || ch.name ||
        '" i Poängjakten — bevis bifogat.'
    );
end;
$$;

revoke all on function public.hunt_claim(integer, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.hunt_claim(integer, uuid, uuid, text, boolean) to authenticated;
