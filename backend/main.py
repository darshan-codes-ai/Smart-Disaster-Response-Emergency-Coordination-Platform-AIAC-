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

load_dotenv()

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
    description="Backend API for the AIAC Disaster Response Platform",
    version="1.1.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# DATA MODELS
# ============================================================

class Location(BaseModel):
    lat: float
    lng: float


class IncidentCreate(BaseModel):
    type: str
    description: str
    location: Location
    severity: Optional[int] = Field(default=3, ge=1, le=5)


class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


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
        # Use Supabase's official auth client instead of manually calling
        # /auth/v1/user. This keeps JWT validation tied to the same project
        # configuration used by the backend Supabase client.
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

        # Profile lookup is best-effort. Authentication must not fail merely
        # because the profiles table is empty, protected by RLS, or temporarily
        # unavailable. All authenticated users get the least-privileged citizen
        # role unless an explicit profile row is readable.
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
        return {
            "status": "unhealthy",
            "database": "error",
            "detail": str(e)
        }


# ============================================================
# CURRENT USER
# ============================================================

@app.get("/me")
def get_me(current_user=Depends(get_current_user)):
    return current_user


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
    priority_score = severity * 20
    now = datetime.now(timezone.utc).isoformat()

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

        return {
            "message": "Incident created successfully",
            "incident": response.data[0]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}"
        )


# ============================================================
# GET INCIDENTS
# ============================================================

@app.get("/incidents")
def get_incidents(current_user=Depends(get_current_user)):
    try:
        query = (
            supabase
            .table("incidents")
            .select("*")
            .order("created_at", desc=True)
        )

        # Operational roles and citizens can view reported disaster incidents on the map.
        # (Incident modification and operational actions remain strictly role-gated).
        response = query.execute()

        return {
            "count": len(response.data),
            "incidents": response.data
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}"
        )


# ============================================================
# GET SINGLE INCIDENT
# ============================================================

@app.get("/incidents/{incident_id}")
def get_incident(
    incident_id: str,
    current_user=Depends(get_current_user)
):
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
            current_user["role"] == "citizen"
            and incident.get("user_id") != current_user["id"]
        ):
            raise HTTPException(
                status_code=403,
                detail="You can only view your own incidents"
            )

        return incident

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}"
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
    update_data = {}

    if update.status is not None:
        update_data["status"] = update.status

    if update.note is not None:
        update_data["note"] = update.note

    if not update_data:
        raise HTTPException(
            status_code=400,
            detail="No fields provided for update"
        )

    try:
        existing = (
            supabase
            .table("incidents")
            .select("id, user_id")
            .eq("id", incident_id)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

        incident = existing.data[0]

        # Citizens can update only their own reports.
        # Operational roles can update any incident.
        if (
            current_user["role"] == "citizen"
            and incident.get("user_id") != current_user["id"]
        ):
            raise HTTPException(
                status_code=403,
                detail="You can only update your own incidents"
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

        return {
            "message": "Incident updated successfully",
            "incident": response.data[0]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}"
        )
