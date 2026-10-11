import os
import json
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client


# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")
SUPABASE_PUBLISHABLE_KEY = (
    os.getenv("SUPABASE_PUBLISHABLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or SUPABASE_SECRET_KEY
)

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL is missing. Check backend/.env")

if not SUPABASE_SECRET_KEY:
    raise RuntimeError("SUPABASE_SECRET_KEY is missing. Check backend/.env")


# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
)


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="Smart Disaster Response API",
    description="Backend API for the RescueGrid Disaster Response Platform",
    version="1.3.0"
)


# ============================================================
# CORS
# ============================================================

ALLOWED_ORIGINS_ENV = os.getenv("ALLOWED_ORIGINS")
if ALLOWED_ORIGINS_ENV:
    allowed_origins = [
        origin.strip() for origin in ALLOWED_ORIGINS_ENV.split(",") if origin.strip()
    ]
else:
    allowed_origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# DATA MODELS
# ============================================================

ALLOWED_INCIDENT_STATUSES = {
    "reported",
    "verified",
    "assigned",
    "in_progress",
    "resolved",
    "cancelled",
}

OPERATIONAL_ROLES = {
    "responder",
    "command_center",
    "admin",
    "hospital",
    "shelter",
}

CITIZEN_ALLOWED_STATUSES = {
    "reported",
    "cancelled",
}


class Location(BaseModel):
    lat: float
    lng: float


class IncidentCreate(BaseModel):
    type: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=2000)
    location: Location
    severity: Optional[int] = Field(default=3, ge=1, le=5)


class IncidentUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = Field(default=None, max_length=2000)
    assigned_to: Optional[str] = Field(default=None, max_length=100)


# ============================================================
# SMART PRIORITY & ENRICHMENT
# ============================================================

def calculate_priority_score(
    severity: int,
    hazard_type: str,
    status: str,
    created_at: Optional[str] = None,
    assigned_to: Optional[str] = None,
    now: Optional[datetime] = None,
) -> int:
    """Calculate a deterministic, explainable 1-100 priority score.

    Base Severity:
    - severity 5 = 50
    - severity 4 = 40
    - severity 3 = 30
    - severity 2 = 20
    - severity 1 = 10

    Hazard urgency:
    - Medical Emergency = +25
    - Building Collapse = +25
    - Fire = +25
    - Flood = +15
    - Cyclone = +15
    - Earthquake = +15
    - Road Accident = +10
    - other = +10

    Status urgency:
    - reported = +15
    - verified = +10
    - assigned = +5
    - in_progress = 0
    - resolved = 0
    - cancelled = 0

    Time aging:
    - unresolved incidents that are not assigned gain +2 per hour
    - maximum aging contribution = +10

    Final score:
    - clamp between 1 and 100
    """
    # 1. Base Severity
    sev = severity if isinstance(severity, int) else 3
    if sev >= 5:
        base_sev = 50
    elif sev == 4:
        base_sev = 40
    elif sev == 3:
        base_sev = 30
    elif sev == 2:
        base_sev = 20
    else:
        base_sev = 10

    # 2. Hazard Urgency
    ht = (hazard_type or "").strip().lower()
    if "medical" in ht:
        hazard_score = 25
    elif "collapse" in ht:
        hazard_score = 25
    elif "fire" in ht:
        hazard_score = 25
    elif "flood" in ht:
        hazard_score = 15
    elif "cyclone" in ht or "storm" in ht or "hurricane" in ht:
        hazard_score = 15
    elif "earthquake" in ht:
        hazard_score = 15
    elif "accident" in ht:
        hazard_score = 10
    else:
        hazard_score = 10

    # 3. Status Urgency
    st = (status or "reported").strip().lower()
    if st == "reported":
        status_score = 15
    elif st == "verified":
        status_score = 10
    elif st == "assigned":
        status_score = 5
    elif st in {"in_progress", "resolved", "cancelled"}:
        status_score = 0
    else:
        status_score = 0

    # 4. Time Aging
    # unresolved incidents that are not assigned gain +2 per hour, max +10
    aging_score = 0
    if st not in {"resolved", "cancelled", "assigned"} and not assigned_to:
        if created_at:
            try:
                created_str = str(created_at).replace("Z", "+00:00")
                dt_created = datetime.fromisoformat(created_str)
                if dt_created.tzinfo is None:
                    dt_created = dt_created.replace(tzinfo=timezone.utc)
                current_dt = now or datetime.now(timezone.utc)
                elapsed_seconds = max(0.0, (current_dt - dt_created).total_seconds())
                hours = elapsed_seconds / 3600.0
                aging_score = min(10, max(0, int(hours * 2)))
            except Exception:
                aging_score = 0

    raw_score = base_sev + hazard_score + status_score + aging_score
    return max(1, min(100, raw_score))


