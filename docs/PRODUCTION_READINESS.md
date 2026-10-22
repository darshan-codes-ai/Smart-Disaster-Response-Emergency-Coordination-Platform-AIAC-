# RescueGrid — Production Readiness, Deployment & Operations Guide

> **System Architecture, Budget-Friendly Cloud Deployment, Migration Runbooks, and Operational Procedures.**

---

## 1. System Architecture Overview

RescueGrid (Smart Disaster Response & Emergency Coordination Platform) is engineered as a modern, decoupled, multi-role distributed system designed for high availability and low latency during critical emergency operations.

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

### Core Architecture Components

1. **Frontend (Next.js App Router, React 19, TypeScript, Tailwind CSS)**
   - Single-page command and dispatch interfaces (`/command`, `/responder`, `/incidents`).
   - MapLibre GL with OpenStreetMap raster tiles for offline/open GIS visualization.
   - Dual Supabase Client:
     - Browser client (`@supabase/ssr` / `@supabase/supabase-js`) handles user authentication state and subscribes to Realtime WebSocket feeds (`supabase_realtime` publication).
     - REST API Client communicates with the FastAPI backend for all mutation operations (incident creation, status advancement, responder assignment, notes). Direct database writes from browsers are strictly disabled.

2. **Backend (FastAPI, Python 3.11+, Uvicorn)**
   - Stateless ASGI web service enforcing application-layer RBAC, coordinate validation, and business logic.
   - Smart Priority Engine computes an explainable 1-100 priority score factoring hazard type, severity, operational status, and real-time incident aging.
   - Transactional mutations execute via PostgreSQL stored procedures (`create_incident_with_audit`, `update_incident_with_audit`) ensuring atomic consistency between incident rows and immutable audit events.
   - Audit logging recursively redacts sensitive credentials (tokens, bearer headers, passwords, keys).

3. **Database & Realtime (Supabase PostgreSQL 15+)**
   - Tables: `incidents`, `incident_events`, `profiles`.
   - Security: Row Level Security (RLS) enabled on all public tables with strict tenant isolation and operational role access.
   - Event Stream: Changes to `incidents` and `incident_events` stream in sub-second intervals to connected dispatcher consoles via PostgreSQL CDC (Change Data Capture) websockets.

---

## 2. Recommended Budget-Conscious Cloud Hosting

RescueGrid is designed to operate reliably within generous free and low-cost developer tiers without sacrificing security or scalability.

