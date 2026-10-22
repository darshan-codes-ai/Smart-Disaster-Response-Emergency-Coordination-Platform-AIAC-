# 🚨 RescueGrid — Smart Disaster Response & Emergency Coordination Platform

> **AI-assisted real-time disaster reporting, prioritization, triage, and multi-role emergency coordination platform.**

RescueGrid connects **citizens, emergency responders, command center dispatchers, hospital staff, shelter coordinators, and administrators** into a unified, secure, real-time command operations platform.

During floods, earthquakes, structural collapses, fires, cyclones, and medical crises, RescueGrid provides sub-second situational awareness, deterministic 1-100 incident priority ranking, MapLibre GIS visualization, and an immutable, transactionally consistent audit history.

---

## 📚 Documentation Index

- **[Production Readiness & Deployment Runbook](docs/PRODUCTION_READINESS.md)** — Cloud hosting (Render/Vercel/Supabase), step-by-step migration guide, environment setup, and operational troubleshooting.
- **[Security Review & RBAC Architecture](docs/SECURITY_REVIEW.md)** — JWT authentication, 6-role RBAC matrix, Row Level Security, browser write lockdown, and secret sanitization.
- **[Testing & Reliability Assurance](docs/TESTING.md)** — Comprehensive guide for running the 93 backend unit tests, frontend workflow tests, ESLint, TypeScript verification, and CI quality gates.

---

## 🏛️ System Architecture

```text
                               +------------------------------------------+
                               |              Clients / Web               |
                               |   Next.js App Router (React 19 / TS)     |
                               +--------------------+---------------------+
                                                    |
                         +--------------------------+--------------------------+
                         | (REST APIs with JWT)                                | (Direct Supabase SDK:
                         |                                                     |  Auth + Realtime WS)
                         v                                                     v
+--------------------------------------------------+        +-----------------------------------+
|               FastAPI Backend                    |        |         Supabase Platform         |
|  - Role-based authorization & validation         |        |  - Supabase Auth (GoTrue JWT)     |
|  - Smart Priority 1-100 deterministic scoring    |        |  - Supabase Realtime (Postgres CDC|
|  - Sensitive secret metadata sanitization        |        |    WebSocket broadcast)           |
|  - PostgreSQL Transactional Stored Procedures:   |        +-----------------+-----------------+
|      * create_incident_with_audit                |                          ^
|      * update_incident_with_audit                |                          |
+------------------------+-------------------------+                          |
                         | (Service-Role Connection)                          |
                         +----------------------------------------------------+
                                                    |
                                                    v
                               +------------------------------------------+
                               |          Supabase PostgreSQL             |
                               |  - public.incidents                      |
                               |  - public.incident_events (Audit log)    |
                               |  - public.profiles (RBAC & responder dir)|
                               |  - Row Level Security (RLS) enforcement  |
                               +------------------------------------------+
```

---

## 🎯 Key Capabilities

1. **Deterministic Smart Priority Engine (1–100 Score):**
   - **Base Severity:** Level 1 (10) to Level 5 (50).
   - **Hazard Urgency:** Medical Emergency (+25), Building Collapse (+25), Fire (+25), Flood (+15), Cyclone (+15), Earthquake (+15).
   - **Operational Urgency:** Reported (+15), Verified (+10), Assigned (+5), In Progress (0), Resolved (0).
   - **Dynamic Aging:** Unassigned and unresolved incidents gain +2 score points per hour of waiting (capped at +10).
2. **ACID Transactional Auditing:**
   - Incident creations and updates execute inside PostgreSQL stored procedures (`create_incident_with_audit`, `update_incident_with_audit`).
   - Incident records and their associated audit events are written atomically. If audit logging fails, the transaction aborts cleanly with no uncommitted state.
   - Audit metadata recursively redacts sensitive credentials (tokens, passwords, keys).