def get_priority_tier(score: int) -> str:
    """Return human-readable priority tier."""
    if score >= 80:
        return "CRITICAL"
    elif score >= 60:
        return "HIGH"
    elif score >= 40:
        return "MEDIUM"
    else:
        return "LOW"


def enrich_incident_data(incident: dict, responder_lookup: Optional[dict] = None) -> dict:
    """Enrich incident with dynamic priority score, tier, and responder name."""
    inc = dict(incident)
    inc["priority_score"] = calculate_priority_score(
        severity=inc.get("severity") or 3,
        hazard_type=inc.get("type") or "other",
        status=inc.get("status") or "reported",
        created_at=inc.get("created_at"),
        assigned_to=inc.get("assigned_to"),
    )
    inc["priority_tier"] = get_priority_tier(inc["priority_score"])

    assigned_id = inc.get("assigned_to")
    if assigned_id and responder_lookup and str(assigned_id) in responder_lookup:
        inc["assigned_responder_name"] = responder_lookup[str(assigned_id)]
    elif "assigned_responder_name" not in inc:
        inc["assigned_responder_name"] = None

    return inc


def get_default_action_label(event_type: Optional[str], new_state: Optional[dict] = None) -> str:
    """Return a descriptive human-readable action label for an event type."""
    if event_type == "incident_created":
        return "Incident Reported"
    elif event_type == "responder_assigned":
        name = (new_state or {}).get("assigned_responder_name")
        return f"Assigned to {name}" if name else "Responder Assigned"
    elif event_type == "responder_unassigned":
        return "Responder Unassigned"
    elif event_type == "status_changed":
        st = (new_state or {}).get("status")
        return f"Status changed to {st}" if st else "Status Changed"
    elif event_type == "note_added":
        return "Field Note Added"
    elif event_type == "note_updated":
        return "Field Note Updated"
    return "Incident Updated"


def log_incident_event(
    incident_id: str,
    actor_id: Optional[str],
    event_type: str,
    previous_state: Optional[dict] = None,
    new_state: Optional[dict] = None,
    metadata: Optional[dict] = None,
    created_at: Optional[str] = None,
) -> Optional[dict]:
    """Record an immutable audit event for an incident.

    actor_id is always derived from authenticated user (never client input).
    """
    now = created_at or datetime.now(timezone.utc).isoformat()
    raw_meta = dict(metadata or {})
    if "action_label" not in raw_meta:
        raw_meta["action_label"] = get_default_action_label(event_type, new_state)

    # Sanitize metadata: strictly exclude any sensitive tokens or secrets
    sensitive_substrings = ("token", "password", "secret", "bearer", "authorization", "key")
    sanitized_meta = {
        str(k): v
        for k, v in raw_meta.items()
        if not any(sub in str(k).lower() for sub in sensitive_substrings)
    }

    event_record = {
        "id": str(uuid.uuid4()),
        "incident_id": incident_id,
        "actor_id": actor_id,
        "event_type": event_type,
        "previous_state": previous_state,
        "new_state": new_state,
        "metadata": sanitized_meta,
        "created_at": now,
    }
    try:
        res = (
            supabase
            .table("incident_events")
            .insert(event_record)
            .execute()
        )
        if res.data:
            return res.data[0]
        return event_record
    except Exception as exc:
        print(f"Warning: Failed to persist audit event {event_type} for incident {incident_id}: {exc}")
        return None


