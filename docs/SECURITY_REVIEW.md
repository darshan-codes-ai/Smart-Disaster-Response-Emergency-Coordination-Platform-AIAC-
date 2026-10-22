# RescueGrid — Comprehensive Security Review & Audit

> **Authentication Model, RBAC Matrix, Row Level Security, Stored Procedure Protections, and Secret Sanitization.**

---

## 1. Authentication & Identity Verification Model

RescueGrid uses Supabase GoTrue Auth as its identity provider combined with FastAPI bearer token verification:

1. **Bearer Token Transmission:**
   - Every protected request from the client carries an `Authorization: Bearer <jwt>` header.
   - If the header is missing, malformed, or does not start with `Bearer `, FastAPI responds with `HTTP 401 Unauthorized`.

2. **Server-Side Token Verification:**
   - The backend validates the JWT with Supabase Auth:
     ```python
     user_res = supabase.auth.get_user(token)
     ```
   - This cryptographic validation verifies that the token was signed by Supabase, is not expired, and has not been revoked.

3. **Profile & Provenance Binding:**
   - After validating the auth user ID (`auth.users.id`), the backend queries `public.profiles` using the service role client to fetch the user's operational role and display name.
   - The user cannot spoof or alter their role in the JWT payload; their operational role is always derived authoritative from the database profile.

---

## 2. Role-Based Access Control (RBAC) Matrix

RescueGrid enforces a strict, multi-tiered authorization matrix across 6 defined user roles:

| Action / Endpoint | Citizen | Responder | Command Center | Admin | Hospital | Shelter |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`POST /incidents` (Report incident)** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **`GET /incidents` (List incidents)** | Own only | All | All | All | All | All |
| **`GET /incidents/{id}` (View details)**| Own only | All | All | All | All | All |
| **`PATCH /incidents/{id}` (Status: verified)** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Status: assigned)** | ❌ | ❌ | Auto on assign | Auto on assign | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Status: in_progress)** | ❌ | Assigned only | ✅ | ✅ | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Status: resolved)** | ❌ | Assigned only | ✅ | ✅ | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Status: cancelled)** | Own only | ❌ | ✅ | ✅ | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Assign responder)** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Unassign responder)**| ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **`PATCH /incidents/{id}` (Update notes)** | Own only | Assigned only | ✅ | ✅ | ❌ | ❌ |
| **`GET /incidents/{id}/events` (Audit log)** | Own only | All | All | All | All | All |
| **`GET /responders` (Dispatch registry)** | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

### Key Authorization Hardening Measures

- **Hospital & Shelter Isolation:** Explicitly rejected from filing incident mutations or browsing the responder workforce registry. Their role is reserved for medical capacity and shelter resource coordination.
- **Citizen Data Privacy:** Citizens are blocked at the database and API query levels from observing other citizens' emergency reports or timeline entries.
- **Responder Scope Limiting:** Responders may only modify status and add notes to incidents assigned to them (`assigned_to == auth.uid()`).

---

## 3. Database Row Level Security (RLS) & Browser Write Lockdown

### Direct Browser Write Lockdown (Phase 5.4)

In client-side architectures, users could theoretically invoke Supabase JS SDK methods (`supabase.from('incidents').insert(...)` or `.delete()`) directly from browser developer consoles.

RescueGrid eliminates this attack surface via migration `20261012_phase5_4_lock_down_browser_write_privileges.sql`:

```sql
-- Revoke browser client mutation privileges
REVOKE INSERT, UPDATE, DELETE ON public.incidents FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.incident_events FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated, anon;
```

**Result:**
All create, update, and delete actions MUST pass through the FastAPI backend API using the trusted backend service role. Any attempt to modify data directly from the client browser fails with PostgreSQL permission denial.

### Table Policies Summary

1. **`public.incidents`:**
   - `SELECT`: Citizens can select rows where `user_id = auth.uid()`. Operational roles can select all rows.
   - `INSERT / UPDATE / DELETE`: Bypassed only by backend service role.

2. **`public.incident_events`:**
   - `SELECT`: Operational roles (`command_center`, `admin`, `responder`, `hospital`, `shelter`) can view all audit records. Citizens can only select events where the parent incident belongs to them (`incidents.user_id = auth.uid()`).
   - `INSERT`: Strictly restricted to backend transactional stored procedures.
   - `UPDATE / DELETE`: Never permitted under any circumstance (append-only ledger).

3. **`public.profiles`:**
   - `SELECT`: Authenticated users can view responder and operational profiles for display.
   - `UPDATE`: Role privilege elevation is strictly protected; only backend administrative procedures can alter role assignments.

---

## 4. Stored Procedure & Transaction Security

Direct multi-table mutations (e.g. updating an incident and then inserting an audit event) in web application code are vulnerable to partial failures (e.g., database timeout or process termination after incident update but before audit record insert).

RescueGrid guarantees transactional integrity using PostgreSQL stored procedures:
- `create_incident_with_audit(p_incident jsonb, p_actor_id uuid, p_actor_name text, p_actor_role text)`
- `update_incident_with_audit(p_incident_id uuid, p_actor_id uuid, p_status text, p_note text, p_assigned_to uuid, p_has_assignment_change boolean, p_has_note_change boolean, p_priority_score integer, p_actor_name text, p_actor_role text)`

### Security Guarantees:
1. **Atomic Execution:** Incident updates and audit log entries are wrapped in a single database transaction. If the audit log fails, the entire transaction rolls back automatically.
2. **Deterministic Locking:** The procedure executes `SELECT ... FOR UPDATE` on the incident row, preventing race conditions during concurrent dispatcher updates.
3. **Audit Retention Hardening:** Migration `20261012_phase5_3_audit_integrity_and_retention.sql` changes the foreign key constraint to `ON DELETE RESTRICT`. An incident with associated audit records cannot be deleted.

---

## 5. Audit Logging Integrity & Sensitive Secret Sanitization

Audit records must never inadvertently expose authentication tokens, API keys, or personal credentials.

The backend implements recursive metadata sanitization in `sanitize_audit_metadata()`:

```python
SENSITIVE_AUDIT_KEYS = {
    "token", "access_token", "refresh_token", "password",
    "secret", "bearer", "authorization", "key", "api_key",
    "service_role", "credential", "session", "cookie"
}
```

- Any metadata key containing these substrings (case-insensitively) is replaced with `"[REDACTED]"`.
- Sanitization recursively inspects nested dictionaries and lists before stored procedure serialization.
- Unit tests (`test_audit_metadata_sanitizes_sensitive_secrets`) verify complete redaction of access tokens and passwords.

---

## 6. Input Validation & Defenses

1. **Pydantic Schemas:**
   - `Location`: strictly validates latitude (`-90.0 <= lat <= 90.0`) and longitude (`-180.0 <= lng <= 180.0`).
   - `IncidentCreate`: enforces non-empty strings and bounds lengths (`description <= 2000 chars`, `type <= 100 chars`, `severity` clamped 1 to 5).
   - `IncidentUpdate`: rejects empty bodies (`HTTP 400 No fields provided for update`) and validates status enums against `ALLOWED_INCIDENT_STATUSES`.

2. **CORS Restrictions:**
   - Origins are restricted via `ALLOWED_ORIGINS` environment variable.
   - HTTP methods are locked down to `["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]`.
   - Credentials mode is enabled for secure cookie/token session transfers.

