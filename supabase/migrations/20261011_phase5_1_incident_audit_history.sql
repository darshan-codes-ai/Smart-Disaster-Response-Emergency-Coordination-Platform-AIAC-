-- Phase 5.1: Persistent Incident Audit History
-- Creates incident_events table, indexes, and RLS policies for tamper-proof audit trails.

create table if not exists public.incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  previous_state jsonb,
  new_state jsonb,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Idempotent check constraint for valid event_type values
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'incident_events_event_type_check'
  ) then
    alter table public.incident_events
    add constraint incident_events_event_type_check
    check (event_type in (
      'incident_created',
      'responder_assigned',
      'responder_unassigned',
      'status_changed',
      'note_added',
      'note_updated'
    ));
  end if;
end
$$;

-- Indexes for efficient retrieval and deterministic sorting
create index if not exists incident_events_incident_id_idx
on public.incident_events(incident_id);

create index if not exists incident_events_incident_created_idx
on public.incident_events(incident_id, created_at desc, id desc);

create index if not exists incident_events_actor_id_idx
on public.incident_events(actor_id);

-- Enable Row Level Security (RLS)
alter table public.incident_events enable row level security;

-- Read permission: authenticated users can query events only for incidents they are authorized to access.
-- Citizens: can only query events for incidents they reported (incidents.user_id = auth.uid()).
-- Operational roles: can query events for all incidents.
grant select on public.incident_events to authenticated;
grant select, insert, update, delete on public.incident_events to service_role;

drop policy if exists "Authenticated users can read authorized incident events" on public.incident_events;
create policy "Authenticated users can read authorized incident events"
on public.incident_events
for select
to authenticated
using (
  exists (
    select 1 from public.incidents
    where incidents.id = incident_events.incident_id
      and (
        incidents.user_id = auth.uid()
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid()
            and profiles.role in ('responder', 'hospital', 'shelter', 'command_center', 'admin')
        )
      )
  )
);

-- Note: No INSERT, UPDATE, or DELETE policies are granted to authenticated role.
-- Audit events are strictly append-only and written exclusively by the trusted backend service.