# ============================================================
# AUTHENTICATION / RBAC
# ============================================================

def get_current_user(authorization: Optional[str] = Header(default=None)):
    """Validate a Supabase access token and return the user's profile."""

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing access token")

    try:
        auth_response = supabase.auth.get_user(token)
        user = getattr(auth_response, "user", None)

        if user is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired access token",
            )

        user_id = getattr(user, "id", None)
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired access token",
            )

        email = getattr(user, "email", None)

        profile = None
        try:
            profile_response = (
                supabase
                .table("profiles")
                .select("role, full_name")
                .eq("id", user_id)
                .limit(1)
                .execute()
            )
            profile = profile_response.data[0] if profile_response.data else None
        except Exception as profile_error:
            print(f"Profile lookup unavailable for {user_id}: {profile_error}")

        return {
            "id": user_id,
            "email": email,
            "role": (profile.get("role") if profile else None) or "citizen",
            "full_name": profile.get("full_name") if profile else None,
        }

    except HTTPException:
        raise
    except Exception as exc:
        print(f"get_current_user error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Supabase authentication succeeded/was reached, but the user profile could not be loaded.",
        )


def require_roles(*allowed_roles: str):
    def role_dependency(current_user=Depends(get_current_user)):
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to perform this action"
            )
        return current_user

    return role_dependency


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
def root():
    return {
        "message": "Smart Disaster Response API is running",
        "database": "Supabase PostgreSQL",
        "status": "online"
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    try:
        supabase.table("incidents").select("id").limit(1).execute()
        return {
            "status": "healthy",
            "database": "connected"
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "status": "unhealthy",
            "database": "error",
            "detail": "Database connection unavailable"
        }


# ============================================================
# CURRENT USER
# ============================================================

@app.get("/me")
def get_me(current_user=Depends(get_current_user)):
    return current_user


# ============================================================
# GET RESPONDERS (COMMAND CENTER / ADMIN ONLY)
# ============================================================

@app.get("/responders")
def get_responders(
    current_user=Depends(require_roles("command_center", "admin"))
):
    try:
        response = (
            supabase
            .table("profiles")
            .select("id, full_name, role")
            .eq("role", "responder")
            .order("full_name")
            .execute()
        )
        responders = []
        for r in response.data or []:
            responders.append({
                "id": str(r["id"]),
                "full_name": r.get("full_name") or "Responder",
                "role": "responder"
            })
        return {"responders": responders}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="An internal database error occurred while retrieving responders"
        )


# ============================================================
# CREATE INCIDENT
# ============================================================

@app.post("/incidents")
def create_incident(
    incident: IncidentCreate,
    current_user=Depends(require_roles("citizen", "responder", "command_center", "admin"))
):
    incident_id = str(uuid.uuid4())
    severity = incident.severity or 3
    now = datetime.now(timezone.utc).isoformat()
    priority_score = calculate_priority_score(
        severity=severity,
        hazard_type=incident.type,
        status="reported",
        created_at=now,
        assigned_to=None
    )

    incident_data = {
        "id": incident_id,
        "user_id": current_user["id"],
        "type": incident.type,
        "description": incident.description,
        "latitude": incident.location.lat,
        "longitude": incident.location.lng,
        "severity": severity,
        "status": "reported",
        "priority_score": priority_score,
        "assigned_to": None,
        "note": None,
        "created_at": now,
        "updated_at": now
    }

    try:
        response = (
            supabase
            .table("incidents")
            .insert(incident_data)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=500,
                detail="Incident could not be created"
            )

        created_row = response.data[0]
        audit_res = log_incident_event(
            incident_id=incident_id,
            actor_id=current_user["id"],
            event_type="incident_created",
            previous_state=None,
            new_state={
                "status": "reported",
                "type": incident.type,
                "severity": severity,
                "description": incident.description,
                "latitude": incident.location.lat,
                "longitude": incident.location.lng,
            },
            metadata={
                "actor_name": current_user.get("full_name") or "Reporter",
                "actor_role": current_user.get("role") or "citizen",
                "action_label": "Incident Reported",
            },
            created_at=now,
        )

        if audit_res is None:
            # Compensating rollback: delete newly inserted incident so system never retains un-audited state
            try:
                supabase.table("incidents").delete().eq("id", incident_id).execute()
            except Exception as rb_exc:
                print(f"Warning: Compensating delete failed for incident {incident_id}: {rb_exc}")
            raise HTTPException(
                status_code=500,
                detail="Failed to persist incident audit log; transaction rolled back."
            )

        return {
            "message": "Incident created successfully",
            "incident": enrich_incident_data(created_row)
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="An internal database error occurred while creating the incident"
        )