| Component | Recommended Host | Plan | Monthly Cost | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Database & Auth** | [Supabase](https://supabase.com) | Free Tier | \$0 | 500 MB PostgreSQL, 50,000 MAUs, 200 concurrent Realtime connections, automated backups. |
| **Frontend** | [Vercel](https://vercel.com) | Hobby Tier | \$0 | Native Next.js App Router edge hosting, automatic SSL, global CDN, instant GitHub CI/CD. |
| **Backend API** | [Render](https://render.com) | Free / Starter | \$0 - \$7 | Native Python ASGI runtime, automatic SSL, health check monitoring, GitHub CI integration. |
| **Alternative Backend** | [Railway](https://railway.com) | Hobby | ~\$5 usage | Zero-configuration Docker/Python deployment, persistent uptime without spin-down delay. |

> [!TIP]
> If deploying backend on Render's Free tier, free instances spin down after 15 minutes of inactivity. For emergency response situations where cold-start latency (30-50s) cannot be tolerated, upgrade the backend to Render's \$7/month Starter instance or Railway's continuous tier.

---

## 3. Database Migration Runbook

All database schema, security policies, and stored procedures are managed via versioned SQL scripts located in `supabase/migrations/`.

### Migration Execution Order

Apply migrations chronologically in the Supabase Dashboard SQL Editor or via Supabase CLI:

1. `supabase/migrations/20260906_phase3_auth.sql`
   - Initializes `public.profiles` table and role enums (`citizen`, `responder`, `command_center`, `admin`, `hospital`, `shelter`).
   - Installs trigger `handle_new_user` on `auth.users` to provision profiles on signup.
2. `supabase/migrations/20261002_milestone1_incident_status_and_rls.sql`
   - Creates `public.incidents` table and sets allowed statuses (`reported`, `verified`, `assigned`, `in_progress`, `resolved`, `cancelled`).
   - Configures base Row Level Security policies.
3. `supabase/migrations/20261002_milestone3_dispatch_and_assignment.sql`
   - Adds nullable `incidents.assigned_to` referencing `auth.users(id) ON DELETE SET NULL`.
   - Creates index `incidents_assigned_to_idx` for fast assignment queue filtering.
4. `supabase/migrations/20261011_phase5_1_incident_audit_history.sql`
   - Creates append-only `public.incident_events` table for persistent event auditing.
   - Enforces read access: citizens only see audit events for their own incidents; operational roles see all events.
5. `supabase/migrations/20261012_phase5_2_enable_incident_realtime.sql`
   - Adds `incidents` and `incident_events` to the `supabase_realtime` publication.
6. `supabase/migrations/20261012_phase5_3_audit_integrity_and_retention.sql`
   - Hardens audit retention: changes `incident_events_incident_id_fkey` constraint to `ON DELETE RESTRICT`.
   - Creates atomic stored procedure `public.update_incident_with_audit`.
7. `supabase/migrations/20261012_phase5_4_lock_down_browser_write_privileges.sql`
   - Revokes client browser `INSERT`, `UPDATE`, and `DELETE` permissions on `incidents`, `incident_events`, and `profiles`.
   - Ensures all data modifications originate strictly from the authenticated backend service role.
8. `supabase/migrations/20261012_phase5_5_optimize_rls_auth_initialization.sql`
   - Optimizes RLS evaluation performance with cached auth UID subqueries.
9. `supabase/migrations/20261022_phase6_transactional_note_clear_and_audit.sql`
   - Upgrades `update_incident_with_audit` with `p_has_note_change` flag to reliably support note clears and explicit note updates.

### Post-Migration Verification Queries

Execute the following SQL in Supabase SQL Editor to verify schema completeness:

```sql
-- 1. Verify all required tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('incidents', 'incident_events', 'profiles');

-- 2. Verify stored procedures exist
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('create_incident_with_audit', 'update_incident_with_audit');

-- 3. Verify Realtime publication has both tables
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';

-- 4. Verify RLS is enabled on all tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('incidents', 'incident_events', 'profiles');
```

---

## 4. Environment Variables Reference

### Backend (`backend/.env` or Host Environment)

| Variable | Description | Example / Default | Required in Production |
| :--- | :--- | :--- | :---: |
| `SUPABASE_URL` | Full URL of your Supabase Project | `https://xyz.supabase.co` | **Yes** |
| `SUPABASE_SECRET_KEY` | Supabase Service Role Key (secret) | `eyJhbGci...` | **Yes** |
| `SUPABASE_PUBLISHABLE_KEY`| Supabase Anon Key (public) | `eyJhbGci...` | No (falls back to service key) |
| `ALLOWED_ORIGINS` | Comma-delimited origins for CORS | `https://rescuegrid.vercel.app` | **Yes** |
| `ENVIRONMENT` | Runtime environment name | `production` | **Yes** |
| `PORT` | Web server listening port | `8000` | Optional (default 8000) |
| `ALLOW_LEGACY_MUTATION_FALLBACK` | Legacy non-transactional fallback | `false` | Set to `false` (enforced in prod) |

> [!CAUTION]
> Never commit `SUPABASE_SECRET_KEY` to Git or expose it to client browsers. The service role key bypasses PostgreSQL RLS and must only reside in the backend secure environment.

### Frontend (`frontend/.env.local` or Host Environment)

| Variable | Description | Example / Default | Required in Production |
| :--- | :--- | :--- | :---: |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase project URL | `https://xyz.supabase.co` | **Yes** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase anonymous client key | `eyJhbGci...` | **Yes** |
| `NEXT_PUBLIC_API_URL` | Root URL of the deployed FastAPI backend | `https://rescuegrid-api.onrender.com` | **Yes** |

---

## 5. Deployment Step-by-Step

### Deploying the Backend on Render

1. Log in to [Render](https://dashboard.render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository: `darshan-codes-ai/Smart-Disaster-Response-Emergency-Coordination-Platform-AIAC-`.
4. Configure service settings:
   - **Name:** `rescuegrid-backend`
   - **Root Directory:** `backend`
   - **Environment:** `Python 3`
   - **Build Command:** `pip install --upgrade pip && pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Under **Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `ALLOWED_ORIGINS` (set to your frontend Vercel URL, e.g. `https://rescuegrid.vercel.app`)
   - `ENVIRONMENT` = `production`
   - `ALLOW_LEGACY_MUTATION_FALLBACK` = `false`
6. Click **Create Web Service**.
7. Once deployed, verify `https://<render-url>/health` returns `{"status":"healthy","database":"connected"}`.

### Deploying the Frontend on Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New...** -> **Project**.
3. Import your GitHub repository.
4. Configure project settings:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** `frontend`
5. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_URL` (the Render backend URL from the previous step)
6. Click **Deploy**.

---

## 6. Operational Health Checks & Monitoring

The backend exposes standard health and diagnostic endpoints for uptime monitoring services (e.g. BetterStack, UptimeRobot, Render Health Check):

- **`GET /`**
  - Lightweight system metadata and running message.
  - Returns `{"status":"online", "message":"Smart Disaster Response API is running", ...}`.
- **`GET /health`**
  - Deep dependency check verifying live PostgreSQL query execution via Supabase client.
  - Returns HTTP 200 with `{"status":"healthy", "database":"connected"}` on success.
  - Returns HTTP 503 with `{"status":"unhealthy", "database":"disconnected"}` on failure.
- **`GET /health/live`**
  - Container / process liveness probe. Returns HTTP 200 immediately without hitting third-party network services.

---

## 7. Incident Response & Troubleshooting Runbook

### Issue: Incident status does not change in real-time on dispatcher screen
1. Inspect browser console for WebSocket disconnection errors (`wss://...supabase.co/realtime/v1/websocket`).
2. Verify Supabase Realtime publication includes `incidents`:
   ```sql
   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   ```
3. If missing, run `ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;`.

### Issue: Backend returns 500 "Incident update and audit logging failed"
1. This indicates the PostgreSQL stored procedure `update_incident_with_audit` encountered an error and rolled back the transaction.
2. Check Supabase PostgreSQL logs under **Database** -> **Logs** -> **Postgres Logs**.
3. Verify that migration `20261022_phase6_transactional_note_clear_and_audit.sql` is applied so that `p_has_note_change` parameter is recognized.
4. Verify that the actor's profile exists in `public.profiles`.

