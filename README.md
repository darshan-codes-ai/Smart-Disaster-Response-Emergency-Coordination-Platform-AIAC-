# 🚨 Smart Disaster Response & Emergency Coordination Platform (AIAC)

> **AI-assisted real-time disaster reporting, prioritization, and emergency coordination platform.**

AIAC (AI-Assisted Coordination) is a smart disaster response platform designed to connect **citizens, emergency responders, hospitals, shelters, volunteers, and command centers** through a unified system.

The platform enables citizens to report emergencies with their location and description, while emergency teams can monitor, prioritize, assign, and manage incidents from a centralized platform.

---

## 🎯 Problem Statement

During disasters such as floods, earthquakes, fires, cyclones, and other emergencies, information is often:

- Fragmented across different communication channels
- Delayed or difficult to verify
- Difficult to prioritize
- Poorly coordinated between emergency teams
- Missing accurate location information
- Difficult to manage at scale

These problems can lead to delayed response times and inefficient allocation of emergency resources.

---

## 💡 Proposed Solution

AIAC provides a unified emergency coordination platform that connects citizens with emergency response teams.

The platform follows a complete coordination workflow:

```text
Citizen Emergency Report
          ↓
    AI Classification
          ↓
 Severity & Priority
          ↓
   Emergency Queue
          ↓
 Responder Assignment
          ↓
   Live Response Status
          ↓
Hospital / Shelter Coordination
          ↓
     Command Center
```

---

## 🗄️ Database Migrations (Supabase)

RescueGrid uses Supabase PostgreSQL with Row Level Security (RLS) for multi-tenant security and operational coordination.

### Migration Files

Migrations are located in `supabase/migrations/` and should be applied in chronological order:

1. **`20260906_phase3_auth.sql`**
   - User profiles (`public.profiles`) with role-based access control (`role` enum: `citizen`, `responder`, `command_center`, `admin`, `hospital`, `shelter`).
   - Profile trigger on `auth.users` registration.
2. **`20261002_milestone1_incident_status_and_rls.sql`**
   - Incident status workflow validation and constraints (`reported`, `verified`, `assigned`, `in_progress`, `resolved`, `cancelled`).
   - Row Level Security policies for incident creation and status updates.
3. **`20261002_milestone3_dispatch_and_assignment.sql`**
   - Adds nullable `incidents.assigned_to` referencing `auth.users(id)` for responder dispatch.
   - Index `incidents_assigned_to_idx` for dispatch queue performance.
4. **`20261011_phase5_1_incident_audit_history.sql`**
   - Creates the append-only `incident_events` table for persistent incident audit logging.
   - Tracks: `incident_created`, `responder_assigned`, `responder_unassigned`, `status_changed`, `note_added`, `note_updated`.
   - Immutable security: Direct client `INSERT`, `UPDATE`, and `DELETE` are denied by RLS. Only the trusted backend service role writes events.
   - Multi-tenant privacy: Citizens can only query audit events for incidents they reported (`incidents.user_id = auth.uid()`); operational roles (`command_center`, `admin`, `responder`, `hospital`, `shelter`) have operational visibility.
   - High-performance composite indexes on `(incident_id, created_at desc, id desc)` and `actor_id`.
5. **`20261012_phase5_2_enable_incident_realtime.sql`**
   - Adds `public.incidents` and `public.incident_events` to the `supabase_realtime` publication.
   - Enables live websocket coordination for the Emergency Command Center.
6. **`20261012_phase5_3_audit_integrity_and_retention.sql`**
   - Audit retention hardening: alters foreign key constraint `incident_events_incident_id_fkey` to `ON DELETE RESTRICT` so that incidents with audit histories cannot be silently destroyed.
   - Atomic RPC function `public.update_incident_with_audit` executing incident updates and audit event writes in a single ACID PostgreSQL transaction.

### How to Apply Migrations

#### Option A: Supabase Dashboard (Recommended for Managed Cloud)
1. Open your Supabase Project Dashboard.
2. Navigate to the **SQL Editor**.
3. Open each migration file from `supabase/migrations/` in chronological order.
4. Paste and click **Run**.

#### Option B: Supabase CLI
```bash
# Push pending migrations to the linked remote database
supabase db push
```

---

## 🔒 Audit History API & Security Model (Phase 5)

### Audit Event Types & Semantics

