-- Phase 5.5: avoid per-row re-evaluation of auth.uid() in RLS policies.
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Authenticated users can insert own incidents" on public.incidents;
create policy "Authenticated users can insert own incidents"
on public.incidents for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Authenticated users can read authorized incidents" on public.incidents;
create policy "Authenticated users can read authorized incidents"
on public.incidents for select to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role in ('responder','hospital','shelter','command_center','admin')
  )
);

drop policy if exists "Authenticated users can update authorized incidents" on public.incidents;
create policy "Authenticated users can update authorized incidents"
on public.incidents for update to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role in ('responder','hospital','shelter','command_center','admin')
  )
)
with check (
  (select auth.uid()) = user_id
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role in ('responder','hospital','shelter','command_center','admin')
  )
);

drop policy if exists "Authenticated users can read authorized incident events" on public.incident_events;
create policy "Authenticated users can read authorized incident events"
on public.incident_events for select to authenticated
using (
  exists (
    select 1 from public.incidents
    where incidents.id = incident_events.incident_id
      and (
        incidents.user_id = (select auth.uid())
        or exists (
          select 1 from public.profiles
          where profiles.id = (select auth.uid())
            and profiles.role in ('responder','hospital','shelter','command_center','admin')
        )
      )
  )
);
