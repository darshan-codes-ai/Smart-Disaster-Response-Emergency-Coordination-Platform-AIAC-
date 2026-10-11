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

### How to Apply Migrations

#### Option A: Supabase Dashboard (Recommended for Managed Cloud)
1. Open your Supabase Project Dashboard.
2. Navigate to the **SQL Editor**.
3. Open the migration file (e.g. `supabase/migrations/20261011_phase5_1_incident_audit_history.sql`).
4. Paste and click **Run**.

#### Option B: Supabase CLI
```bash
# Push pending migrations to the linked remote database
supabase db push
```

---

## 🔒 Audit History API & Security Model (Phase 5.1)

- **Audit Logging Triggers**: Automatically records audit records during incident creation, responder assignments/unassignments, status transitions, and field note updates.
- **Actor Provenance**: `actor_id` is derived exclusively from the verified JWT claims (`current_user["id"]`) on the backend. Client payloads cannot spoof or override `actor_id`.
- **Query Endpoint**: `GET /incidents/{incident_id}/events`
  - Deterministic sort: `created_at DESC, id DESC`.
  - Bounded pagination: `limit` (clamped 1–100, default 50), `offset` (clamped >= 0).
  - RBAC Enforcement: Unauthorized citizens attempting to query audit events for another citizen's incident receive `403 Forbidden`.
  - Enriched metadata: Automatically resolves actor display names and operational roles.
