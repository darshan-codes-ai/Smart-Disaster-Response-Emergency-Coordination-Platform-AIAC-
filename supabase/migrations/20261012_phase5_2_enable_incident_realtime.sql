-- Phase 5.2: publish incident and audit-table changes for Supabase Realtime.
-- Idempotent: safe to apply when either table is already in the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'incidents'
  ) then
    alter publication supabase_realtime add table public.incidents;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'incident_events'
  ) then
    alter publication supabase_realtime add table public.incident_events;
  end if;
end
$$;
