-- Phase 5.4: tighten direct PostgREST access. All incident writes go through the
-- authenticated FastAPI service and transactional RPCs; browser clients are read-only.
revoke all privileges on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

-- Prevent unauthenticated direct access and bypass of API-side incident authorization.
revoke all privileges on table public.incidents from anon, authenticated;
grant select on table public.incidents to authenticated;

-- Audit history remains read-only to authenticated clients; service_role is the writer.
revoke all privileges on table public.incident_events from anon, authenticated;
grant select on table public.incident_events to authenticated;
grant all privileges on table public.incidents, public.profiles, public.incident_events to service_role;

-- Ensure internal SECURITY DEFINER RPCs are callable only by trusted backend code.
revoke all on function public.create_incident_with_audit(jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_incident_with_audit(jsonb, uuid, text, text) to service_role;
revoke all on function public.update_incident_with_audit(uuid, uuid, text, text, uuid, boolean, integer, text, text) from public, anon, authenticated;
grant execute on function public.update_incident_with_audit(uuid, uuid, text, text, uuid, boolean, integer, text, text) to service_role;
