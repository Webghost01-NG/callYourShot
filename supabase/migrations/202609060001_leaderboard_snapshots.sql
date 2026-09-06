create table public.league_score_snapshots (
  profile_id uuid primary key references public.league_profiles(id) on delete cascade,
  wallet_address text not null unique,
  formula_version text not null,
  profile_state text not null,
  score_numerator text,
  score_denominator text,
  score_micros integer,
  settled_count integer not null,
  source_block text not null,
  captured_at timestamptz not null default transaction_timestamp(),
  constraint league_score_snapshots_wallet_check
    check (wallet_address = lower(wallet_address) and wallet_address ~ '^0x[0-9a-f]{40}$'),
  constraint league_score_snapshots_formula_check
    check (formula_version = 'CYS-EDGE-v1'),
  constraint league_score_snapshots_state_check
    check (profile_state in ('empty', 'provisional', 'verified')),
  constraint league_score_snapshots_integer_text_check check (
    source_block ~ '^\d{1,78}$'
    and (score_numerator is null or score_numerator ~ '^-?\d{1,78}$')
    and (score_denominator is null or score_denominator ~ '^[1-9]\d{0,77}$')
  ),
  constraint league_score_snapshots_score_check check (
    settled_count between 0 and 10000
    and (score_micros is null or score_micros between 0 and 100000000)
    and (
      (profile_state = 'empty' and settled_count = 0 and score_numerator is null and score_denominator is null and score_micros is null)
      or (profile_state = 'provisional' and settled_count between 1 and 9 and score_numerator is not null and score_denominator is not null and score_micros is not null)
      or (profile_state = 'verified' and settled_count between 10 and 10000 and score_numerator is not null and score_denominator is not null and score_micros is not null)
    )
  )
);

create index league_score_snapshots_candidates_idx
  on public.league_score_snapshots (score_micros desc nulls last, settled_count desc, captured_at desc);

alter table public.league_score_snapshots enable row level security;

create policy "score snapshot candidates are publicly readable"
  on public.league_score_snapshots for select
  using (true);

create function public.publish_score_snapshot(
  p_formula_version text,
  p_profile_state text,
  p_score_numerator text,
  p_score_denominator text,
  p_score_micros integer,
  p_settled_count integer,
  p_source_block text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_wallet text;
  current_profile_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  current_wallet := private.authenticated_wallet_address(current_user_id);
  if current_wallet is null then
    raise exception 'A verified Ethereum Web3 identity is required.' using errcode = '28000';
  end if;

  select id into current_profile_id
  from public.league_profiles
  where user_id = current_user_id and wallet_address = current_wallet;
  if current_profile_id is null then
    raise exception 'Join the league before publishing a score snapshot.' using errcode = 'P0002';
  end if;

  insert into public.league_score_snapshots (
    profile_id, wallet_address, formula_version, profile_state,
    score_numerator, score_denominator, score_micros, settled_count, source_block
  ) values (
    current_profile_id, current_wallet, p_formula_version, p_profile_state,
    p_score_numerator, p_score_denominator, p_score_micros, p_settled_count, p_source_block
  )
  on conflict (profile_id) do update set
    wallet_address = excluded.wallet_address,
    formula_version = excluded.formula_version,
    profile_state = excluded.profile_state,
    score_numerator = excluded.score_numerator,
    score_denominator = excluded.score_denominator,
    score_micros = excluded.score_micros,
    settled_count = excluded.settled_count,
    source_block = excluded.source_block,
    captured_at = transaction_timestamp();

  return current_profile_id;
end;
$$;

revoke all on table public.league_score_snapshots from public, anon, authenticated;
grant select on table public.league_score_snapshots to anon, authenticated;

revoke all on function public.publish_score_snapshot(text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.publish_score_snapshot(text, text, text, text, integer, integer, text)
  to authenticated;
