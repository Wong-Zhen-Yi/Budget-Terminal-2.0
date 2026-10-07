create table public.budget_terminal_sync (
  user_id uuid not null references auth.users(id) on delete cascade,
  dataset text not null check (dataset in ('portfolio', 'personalFinance', 'cards')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  schema_version integer not null default 1 check (schema_version = 1),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, dataset)
);
alter table public.budget_terminal_sync enable row level security;
revoke all on public.budget_terminal_sync from anon, authenticated;
grant select on public.budget_terminal_sync to authenticated;
create policy own_sync_read on public.budget_terminal_sync for select to authenticated
  using ((select auth.uid()) = user_id);

-- Writes must compare the previous server revision atomically. Empty payloads
-- represent cleared data, so offline devices cannot resurrect deleted rows.
create function public.budget_terminal_sync_write(p_dataset text, p_payload jsonb, p_revision bigint)
returns setof public.budget_terminal_sync
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_revision is null or p_revision < 0 then raise exception 'Invalid revision'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 1048576 then
    raise exception 'Invalid personal data payload';
  end if;
  if p_dataset = 'portfolio' then
    if not p_payload ?& array['version', 'mainId', 'order', 'portfolios'] or
      exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('version', 'mainId', 'order', 'portfolios')) then
      raise exception 'Only saved portfolio fields can be synced';
    end if;
  elsif p_dataset = 'personalFinance' then
    if not p_payload ?& array['cash', 'debt', 'recurringBills', 'totalsCurrency', 'goal'] or
      exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('cash', 'debt', 'recurringBills', 'totalsCurrency', 'goal')) then
      raise exception 'Only personal finance fields can be synced';
    end if;
  elsif p_dataset = 'cards' then
    if not p_payload ?& array['version', 'starterCardsVersion', 'customCards', 'cardOrder', 'hiddenPortfolioIds', 'intervals'] or
      exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('version', 'starterCardsVersion', 'customCards', 'cardOrder', 'hiddenPortfolioIds', 'intervals')) then
      raise exception 'Only saved card fields can be synced';
    end if;
  else raise exception 'Invalid personal dataset';
  end if;
  if p_revision = 0 then
    return query insert into public.budget_terminal_sync(user_id, dataset, payload)
      values (v_user, p_dataset, p_payload) on conflict do nothing returning *;
  else
    return query update public.budget_terminal_sync
      set payload = p_payload, revision = revision + 1, updated_at = clock_timestamp()
      where user_id = v_user and dataset = p_dataset and revision = p_revision returning *;
  end if;
  if not found then raise exception 'Sync revision conflict' using errcode = '40001'; end if;
end;
$$;
revoke all on function public.budget_terminal_sync_write(text, jsonb, bigint) from public, anon;
grant execute on function public.budget_terminal_sync_write(text, jsonb, bigint) to authenticated;
