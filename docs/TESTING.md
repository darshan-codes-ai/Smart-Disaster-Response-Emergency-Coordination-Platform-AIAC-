# RescueGrid — Quality Assurance & Testing Guide

> **Test Suites, Execution Commands, Coverage Matrices, and Automated CI/CD Gates.**

---

## 1. Quality Assurance Overview

RescueGrid enforces a multi-layered quality assurance methodology across backend and frontend stacks:

```text
+-------------------------------------------------------------+
|                     CI Quality Gate                         |
|  - Git Conflict Marker Verification                         |
|  - Python Backend Unit Tests (93 tests)                     |
|  - Node.js Frontend Unit Tests (5 tests)                    |
|  - ESLint Static Analysis                                   |
|  - Next.js Production Build & TypeScript Typecheck          |
+-------------------------------------------------------------+
```

---

## 2. Running Backend Tests

The backend test suite is built on Python's native `unittest` framework and uses FastAPI's `TestClient` with isolated dependency overrides and mock interfaces.

### Prerequisites

Activate the backend virtual environment:

```powershell
# Windows PowerShell
.\backend\venv\Scripts\Activate.ps1

# Linux / macOS
source backend/venv/bin/activate
```

### Run All Backend Tests

```bash
python -m unittest discover -s backend/tests -p "test_*.py" -v
```

### Test Suite Breakdown (93 Tests Total)

1. **`backend/tests/test_api.py` (76 Tests):**
   - **Authentication & RBAC:** Verifies token extraction, 401 on missing tokens, role enforcement for citizen, responder, command center, admin, hospital, shelter.
   - **Citizen Privacy:** Proves citizens receive only their own incidents in `GET /incidents` and `GET /incidents/{id}`, and cannot modify other citizens' records.
   - **Incident Mutation Workflow:** Verifies valid transitions (`reported` -> `verified` -> `assigned` -> `in_progress` -> `resolved` / `cancelled`), and rejects illegal status leaps.
   - **Responder Assignment & Dispatch:** Verifies assignment syntax validation (valid UUIDs), responder role verification, auto-transition to `assigned`, and status reversion to `verified` upon unassignment.
   - **Smart Priority Engine:** Verifies base severity calculation, hazard multipliers (medical emergency, collapse, fire = +25), status urgency, and dynamic time aging.
   - **Audit Event Logging:** Verifies transactional RPC parameter generation for `create_incident_with_audit` and `update_incident_with_audit`.
   - **Secret Sanitization:** Verifies sensitive credential keys (`token`, `password`, `key`) are redacted from audit metadata.

2. **`backend/tests/test_phase6_reliability.py` (17 Tests):**
   - **Input Validation:** Verifies missing `location`, `type`, `description`, or invalid coordinate bounds return HTTP 422 with precise validation error paths.
   - **Empty Payload Protection:** Confirms empty PATCH bodies return HTTP 400.
   - **Invalid Status Enums:** Verifies non-existent statuses return HTTP 400 with a list of allowed values.
   - **Missing Resource Handling:** Tests HTTP 404 on non-existent incident IDs.
   - **Hospital / Shelter Restrictions:** Tests strict denial of incident creation and dispatch queue visibility for medical and shelter accounts.
   - **Liveness & Health Probes:** Validates `/` and `/health` output structure and HTTP status codes.

---

## 3. Running Frontend Tests

Frontend unit tests verify workflow transition logic, status badge mappings, and next-recommended-status predictions.

### Run Frontend Unit Tests

```bash
npm --prefix frontend test
```

### Test Coverage (`frontend/tests/status-workflow.test.ts`):
- `IncidentStatus: ALLOWED_STATUSES`: Confirms all 6 lifecycle statuses are present.
- `IncidentStatus: STATUS_WORKFLOW_SEQUENCE`: Verifies proper operational progression order.
- `getStatusConfig`: Confirms valid badge variants, icons, and styling for every status.
- `getStatusConfig (edge cases)`: Gracefully handles `null`, `undefined`, and mixed case inputs.
- `getNextRecommendedStatus`: Accurately predicts the next logical command center action.

---

## 4. Running Frontend Linting & Production Build

### Run ESLint

```bash
npm --prefix frontend run lint
```

### Run Production Build & TypeScript Verification

```bash
npm --prefix frontend run build
```

This compiles all pages under Next.js App Router Turbopack, verifies TypeScript types with zero errors, and generates optimized production output for:
- `/` (Home landing page)
- `/command` (Command center operations console)
- `/responder` (Mobile-responsive responder dispatch console)
- `/incidents` (Incident reporting & tracking)
- `/login` (Unified authentication)

---

## 5. Git Merge Conflict Marker Check

An automated check scans the entire repository (excluding `node_modules`, `.git`, `.venv`) to prevent unresolved Git conflict markers from entering production:

```bash
python scripts/check_conflict_markers.py
```

Scans for patterns:
- `<<<<<<<`
- `=======`
- `>>>>>>>`
- `|||||||`

---

## 6. Continuous Integration (GitHub Actions)

RescueGrid includes an automated GitHub Actions workflow at `.github/workflows/ci.yml`.

On every `push` and `pull_request` to `main`, the CI runner executes:
1. **Conflict Marker Check:** Runs `scripts/check_conflict_markers.py`.
2. **Backend Test Suite:** Installs `backend/requirements.txt` on Python 3.11 and runs all 93 unit tests.
3. **Frontend Pipeline:** Runs `npm install`, `npm test`, `npm run lint`, and `npm run build` on Node.js 20.

