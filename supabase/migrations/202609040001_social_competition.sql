create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.league_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  wallet_address text not null unique,
  display_name text,
  enrolled_at timestamptz not null default transaction_timestamp(),
  formula_version text not null default 'CYS-EDGE-v1',
  updated_at timestamptz not null default transaction_timestamp(),
  constraint league_profiles_wallet_address_check
    check (wallet_address = lower(wallet_address) and wallet_address ~ '^0x[0-9a-f]{40}$'),
  constraint league_profiles_display_name_check
    check (
      display_name is null
      or (
        display_name = btrim(display_name)
        and display_name ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{1,23}$'
        and lower(display_name) not in (
          'admin', 'administrator', 'moderator', 'support', 'somnia',
          'dreamdex', 'call your shot', 'callyourshot'
        )
      )
    ),
  constraint league_profiles_formula_version_check
    check (formula_version = 'CYS-EDGE-v1')
);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  creator_wallet text not null,
  invited_wallet text not null,
  opponent_user_id uuid references auth.users(id) on delete cascade,
  opponent_wallet text,
  market_id text not null,
  status text not null default 'open',
  created_at timestamptz not null default transaction_timestamp(),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  constraint challenges_wallets_check check (
    creator_wallet = lower(creator_wallet)
    and creator_wallet ~ '^0x[0-9a-f]{40}$'
    and invited_wallet = lower(invited_wallet)
    and invited_wallet ~ '^0x[0-9a-f]{40}$'
    and creator_wallet <> invited_wallet
    and (
      opponent_wallet is null
      or (
        opponent_wallet = lower(opponent_wallet)
        and opponent_wallet ~ '^0x[0-9a-f]{40}$'
      )
    )
  ),
  constraint challenges_market_id_check
    check (market_id = lower(market_id) and market_id ~ '^0x[0-9a-f]{64}$'),
  constraint challenges_status_check check (status in ('open', 'accepted', 'cancelled')),
  constraint challenges_state_check check (
    (status = 'open' and opponent_user_id is null and opponent_wallet is null and accepted_at is null and cancelled_at is null)
    or (status = 'accepted' and opponent_user_id is not null and opponent_wallet = invited_wallet and accepted_at is not null and cancelled_at is null)
    or (status = 'cancelled' and opponent_user_id is null and opponent_wallet is null and accepted_at is null and cancelled_at is not null)
  )
);

create index challenges_creator_status_idx on public.challenges (creator_user_id, status);
create index challenges_invited_status_idx on public.challenges (invited_wallet, status);
create index challenges_market_idx on public.challenges (market_id);

alter table public.league_profiles enable row level security;
alter table public.challenges enable row level security;

create policy "league profiles are publicly readable"
  on public.league_profiles for select
  using (true);

create policy "profile owners are the only possible writers"
  on public.league_profiles for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "challenges are publicly readable"
  on public.challenges for select
  using (true);

create policy "challenge participants are the only possible writers"
  on public.challenges for all
  to authenticated
  using (
    creator_user_id = (select auth.uid())
    or opponent_user_id = (select auth.uid())
  )
  with check (
    creator_user_id = (select auth.uid())
    or opponent_user_id = (select auth.uid())
  );

