# Phase 6: Testing, Reliability, Quality Assurance, and Regression Prevention

This document provides the complete testing architecture, test plans, automated test suite reference, execution instructions, and actual verification results for **RescueGrid** (Smart Disaster Response & Emergency Coordination Platform).

---

## 1. Testing Strategy

The RescueGrid quality assurance strategy uses a multi-tier defense model designed for mission-critical disaster response:

```
┌────────────────────────────────────────────────────────────────┐
│                   E2E Realtime & Manual QA                     │
│  - Multi-session browser coordination (Command Center + Map)   │
│  - Supabase Realtime websocket subscriptions (POSTGRES_CHANGES)│
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────┴────────────────────────────────┐
│                 Frontend Verification & Static QA              │
│  - Next.js 16.3 Production Build (Turbopack)                   │
│  - TypeScript 5 strict type validation (`tsc --noEmit`)        │
│  - ESLint 9 code quality & React 19 hook audits                │
│  - Native Node 24 unit test suite (`node:test`) for state logic│
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────┴────────────────────────────────┐
│                  Backend Test Suite (FastAPI)                  │
│  - Python `unittest` & FastAPI `TestClient` (93 test cases)    │
│  - Isolated mocks for Supabase database & auth endpoints       │
│  - Resilient dual-path architecture (Transactional RPC + ACID  │
│    compensating table rollback)                                │
│  - Server-side RBAC enforcement across 6 role boundaries       │
│  - Audit log integrity, metadata sanitization, and retention   │
└────────────────────────────────────────────────────────────────┘
```

### Core Testing Principles
1. **Zero Credential Dependency for Unit Tests**: Ordinary unit and security tests mock Supabase database operations, ensuring tests are deterministic, offline-capable, and do not mutate production data.
2. **Dual-Path Resiliency Verification**: The backend validates both the primary transactional PostgreSQL RPC functions (`create_incident_with_audit`, `update_incident_with_audit`) and the compensating rollback fallback mechanism.
3. **Strict Authorization Boundaries**: Role permissions are enforced server-side. Citizens, responders, coordinators, hospitals, and shelters have hardcoded access boundaries tested against unauthorized privilege escalation.
4. **Data Sanitization & Secret Isolation**: Tests verify that sensitive authentication tokens, passwords, and API keys are stripped from audit history payloads prior to persistence.

---

## 2. Test Directory Structure

```text
smart-disaster-response/
├── backend/
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_api.py                 # Core API, RBAC, Dispatch, and Priority test suite (76 tests)
│   │   └── test_phase6_reliability.py  # Phase 6 Reliability, Input Validation, RPC, & Audit (17 tests)
├── frontend/
│   ├── tests/
│   │   └── status-workflow.test.ts     # Operational state machine & badge styling tests (5 tests)
├── supabase/
│   └── migrations/                     # Versioned PostgreSQL schema & RLS definitions
└── docs/
    └── PHASE_6_TESTING.md              # Test strategy and execution guide (this file)
```

---

## 3. Required Environment Variables (By Name Only)

Tests do **not** require production credentials to execute. For staging or live deployment runs, the following environment variables are required:

### Backend (`backend/.env`)
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`)

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

> [!NOTE]
> All sensitive `.env` and `.env.*` files are explicitly excluded in `.gitignore` to prevent secret leakage.

---

## 4. Execution Commands (Windows PowerShell)

All commands are fully compatible with Windows PowerShell and the project virtual environment.

### A. Backend Unit & Regression Test Suites
```powershell
# Run all backend tests (93 tests across test_api.py and test_phase6_reliability.py)
.\backend\venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py" -v

# Run only Phase 6 Reliability tests
.\backend\venv\Scripts\python.exe -m unittest backend.tests.test_phase6_reliability -v

