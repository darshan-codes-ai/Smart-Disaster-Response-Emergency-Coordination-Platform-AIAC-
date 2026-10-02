-- Milestone 3: Dispatch & Responder Assignment Schema
-- Adds nullable assigned_to column referencing auth.users(id) and index.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'incidents'
      and column_name = 'assigned_to'
  ) then
    alter table public.incidents
    add column assigned_to uuid references auth.users(id) on delete set null;
  end if;
end
$$;

create index if not exists incidents_assigned_to_idx
on public.incidents(assigned_to);
