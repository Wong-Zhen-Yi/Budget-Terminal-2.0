-- Runs inside a transaction and leaves no users or records behind.
begin;
insert into auth.users(id) values
  ('f7a86a8a-53c7-4c18-aec3-010010010001'),
  ('f7a86a8a-53c7-4c18-aec3-010010010002');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f7a86a8a-53c7-4c18-aec3-010010010001', true);
select * from public.budget_terminal_sync_write('personalFinance',
  '{"cash":[],"debt":[],"recurringBills":[],"totalsCurrency":"SGD","goal":{}}', 0);
do $$ begin
  if (select count(*) from public.budget_terminal_sync) <> 1 then raise exception 'Owner cannot read own record'; end if;
  begin
    perform public.budget_terminal_sync_write('personalFinance',
      '{"cash":[],"debt":[],"recurringBills":[],"totalsCurrency":"SGD","goal":{}}', 0);
    raise exception 'Duplicate create was accepted';
  exception when serialization_failure then null;
  end;
  begin
    update public.budget_terminal_sync set payload = '{}';
    raise exception 'Direct writes bypass revision checks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.budget_terminal_sync_write('personalFinance',
      '{"cash":[],"debt":[],"recurringBills":[],"totalsCurrency":"SGD","goal":{},"settings":{}}', 1);
    raise exception 'Forbidden fields accepted';
  exception when raise_exception then
    if sqlerrm = 'Forbidden fields accepted' then raise; end if;
  end;
end $$;
select * from public.budget_terminal_sync_write('personalFinance',
  '{"cash":[],"debt":[],"recurringBills":[],"totalsCurrency":"USD","goal":{}}', 1);
select set_config('request.jwt.claim.sub', 'f7a86a8a-53c7-4c18-aec3-010010010002', true);
do $$ begin
  if (select count(*) from public.budget_terminal_sync) <> 0 then raise exception 'Another account can read owner data'; end if;
  begin
    perform public.budget_terminal_sync_write('personalFinance',
      '{"cash":[],"debt":[],"recurringBills":[],"totalsCurrency":"SGD","goal":{}}', 2);
    raise exception 'Another account can overwrite owner data';
  exception when serialization_failure then null;
  end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform 1 from public.budget_terminal_sync;
    raise exception 'Signed-out reads are permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.budget_terminal_sync_write('personalFinance', '{}', 0);
    raise exception 'Signed-out writes are permitted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