create function private.authenticated_wallet_address(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(web3_identity.identity_data ->> 'address')
  from auth.identities as web3_identity
  where web3_identity.user_id = p_user_id
    and web3_identity.provider = 'web3'
    and web3_identity.identity_data ->> 'chain' = 'ethereum'
    and case
      when web3_identity.identity_data ->> 'network' ~ '^\d+$'
        then (web3_identity.identity_data ->> 'network')::bigint
      else null
    end = 50312
    and web3_identity.identity_data ->> 'address' ~* '^0x[0-9a-f]{40}$'
  order by web3_identity.last_sign_in_at desc nulls last
  limit 1;
$$;

create function public.enroll_in_league(p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_wallet text;
  profile_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  current_wallet := private.authenticated_wallet_address(current_user_id);
  if current_wallet is null then
    raise exception 'A verified Ethereum Web3 identity is required.' using errcode = '28000';
  end if;

  insert into public.league_profiles (user_id, wallet_address, display_name)
  values (current_user_id, current_wallet, nullif(btrim(p_display_name), ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        updated_at = transaction_timestamp()
    where public.league_profiles.wallet_address = excluded.wallet_address
  returning id into profile_id;

  if profile_id is null then
    raise exception 'This account is already bound to a different wallet.' using errcode = '23514';
  end if;
  return profile_id;
end;
$$;

create function public.update_display_name(p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  profile_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  update public.league_profiles
  set display_name = nullif(btrim(p_display_name), ''),
      updated_at = transaction_timestamp()
  where user_id = current_user_id
    and wallet_address = private.authenticated_wallet_address(current_user_id)
  returning id into profile_id;

  if profile_id is null then
    raise exception 'League enrollment was not found.' using errcode = 'P0002';
  end if;
  return profile_id;
end;
$$;

create function public.create_challenge(p_market_id text, p_invited_wallet text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_wallet text;
  normalized_invitee text := lower(btrim(p_invited_wallet));
  normalized_market text := lower(btrim(p_market_id));
  challenge_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  current_wallet := private.authenticated_wallet_address(current_user_id);
  if current_wallet is null then
    raise exception 'A verified Ethereum Web3 identity is required.' using errcode = '28000';
  end if;
  if normalized_invitee = current_wallet then
    raise exception 'You cannot challenge your own wallet.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.league_profiles where wallet_address = current_wallet and user_id = current_user_id) then
    raise exception 'Join the league before creating a challenge.' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(current_user_id::text));
  if (select count(*) from public.challenges where creator_user_id = current_user_id and status = 'open') >= 10 then
    raise exception 'Cancel an open challenge before creating another.' using errcode = '54000';
  end if;

  insert into public.challenges (creator_user_id, creator_wallet, invited_wallet, market_id)
  values (current_user_id, current_wallet, normalized_invitee, normalized_market)
  returning id into challenge_id;
  return challenge_id;
end;
$$;

create function public.accept_challenge(p_challenge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_wallet text;
  accepted_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  current_wallet := private.authenticated_wallet_address(current_user_id);
  if current_wallet is null then
    raise exception 'A verified Ethereum Web3 identity is required.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.league_profiles where wallet_address = current_wallet and user_id = current_user_id) then
    raise exception 'Join the league before accepting a challenge.' using errcode = 'P0002';
  end if;

  update public.challenges
  set opponent_user_id = current_user_id,
      opponent_wallet = current_wallet,
      status = 'accepted',
      accepted_at = transaction_timestamp()
  where id = p_challenge_id
    and status = 'open'
    and invited_wallet = current_wallet
    and creator_user_id <> current_user_id
  returning id into accepted_id;

  if accepted_id is null then
    raise exception 'This challenge is unavailable or belongs to another wallet.' using errcode = 'P0002';
  end if;
  return accepted_id;
end;
$$;

create function public.cancel_challenge(p_challenge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  cancelled_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  update public.challenges
  set status = 'cancelled', cancelled_at = transaction_timestamp()
  where id = p_challenge_id
    and creator_user_id = current_user_id
    and creator_wallet = private.authenticated_wallet_address(current_user_id)
    and status = 'open'
  returning id into cancelled_id;

  if cancelled_id is null then
    raise exception 'Only the creator can cancel an open challenge.' using errcode = 'P0002';
  end if;
  return cancelled_id;
end;
$$;

revoke all on public.league_profiles from public, anon, authenticated;
revoke all on public.challenges from public, anon, authenticated;
grant select (id, wallet_address, display_name, enrolled_at, formula_version, updated_at)
  on public.league_profiles to anon, authenticated;
grant select (id, creator_wallet, invited_wallet, opponent_wallet, market_id, status, created_at, accepted_at, cancelled_at)
  on public.challenges to anon, authenticated;

revoke all on function public.enroll_in_league(text) from public, anon;
revoke all on function public.update_display_name(text) from public, anon;
revoke all on function public.create_challenge(text, text) from public, anon;
revoke all on function public.accept_challenge(uuid) from public, anon;
revoke all on function public.cancel_challenge(uuid) from public, anon;
grant execute on function public.enroll_in_league(text) to authenticated;
grant execute on function public.update_display_name(text) to authenticated;
grant execute on function public.create_challenge(text, text) to authenticated;
grant execute on function public.accept_challenge(uuid) to authenticated;
grant execute on function public.cancel_challenge(uuid) to authenticated;

revoke all on function private.authenticated_wallet_address(uuid) from public, anon, authenticated;