# Run original Milestone 1-5 Security & RBAC tests
.\backend\venv\Scripts\python.exe -m unittest backend.tests.test_api -v
```

### B. Frontend Automated Unit Tests
```powershell
# Run frontend unit tests via Node 24 native test runner
cd frontend
npm test
# Equivalent to: node --experimental-strip-types --test tests/status-workflow.test.ts
```

### C. Frontend ESLint
```powershell
cd frontend
npm run lint
```

### D. TypeScript Strict Type-Check
```powershell
cd frontend
npx tsc --noEmit
```

### E. Next.js Production Build
```powershell
cd frontend
npm run build
```

---

## 5. Automated Verification Results

| Test Category | Target Suite / Tool | Total Tests | Passed | Failed | Skipped | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Backend API & RBAC** | `backend/tests/test_api.py` | 76 | 76 | 0 | 0 | **PASS** |
| **Backend Reliability & RPC** | `backend/tests/test_phase6_reliability.py` | 17 | 17 | 0 | 0 | **PASS** |
| **Frontend Unit Tests** | `frontend/tests/status-workflow.test.ts` | 5 | 5 | 0 | 0 | **PASS** |
| **Frontend Static Quality** | ESLint 9 (`npm run lint`) | Full Tree | Pass | 0 | 0 | **PASS** |
| **Frontend Type Safety** | TypeScript 5 (`npx tsc --noEmit`) | Full Tree | Pass | 0 | 0 | **PASS** |
| **Production Build** | Next.js 16.3 (`npm run build`) | 8 Routes | Pass | 0 | 0 | **PASS** |

**Total Automated Test Count:** **98 tests** (93 Python backend tests + 5 Node.js frontend tests).  
**Overall Result:** **100% Passing (0 failures, 0 regressions).**

---

## 6. Manual Testing Checklist: Supabase Realtime Coordination

Real-time multi-client websocket testing requires live Supabase network connectivity. Use the following procedure to manually verify real-time incident synchronization between two independent authenticated sessions:

### Prerequisites
1. Ensure the Phase 5 Supabase migrations have been applied in your Supabase SQL editor:
   - `20261011_phase5_1_incident_audit_history.sql`
   - `20261012_phase5_2_enable_incident_realtime.sql`
   - `20261012_phase5_3_audit_integrity_and_retention.sql`
2. Start the FastAPI backend:
   ```powershell
   .\backend\venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
   ```
3. Start the Next.js frontend:
   ```powershell
   cd frontend
   npm run dev
   ```

### Step-by-Step Multi-Client Verification

1. **Window A (Command Center)**:
   - Open Chrome at `http://localhost:3000/login` and log in with a user having role `command_center` or `admin`.
   - Navigate to `/command`.
   - Verify the top-right header displays the green `LIVE` indicator.
   - Observe the live incident queue, tactical map, and Audit Log drawer.

2. **Window B (Citizen Reporter / Responder)**:
   - Open a private/incognito window at `http://localhost:3000/login` and log in with a `citizen` or `responder` account.
   - Go to `/incidents` (or file a report via the citizen interface).
   - Submit a new emergency incident:
     - Type: `Fire`
     - Severity: `4`
     - Description: `Realtime test fire near central plaza`
     - Location: Select on map.

3. **Verify Instant Synchronization in Window A**:
   - Without refreshing Window A:
     - The incident immediately appears at the top of the Command Center incident queue.
     - A high-contrast map marker appears on the tactical OpenStreetMap layer.
     - The "Activity" audit feed logs an `Incident Reported` event with timestamp.

4. **Verify Dispatch & Status Propagation**:
   - In Window A, select the incident and assign it to an active responder.
   - In Window B (logged in as that responder on `/responder`):
     - The incident immediately appears in their assigned workload.
   - In Window B, change the status to `In Progress` and add a field note: `"Units on scene"`.
   - In Window A:
     - The badge updates to `IN PROGRESS` in real time.
     - The field note is displayed in the incident detail pane.
     - An audit record `Field note added` is appended to the timeline.

---

## 7. Known Limitations & Security Considerations

1. **Transactional RPC Availability**:
   - When running against a Supabase database where migration `20261012_phase5_3_audit_integrity_and_retention.sql` has not yet been applied, the backend gracefully falls back to direct table mutations with compensating rollback. Applying the migration is recommended for full PostgreSQL ACID atomicity.
2. **Browser Write Lockdown**:
   - Migration `20261012_phase5_4_lock_down_browser_write_privileges.sql` revokes direct `INSERT`, `UPDATE`, and `DELETE` grants from `authenticated` and `anon` browser roles on `incidents` and `incident_events`. All incident mutations must pass through the authorized FastAPI backend.
3. **Actor Spoofing Prevention**:
   - All incident mutations strictly derive `actor_id` from the verified Supabase JWT bearer token claims (`current_user["id"]`). Client-supplied actor overrides are rejected.
4. **Audit History Retention**:
   - Foreign key constraints on `incident_events` use `ON DELETE RESTRICT`, preventing accidental or malicious cascading deletion of audit records when incident rows exist.

