-- Phase 6 Forward Migration: Explicit Note Presence & Note Clearing Audit Support
-- 1. Updates public.update_incident_with_audit to accept p_has_note_change boolean flag
-- 2. Distinguishes:
--    a) No note change requested (preserves current note, no audit event)
--    b) Note updated (stores new note, logs note_updated event)
--    c) Note cleared (stores null, logs note_cleared event)
-- 3. Fully backward compatible with callers that do not supply p_has_note_change

create or replace function public.update_incident_with_audit(
  p_incident_id uuid,
  p_actor_id uuid,
  p_status text default null,
  p_note text default null,
  p_assigned_to uuid default null,
  p_has_assignment_change boolean default false,
  p_has_note_change boolean default false,
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
  v_has_note_change boolean := p_has_note_change or (p_note is not null);
begin
  -- 1. Retrieve current incident row with row-level lock
  select * into v_old_record
  from public.incidents
  where id = p_incident_id
  for update;

  if not found then
    raise exception 'Incident % not found', p_incident_id using errcode = 'P0002';
  end if;

  -- 2. Perform incident update with explicit field presence
  update public.incidents
  set
    status = coalesce(p_status, status),
    note = case when v_has_note_change then p_note else note end,
    assigned_to = case when p_has_assignment_change then p_assigned_to else assigned_to end,
    priority_score = coalesce(p_priority_score, priority_score),
    updated_at = v_now
  where id = p_incident_id
  returning * into v_new_record;

  -- 3. Status change audit event
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

  -- 4. Responder assignment / unassignment audit event
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

  -- 5. Field note audit event (handles addition, modification, and clearing)
  if v_has_note_change and v_old_record.note is distinct from v_new_record.note then
    insert into public.incident_events (
      id, incident_id, actor_id, event_type, previous_state, new_state, metadata, created_at
    ) values (
      gen_random_uuid(),
      p_incident_id,
      p_actor_id,
      case
        when v_new_record.note is null or v_new_record.note = '' then 'note_cleared'
        when v_old_record.note is null or v_old_record.note = '' then 'note_added'
        else 'note_updated'
      end,
      jsonb_build_object('note', v_old_record.note),
      jsonb_build_object('note', v_new_record.note),
      jsonb_build_object(
        'actor_name', p_actor_name,
        'actor_role', p_actor_role,
        'action_label', case
          when v_new_record.note is null or v_new_record.note = '' then 'Field note cleared'
          when v_old_record.note is null or v_old_record.note = '' then 'Field note added'
          else 'Field note updated'
        end
      ),
      v_now
    );
  end if;

  return to_jsonb(v_new_record);
end;
$$;

-- Secure execution privileges
revoke all on function public.update_incident_with_audit(uuid, uuid, text, text, uuid, boolean, boolean, integer, text, text) from public, anon, authenticated;
grant execute on function public.update_incident_with_audit(uuid, uuid, text, text, uuid, boolean, boolean, integer, text, text) to service_role;