| Event Type | Trigger | Previous State | New State | Metadata |
|---|---|---|---|---|
| `incident_created` | Citizen/Operator reports incident | `null` | `{status, type, severity, description, ...}` | `{actor_name, actor_role, action_label}` |
| `status_changed` | State transition occurs | `{status: old}` | `{status: new}` | `{actor_name, actor_role, action_label}` |
| `responder_assigned` | Dispatcher assigns responder | `{assigned_to: old}` | `{assigned_to: new, assigned_responder_name}` | `{actor_name, actor_role, assigned_responder_name, action_label}` |
| `responder_unassigned` | Dispatcher clears assignment | `{assigned_to: old}` | `{assigned_to: null}` | `{actor_name, actor_role, action_label}` |
| `note_added` | First operational note added | `{note: null}` | `{note: new_note}` | `{actor_name, actor_role, action_label}` |
| `note_updated` | Existing note updated | `{note: old_note}` | `{note: new_note}` | `{actor_name, actor_role, action_label}` |

- **Actor Provenance**: `actor_id` is derived exclusively from the verified JWT claims (`current_user["id"]`) on the backend. Client payloads cannot spoof or override `actor_id`.
- **Sensitive Data Scrubbing**: Audit metadata sanitizes all fields, stripping any `token`, `password`, `secret`, `bearer`, `authorization`, or `key` values before persistence.
- **Compensating Rollbacks**: If writing the audit record fails, compensating transactions immediately delete or revert the incident mutation, guaranteeing that the database never enters an un-audited state.
- **Query Endpoint**: `GET /incidents/{incident_id}/events`
  - Deterministic sort: `created_at DESC, id DESC`.
  - Bounded pagination: `limit` (clamped 1–100, default 50), `offset` (clamped >= 0).
  - RBAC Enforcement: Unauthorized citizens attempting to query audit events for another citizen's incident receive `403 Forbidden`.
  - Enriched metadata: Automatically resolves actor display names and operational roles.

---

## 🛡️ Role-Based Access Control (RBAC) Matrix

| Operation | `citizen` | `responder` | `command_center` | `admin` | `hospital` | `shelter` | Unauthenticated |
|---|---|---|---|---|---|---|---|
| `POST /incidents` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (401) |
| `GET /incidents` | Own only | All operational | All | All | All operational | All operational | ❌ (401) |
| `GET /incidents/{id}` | Own only (403 other) | All | All | All | All | All | ❌ (401) |
| `PATCH /incidents/{id}` (Status) | Cancel own only | Own assigned (`in_progress`, `resolved`) | All valid | All valid | ❌ (403) | ❌ (403) | ❌ (401) |
| `PATCH /incidents/{id}` (Assign) | ❌ (403) | ❌ (403) | ✅ | ✅ | ❌ (403) | ❌ (403) | ❌ (401) |
| `PATCH /incidents/{id}` (Note) | Own only | Own assigned only | ✅ | ✅ | ❌ (403) | ❌ (403) | ❌ (401) |
| `GET /incidents/{id}/events` | Own only (403 other) | All | All | All | All | All | ❌ (401) |
| `GET /responders` | ❌ (403) | ❌ (403) | ✅ | ✅ | ❌ (403) | ❌ (403) | ❌ (401) |
| `GET /me` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (401) |

---

## ⚡ Real-Time Coordination Verification (Phase 5.2)

### Verification Steps
1. **Enable Realtime Publication**: Run migration `20261012_phase5_2_enable_incident_realtime.sql` on your Supabase database.
2. **Open Command Center**: Log into the application as a `command_center` or `admin` user and navigate to `/command`.
3. **Verify Indicator**: Observe the top-right telemetry pill. It displays a green pulsing `LIVE` indicator once the Supabase Realtime channel is connected (`status === "SUBSCRIBED"`).
4. **Mutate in Another Window**: Report or update an incident in a separate browser window or via the Responder console (`/responder`).
5. **Observe Realtime Updates**:
   - The incident queue refreshes automatically without page reload.
   - If an incident is selected and the **Activity** tab is open, new audit events stream into the timeline instantly.
   - The geospatial MapLibre map refreshes markers automatically.
6. **Fallback Mode**: If network connectivity interrupts the websocket connection, the UI automatically falls back to background polling (15s interval) and updates the indicator to `POLL`.

---

## ⚙️ Environment Configuration

Ensure the following environment variables are configured (do not commit actual secret keys):

### Backend (`.env` or environment):
```ini
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SECRET_KEY=<your-service-role-secret-key>
PORT=8000
```

### Frontend (`frontend/.env.local`):
```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-publishable-anon-key>
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## 🧪 Automated Testing

### Backend Unit & Security Test Suite (76 Tests)
```bash
# Run full test suite with virtual environment
backend\venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py" -v
```

### Frontend Typecheck, Lint & Production Build
```bash
cd frontend
npm run lint
npm run build
```
