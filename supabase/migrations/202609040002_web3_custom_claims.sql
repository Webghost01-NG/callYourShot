create or replace function private.authenticated_wallet_address(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(web3_identity.identity_data -> 'custom_claims' ->> 'address')
  from auth.identities as web3_identity
  where web3_identity.user_id = p_user_id
    and web3_identity.provider = 'web3'
    and web3_identity.identity_data -> 'custom_claims' ->> 'chain' = 'ethereum'
    and case
      when web3_identity.identity_data -> 'custom_claims' ->> 'network' ~ '^\d+$'
        then (web3_identity.identity_data -> 'custom_claims' ->> 'network')::bigint
      else null
    end = 50312
    and web3_identity.identity_data -> 'custom_claims' ->> 'address' ~* '^0x[0-9a-f]{40}$'
  order by web3_identity.last_sign_in_at desc nulls last
  limit 1;
$$;
