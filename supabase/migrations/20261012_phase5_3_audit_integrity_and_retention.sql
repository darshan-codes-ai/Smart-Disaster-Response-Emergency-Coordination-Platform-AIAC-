-- Phase 5.3: Audit Integrity, Retention Policy, and Transactional Functions
-- 1. Tighten foreign key delete behavior: prevent silent deletion of audit records
-- 2. Transactional stored procedure for atomic incident mutation + audit event logging

-- 1. Audit Retention Policy: Change foreign key to ON DELETE RESTRICT
-- This ensures that incidents with audit history cannot be silently dropped.
do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'incident_events_incident_id_fkey'
      and table_name = 'incident_events'
  ) then
    alter table public.incident_events
      drop constraint incident_events_incident_id_fkey;

    alter table public.incident_events
      add constraint incident_events_incident_id_fkey
      foreign key (incident_id)
      references public.incidents(id)
      on delete restrict;
  end if;
end
$$;

-- 2. Transactional Incident Update with Audit Logging
-- Executes incident update and audit event insertion in a single PostgreSQL transaction.
create or replace function public.update_incident_with_audit(
  p_incident_id uuid,
  p_actor_id uuid,
  p_status text default null,
  p_note text default null,
  p_assigned_to uuid default null,
  p_has_assignment_change boolean default false,
  p_priority_score integer default null,
  p_actor_name text default 'Operator',
  p_actor_role text default 'command_center'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_record record;
  v_new_record record;
  v_now timestamptz := now();
  v_event_id uuid;
begin
  -- Retrieve current incident row with row-level lock
  select * into v_old_record
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident % not found', p_incident_id using errcode = 'P0002';
  end if;

  -- Perform incident update
  update public.incidents
  set
    status = coalesce(p_status, status),
    note = case when p_note is not null then p_note else note end,
    assigned_to = case when p_has_assignment_change then p_assigned_to else assigned_to end,
    priority_score = coalesce(p_priority_score, priority_score),
    updated_at = v_now
  where id = p_incident_id
  returning * into v_new_record;

  -- 1. Status change audit event
  if p_status is not null and v_old_record.status is distinct from v_new_record.status then
    insert into public.incident_events (
      id, incident_id, actor_id, event_type, previous_state, new_state, metadata, created_at
    ) values (
      gen_random_uuid(),
      p_incident_id,
      p_actor_id,
      'status_changed',
      jsonb_build_object('status', v_old_record.status),
      jsonb_build_object('status', v_new_record.status),
      jsonb_build_object(
        'actor_name', p_actor_name,
        'actor_role', p_actor_role,
        'action_label', 'Status changed to ' || v_new_record.status
      ),
      v_now
    );
  end if;

  -- 2. Responder assignment audit event
  if p_has_assignment_change and v_old_record.assigned_to is distinct from v_new_record.assigned_to then
    if v_new_record.assigned_to is not null then
      insert into public.incident_events (
        id, incident_id, actor_id, event_type, previous_state, new_state, metadata, created_at
      ) values (
        gen_random_uuid(),
        p_incident_id,
        p_actor_id,
        'responder_assigned',
        jsonb_build_object('assigned_to', v_old_record.assigned_to),
        jsonb_build_object('assigned_to', v_new_record.assigned_to),
        jsonb_build_object(
          'actor_name', p_actor_name,
          'actor_role', p_actor_role,
          'action_label', 'Responder assigned'
        ),
        v_now
      );
    else
      insert into public.incident_events (
        id, incident_id, actor_id, event_type, previous_state, new_state, metadata, created_at
      ) values (
        gen_random_uuid(),
        p_incident_id,
        p_actor_id,
        'responder_unassigned',
        jsonb_build_object('assigned_to', v_old_record.assigned_to),
        jsonb_build_object('assigned_to', null),
        jsonb_build_object(
          'actor_name', p_actor_name,
          'actor_role', p_actor_role,
          'action_label', 'Responder unassigned'
        ),
        v_now
      );
    end if;
  end if;

  -- 3. Field note audit event
  if p_note is not null and v_old_record.note is distinct from v_new_record.note then
    insert into public.incident_events (
      id, incident_id, actor_id, event_type, previous_state, new_state, metadata, created_at
    ) values (
      gen_random_uuid(),
      p_incident_id,
      p_actor_id,
      case when v_old_record.note is null or v_old_record.note = '' then 'note_added' else 'note_updated' end,
      jsonb_build_object('note', v_old_record.note),
      jsonb_build_object('note', v_new_record.note),
      jsonb_build_object(
        'actor_name', p_actor_name,
        'actor_role', p_actor_role,
        'action_label', case when v_old_record.note is null or v_old_record.note = '' then 'Field note added' else 'Field note updated' end
      ),
      v_now
    );
  end if;

  return to_jsonb(v_new_record);
end;
$$;

-- Grant execution only to trusted service_role
revoke all on function public.update_incident_with_audit from public, anon, authenticated;
grant execute on function public.update_incident_with_audit to service_role;

-- Transactional incident creation + audit event.
create or replace function public.create_incident_with_audit(
  p_incident jsonb,
  p_actor_id uuid,
  p_actor_name text default 'Reporter',
  p_actor_role text default 'citizen'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents%rowtype;
begin
  insert into public.incidents (
    id, user_id, type, description, latitude, longitude, severity,
    status, priority_score, assigned_to, note, created_at, updated_at
  )
  values (
    coalesce((p_incident->>'id')::uuid, gen_random_uuid()),
    p_actor_id,
    p_incident->>'type',
    p_incident->>'description',
    (p_incident->>'latitude')::double precision,
    (p_incident->>'longitude')::double precision,
    coalesce((p_incident->>'severity')::integer, 3),
    'reported',
    coalesce((p_incident->>'priority_score')::double precision, 60),
    null,
    null,
    coalesce((p_incident->>'created_at')::timestamptz, now()),
    coalesce((p_incident->>'updated_at')::timestamptz, now())
  )
  returning * into v_incident;

  insert into public.incident_events (
    incident_id, actor_id, event_type, previous_state, new_state, metadata, created_at
  )
  values (
    v_incident.id, p_actor_id, 'incident_created', null,
    jsonb_build_object(
      'status', v_incident.status, 'type', v_incident.type,
      'severity', v_incident.severity, 'description', v_incident.description,
      'latitude', v_incident.latitude, 'longitude', v_incident.longitude
    ),
    jsonb_build_object('actor_name', p_actor_name, 'actor_role', p_actor_role,
                       'action_label', 'Incident Reported'),
    v_incident.created_at
  );

  return to_jsonb(v_incident);
end;
$$;

revoke all on function public.create_incident_with_audit(jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_incident_with_audit(jsonb, uuid, text, text) to service_role;