# ============================================================
# GET INCIDENTS
# ============================================================

@app.get("/incidents")
def get_incidents(current_user=Depends(get_current_user)):
    import time

    last_error = None
    for attempt in range(3):
        try:
            client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
            query = client.table("incidents").select("*")
            if current_user.get("role") not in OPERATIONAL_ROLES:
                query = query.eq("user_id", current_user["id"])
            response = (
                query
                .order("created_at", desc=True)
                .execute()
            )

            raw_incidents = response.data or []
            assigned_ids = list({str(inc["assigned_to"]) for inc in raw_incidents if inc.get("assigned_to")})
            responder_lookup = {}
            if assigned_ids:
                try:
                    r_res = client.table("profiles").select("id, full_name").in_("id", assigned_ids).execute()
                    for r in r_res.data or []:
                        responder_lookup[str(r["id"])] = r.get("full_name")
                except Exception:
                    pass

            enriched_incidents = [
                enrich_incident_data(inc, responder_lookup) for inc in raw_incidents
            ]

            return {
                "count": len(enriched_incidents),
                "incidents": enriched_incidents
            }
        except Exception as e:
            last_error = e
            if attempt < 2:
                time.sleep(0.35 * (attempt + 1))

    import traceback
    traceback.print_exc()
    raise HTTPException(
        status_code=500,
        detail="An internal database error occurred while synchronizing incident records"
    )


# ============================================================
# GET SINGLE INCIDENT
# ============================================================