3. **Browser Write Lockdown (Phase 5.4):**
   - Direct browser `INSERT`, `UPDATE`, and `DELETE` privileges on public tables are revoked.
   - All mutations originate exclusively from the authenticated FastAPI backend via the service role.
4. **Real-Time Telemetry & Geospatial GIS:**
   - MapLibre GL with OpenStreetMap raster tiles for instant incident mapping.
   - Supabase Realtime WebSocket subscriptions push immediate status transitions, assignments, and audit events to command center consoles without manual polling.

---

## 🗄️ Database Migrations (Supabase)

RescueGrid uses versioned SQL migrations in `supabase/migrations/`. Apply in chronological order:

1. `20260906_phase3_auth.sql` — Profiles schema, user triggers, and role enum (`citizen`, `responder`, `command_center`, `admin`, `hospital`, `shelter`).
2. `20261002_milestone1_incident_status_and_rls.sql` — Incidents schema, lifecycle statuses, base RLS.
3. `20261002_milestone3_dispatch_and_assignment.sql` — Nullable `incidents.assigned_to` referencing `auth.users(id)` and dispatch index.
4. `20261011_phase5_1_incident_audit_history.sql` — Append-only `incident_events` table and RLS policies.
5. `20261012_phase5_2_enable_incident_realtime.sql` — Supabase Realtime publication setup for incidents and events.
6. `20261012_phase5_3_audit_integrity_and_retention.sql` — `ON DELETE RESTRICT` foreign keys and transactional `update_incident_with_audit` procedure.
7. `20261012_phase5_4_lock_down_browser_write_privileges.sql` — Revocation of browser client write permissions.
8. `20261012_phase5_5_optimize_rls_auth_initialization.sql` — Performance optimization for RLS authentication checks.
9. `20261022_phase6_transactional_note_clear_and_audit.sql` — Explicit note change flags supporting clears (`note_cleared`) and updates.

---

## 🛡️ Role-Based Access Control (RBAC) Matrix

| Operation | `citizen` | `responder` | `command_center` | `admin` | `hospital` | `shelter` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `POST /incidents` | ✅ | ✅ | ✅ | ✅ | ❌ (403) | ❌ (403) |
| `GET /incidents` | Own only | All | All | All | All | All |
| `GET /incidents/{id}` | Own only (403 other) | All | All | All | All | All |
| `PATCH /incidents/{id}` (Status) | Cancel own only | Assigned only (`in_progress`, `resolved`) | All valid | All valid | ❌ (403) | ❌ (403) |
| `PATCH /incidents/{id}` (Assign) | ❌ (403) | ❌ (403) | ✅ | ✅ | ❌ (403) | ❌ (403) |
| `PATCH /incidents/{id}` (Note) | Own only | Assigned only | ✅ | ✅ | ❌ (403) | ❌ (403) |
| `GET /incidents/{id}/events` | Own only (403 other) | All | All | All | All | All |
| `GET /responders` | ❌ (403) | ❌ (403) | ✅ | ✅ | ❌ (403) | ❌ (403) |
| `GET /me` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 🚀 Quickstart & Local Development

### 1. Backend Setup

```bash
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1    # On Linux/macOS: source venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env

# Start FastAPI server
uvicorn main:app --reload --port 8000
```

- API Base: `http://localhost:8000`
- Interactive Swagger Docs: `http://localhost:8000/docs`
- Health Probe: `http://localhost:8000/health`

### 2. Frontend Setup

```bash
cd frontend
npm install

# Configure environment
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

# Start Next.js development server
npm run dev
```

- Web UI: `http://localhost:3000`
- Command Center: `http://localhost:3000/command`
- Responder Console: `http://localhost:3000/responder`

---

## 🧪 Verification & Testing

### Run All 93 Backend Unit & Security Tests
```bash
.\backend\venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py" -v
```

### Run Frontend Unit Tests
```bash
npm --prefix frontend test
```

### Run ESLint & Next.js Production Build
```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

### Run Git Conflict Marker Check
```bash
python scripts/check_conflict_markers.py
```
