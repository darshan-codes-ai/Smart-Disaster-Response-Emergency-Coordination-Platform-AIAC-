import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client


# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL:
    raise RuntimeError(
        "SUPABASE_URL is missing. Check backend/.env"
    )

if not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_SECRET_KEY is missing. Check backend/.env"
    )


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
    version="1.0.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000"
    ],
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

    severity: Optional[int] = Field(
        default=3,
        ge=1,
        le=5
    )


class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


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

        response = (
            supabase
            .table("incidents")
            .select("id")
            .limit(1)
            .execute()
        )

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
# CREATE INCIDENT
# ============================================================

@app.post("/incidents")
def create_incident(incident: IncidentCreate):

    # Generate unique incident ID
    incident_id = str(uuid.uuid4())

    # Use provided severity or default to 3
    severity = incident.severity or 3

    # Temporary priority calculation
    # We will replace this later with
    # explainable AI-assisted prioritization.
    priority_score = severity * 20

    # Current UTC timestamp
    now = datetime.now(
        timezone.utc
    ).isoformat()

    incident_data = {

        "id": incident_id,

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
# GET ALL INCIDENTS
# ============================================================

@app.get("/incidents")
def get_incidents():

    try:

        response = (
            supabase
            .table("incidents")
            .select("*")
            .order(
                "created_at",
                desc=True
            )
            .execute()
        )

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
def get_incident(incident_id: str):

    try:

        response = (
            supabase
            .table("incidents")
            .select("*")
            .eq(
                "id",
                incident_id
            )
            .execute()
        )

        if not response.data:

            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

        return response.data[0]

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
    update: IncidentUpdate
):

    update_data = {}

    # Update status if provided
    if update.status is not None:

        update_data["status"] = update.status

    # Update note if provided
    if update.note is not None:

        update_data["note"] = update.note

    # Make sure something was provided
    if not update_data:

        raise HTTPException(
            status_code=400,
            detail="No fields provided for update"
        )

    # Update timestamp
    update_data["updated_at"] = (
        datetime.now(
            timezone.utc
        ).isoformat()
    )

    try:

        response = (
            supabase
            .table("incidents")
            .update(update_data)
            .eq(
                "id",
                incident_id
            )
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