@app.get("/incidents/{incident_id}")
def get_incident(
    incident_id: str,
    current_user=Depends(get_current_user)
):
    if not incident_id or not incident_id.strip():
        raise HTTPException(status_code=400, detail="Incident ID cannot be empty")

    try:
        response = (
            supabase
            .table("incidents")
            .select("*")
            .eq("id", incident_id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

        incident = response.data[0]

        if (
            current_user.get("role") not in OPERATIONAL_ROLES
            and incident.get("user_id") != current_user.get("id")
        ):
            raise HTTPException(
                status_code=403,
                detail="You can only view your own incidents"
            )

        responder_lookup = {}
        assigned_id = incident.get("assigned_to")
        if assigned_id:
            try:
                r_res = supabase.table("profiles").select("id, full_name").eq("id", str(assigned_id)).limit(1).execute()
                if r_res.data:
                    responder_lookup[str(assigned_id)] = r_res.data[0].get("full_name")
            except Exception:
                pass

        return enrich_incident_data(incident, responder_lookup)

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="An internal database error occurred while retrieving the incident"
        )


# ============================================================
# UPDATE INCIDENT
# ============================================================

@app.patch("/incidents/{incident_id}")
def update_incident(
    incident_id: str,
    update: IncidentUpdate,
    current_user=Depends(get_current_user)
):
    if not incident_id or not incident_id.strip():
        raise HTTPException(status_code=400, detail="Incident ID cannot be empty")

    if not update.model_fields_set:
        raise HTTPException(
            status_code=400,
            detail="No fields provided for update"
        )

    # 1. Fast validation before database query
    if update.status is not None and update.status not in ALLOWED_INCIDENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{update.status}'. Allowed statuses are: {', '.join(sorted(ALLOWED_INCIDENT_STATUSES))}"
        )

    has_assignment_change = "assigned_to" in update.model_fields_set
    target_uuid = None
    if has_assignment_change and update.assigned_to is not None:
        target_uuid_str = update.assigned_to.strip() if isinstance(update.assigned_to, str) else ""
        try:
            target_uuid = str(uuid.UUID(target_uuid_str))
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid responder UUID: '{update.assigned_to}'"
            )

    try:
        existing = (
            supabase
            .table("incidents")
            .select("*")
            .eq("id", incident_id)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

        incident = existing.data[0]
        user_role = current_user.get("role", "citizen")
        user_id = current_user.get("id")

        update_data = {}

        # 1. Assignment Authorization & Validation
        if has_assignment_change:
            if user_role not in {"command_center", "admin"}:
                raise HTTPException(
                    status_code=403,
                    detail="Only command_center or admin roles may assign or unassign incidents"
                )

        # 2. Reject unauthorized roles from modifying incidents
        if user_role in {"hospital", "shelter"}:
            raise HTTPException(
                status_code=403,
                detail="Hospital and shelter roles do not have permission to update incidents"
            )

        if user_role not in {"command_center", "admin", "responder", "citizen"}:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to update incidents"
            )

        # 3. Role-specific validation & update construction
        if user_role == "citizen":
            if str(incident.get("user_id")) != str(user_id):
                raise HTTPException(
                    status_code=403,
                    detail="You can only update your own incidents"
                )
            if update.status is not None:
                if update.status not in CITIZEN_ALLOWED_STATUSES:
                    raise HTTPException(
                        status_code=403,
                        detail="Citizens may only cancel or provide notes on their own incidents"
                    )
                update_data["status"] = update.status
            if update.note is not None:
                update_data["note"] = update.note

        elif user_role == "responder":
            if update.status is not None and update.status not in {"in_progress", "resolved"}:
                raise HTTPException(
                    status_code=403,
                    detail="Responders may only mark incidents in_progress or resolved"
                )
            assigned_to = incident.get("assigned_to")
            if not assigned_to or str(assigned_to) != str(user_id):
                raise HTTPException(
                    status_code=403,
                    detail="Responders may only update incidents assigned to them"
                )
            if update.status is not None:
                update_data["status"] = update.status
            if update.note is not None:
                update_data["note"] = update.note

        elif user_role in {"command_center", "admin"}:
            if has_assignment_change:
                if update.assigned_to is not None:
                    # Verify target profile exists and is a responder
                    profile_res = (
                        supabase
                        .table("profiles")
                        .select("id, role, full_name")
                        .eq("id", target_uuid)
                        .limit(1)
                        .execute()
                    )
                    if not profile_res.data:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Target responder with ID '{target_uuid}' does not exist"
                        )
                    target_profile = profile_res.data[0]
                    if target_profile.get("role") != "responder":
                        raise HTTPException(
                            status_code=400,
                            detail=f"Target user '{target_uuid}' is not a responder (role is '{target_profile.get('role')}')"
                        )

                    update_data["assigned_to"] = target_uuid

                    # When assigning: if current status is reported or verified, auto-change to assigned
                    curr_status = update.status or incident.get("status", "reported")
                    if curr_status in {"reported", "verified"}:
                        update_data["status"] = "assigned"

                else:
                    # Explicit unassign: assigned_to = null
                    update_data["assigned_to"] = None

                    # When unassigning: if current status is assigned, auto-change to verified
                    curr_status = update.status or incident.get("status", "reported")
                    if curr_status == "assigned":
                        update_data["status"] = "verified"

            if update.status is not None:
                update_data["status"] = update.status
            if update.note is not None:
                update_data["note"] = update.note

        # 4. Check for effective changes
        if not update_data:
            raise HTTPException(
                status_code=400,
                detail="No effective changes provided for update"
            )

        # 5. Dynamic Priority Recalculation
        effective_sev = incident.get("severity") or 3
        effective_type = incident.get("type") or "other"
        effective_status = update_data.get("status") or incident.get("status") or "reported"
        effective_assigned = update_data.get("assigned_to") if has_assignment_change else incident.get("assigned_to")

        update_data["priority_score"] = calculate_priority_score(
            severity=effective_sev,
            hazard_type=effective_type,
            status=effective_status,
            created_at=incident.get("created_at"),
            assigned_to=effective_assigned,
        )

        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        response = (
            supabase
            .table("incidents")
            .update(update_data)
            .eq("id", incident_id)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

        updated_row = response.data[0]
        responder_lookup = {}
        assigned_id = updated_row.get("assigned_to")
        if assigned_id:
            try:
                resp_prof = supabase.table("profiles").select("id, full_name").eq("id", str(assigned_id)).limit(1).execute()
                if resp_prof.data:
                    responder_lookup[str(assigned_id)] = resp_prof.data[0].get("full_name")
            except Exception:
                pass

        # ----------------------------------------------------
        # AUDIT TRAIL LOGGING (PHASE 5.1 & 5.3)
        # ----------------------------------------------------
        actor_id = current_user["id"]
        actor_name = current_user.get("full_name") or "User"
        actor_role = current_user.get("role") or "citizen"
        audit_failed = False

        # 1. Status change event
        old_status = incident.get("status")
        new_status = updated_row.get("status")
        if new_status and old_status != new_status:
            ev = log_incident_event(
                incident_id=incident_id,
                actor_id=actor_id,
                event_type="status_changed",
                previous_state={"status": old_status},
                new_state={"status": new_status},
                metadata={
                    "actor_name": actor_name,
                    "actor_role": actor_role,
                    "action_label": f"Status changed to {new_status}",
                },
            )
            if ev is None:
                audit_failed = True

        # 2. Responder assignment / unassignment event
        if has_assignment_change and not audit_failed:
            old_assigned = incident.get("assigned_to")
            new_assigned = updated_row.get("assigned_to")
            old_assigned_str = str(old_assigned) if old_assigned else None
            new_assigned_str = str(new_assigned) if new_assigned else None
            if old_assigned_str != new_assigned_str:
                if new_assigned is not None:
                    target_name = responder_lookup.get(str(new_assigned))
                    if not target_name and "target_profile" in locals() and target_profile:
                        target_name = target_profile.get("full_name")
                    ev = log_incident_event(
                        incident_id=incident_id,
                        actor_id=actor_id,
                        event_type="responder_assigned",
                        previous_state={"assigned_to": old_assigned},
                        new_state={"assigned_to": new_assigned, "assigned_responder_name": target_name},
                        metadata={
                            "actor_name": actor_name,
                            "actor_role": actor_role,
                            "assigned_responder_name": target_name,
                            "action_label": f"Assigned to {target_name or 'responder'}",
                        },
                    )
                    if ev is None:
                        audit_failed = True
                else:
                    ev = log_incident_event(
                        incident_id=incident_id,
                        actor_id=actor_id,
                        event_type="responder_unassigned",
                        previous_state={"assigned_to": old_assigned},
                        new_state={"assigned_to": None},
                        metadata={
                            "actor_name": actor_name,
                            "actor_role": actor_role,
                            "action_label": "Responder unassigned",
                        },
                    )
                    if ev is None:
                        audit_failed = True

        # 3. Field note event
        old_note = incident.get("note")
        new_note = updated_row.get("note")
        if "note" in update.model_fields_set and (old_note != new_note) and not audit_failed:
            ev_type = "note_added" if not old_note else "note_updated"
            act_label = "Field note added" if not old_note else "Field note updated"
            ev = log_incident_event(
                incident_id=incident_id,
                actor_id=actor_id,
                event_type=ev_type,
                previous_state={"note": old_note},
                new_state={"note": new_note},
                metadata={
                    "actor_name": actor_name,
                    "actor_role": actor_role,
                    "action_label": act_label,
                },
            )
            if ev is None:
                audit_failed = True

        if audit_failed:
            # Compensating rollback: restore incident to original snapshot
            try:
                revert_payload = {
                    "status": incident.get("status"),
                    "note": incident.get("note"),
                    "assigned_to": incident.get("assigned_to"),
                    "priority_score": incident.get("priority_score"),
                    "updated_at": incident.get("updated_at"),
                }
                supabase.table("incidents").update(revert_payload).eq("id", incident_id).execute()
            except Exception as rev_err:
                print(f"Warning: Compensating rollback failed for incident {incident_id}: {rev_err}")
            raise HTTPException(
                status_code=500,
                detail="Failed to record persistent audit event. Incident update was rolled back."
            )

        enriched = enrich_incident_data(updated_row, responder_lookup)
        return {
            "message": "Incident updated successfully",
            "incident": enriched
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="An internal database error occurred while updating the incident"
        )


# ============================================================
# GET INCIDENT AUDIT EVENTS (PHASE 5.1)
# ============================================================

@app.get("/incidents/{incident_id}/events")
def get_incident_events(
    incident_id: str,
    limit: int = 50,
    offset: int = 0,
    order: str = "desc",
    current_user=Depends(get_current_user),
):
    """Retrieve persistent audit history for an incident.

    Access Rules:
    - Operational roles (responder, command_center, admin, hospital, shelter)
      receive audit events for any incident.
    - Citizens only receive audit events for incidents they personally reported.
    - Events are ordered deterministically by created_at, with bounded pagination.
    """
    if not incident_id or not incident_id.strip():
        raise HTTPException(status_code=400, detail="Incident ID cannot be empty")

    clamped_limit = max(1, min(100, limit))
    clamped_offset = max(0, offset)
    is_desc = order.strip().lower() != "asc"

    try:
        # 1. Verify incident existence & enforce authorization
        incident_res = (
            supabase
            .table("incidents")
            .select("id, user_id, status")
            .eq("id", incident_id)
            .limit(1)
            .execute()
        )

        if not incident_res.data:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

        incident = incident_res.data[0]
        user_role = current_user.get("role", "citizen")
        user_id = current_user.get("id")

        if user_role not in OPERATIONAL_ROLES and str(incident.get("user_id")) != str(user_id):
            raise HTTPException(
                status_code=403,
                detail="You can only view audit events for your own incidents"
            )

        # 2. Query incident events with deterministic ordering
        events_query = (
            supabase
            .table("incident_events")
            .select("*")
            .eq("incident_id", incident_id)
            .order("created_at", desc=is_desc)
            .order("id", desc=is_desc)
            .range(clamped_offset, clamped_offset + clamped_limit - 1)
        )
        events_res = events_query.execute()
        raw_events = events_res.data or []

        # 3. Enrich missing actor profile details
        actor_ids = list({str(ev["actor_id"]) for ev in raw_events if ev.get("actor_id")})
        actor_lookup = {}
        if actor_ids:
            try:
                prof_res = (
                    supabase
                    .table("profiles")
                    .select("id, full_name, role")
                    .in_("id", actor_ids)
                    .execute()
                )
                for prof in prof_res.data or []:
                    actor_lookup[str(prof["id"])] = {
                        "full_name": prof.get("full_name") or "User",
                        "role": prof.get("role") or "citizen",
                    }
            except Exception:
                pass

        enriched_events = []
        for ev in raw_events:
            event_copy = dict(ev)
            meta = dict(event_copy.get("metadata") or {})
            actor_id = str(event_copy.get("actor_id")) if event_copy.get("actor_id") else None

            if not meta.get("action_label"):
                meta["action_label"] = get_default_action_label(
                    event_copy.get("event_type"), event_copy.get("new_state")
                )

            if actor_id and actor_id in actor_lookup:
                if not meta.get("actor_name"):
                    meta["actor_name"] = actor_lookup[actor_id]["full_name"]
                if not meta.get("actor_role"):
                    meta["actor_role"] = actor_lookup[actor_id]["role"]

            event_copy["metadata"] = meta
            enriched_events.append(event_copy)

        return {
            "incident_id": incident_id,
            "count": len(enriched_events),
            "limit": clamped_limit,
            "offset": clamped_offset,
            "order": "desc" if is_desc else "asc",
            "events": enriched_events,
        }

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="An internal database error occurred while retrieving audit events"
        )
