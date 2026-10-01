-- Milestone 1: Incident Status Validation & RLS Hardening
-- This migration records status validation constraints and authenticated RLS policies
-- without modifying existing columns, tables, or enum types.

-- 1. Status CHECK constraint on public.incidents (idempotent)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'incidents_status_check'
  ) then
    alter table public.incidents
    add constraint incidents_status_check
    check (status in ('reported', 'verified', 'assigned', 'in_progress', 'resolved', 'cancelled'));
  end if;
end
$$;

-- 2. Grant permissions to authenticated role for future direct Supabase client queries
grant select, insert, update on public.incidents to authenticated;

-- 3. SELECT policy: Citizens can only query their own incidents; operational roles can view all incidents.
drop policy if exists "Authenticated users can read authorized incidents" on public.incidents;
create policy "Authenticated users can read authorized incidents"
on public.incidents
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('responder', 'hospital', 'shelter', 'command_center', 'admin')
  )
);

-- 4. INSERT policy: Users can only insert records where user_id matches their own auth.uid().
drop policy if exists "Authenticated users can insert own incidents" on public.incidents;
create policy "Authenticated users can insert own incidents"
on public.incidents
for insert
to authenticated
with check (
  auth.uid() = user_id
);

-- 5. UPDATE policy: Citizens can only update their own incidents; operational roles can update any incident.
drop policy if exists "Authenticated users can update authorized incidents" on public.incidents;
create policy "Authenticated users can update authorized incidents"
on public.incidents
for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('responder', 'hospital', 'shelter', 'command_center', 'admin')
  )
);
