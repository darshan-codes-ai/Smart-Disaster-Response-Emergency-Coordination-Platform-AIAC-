from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(
    title="Smart Disaster Response API",
    description="Backend API for the Smart Disaster Response & Emergency Coordination Platform",
    version="1.0.0",
)


# ---------------------------------------------------------
# CORS
# ---------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# DATA MODELS
# ---------------------------------------------------------

class Location(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class IncidentCreate(BaseModel):
    type: str
    description: str
    location: Location
    severity: Optional[int] = Field(
        default=None,
        ge=1,
        le=5,
    )


class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


# ---------------------------------------------------------
# TEMPORARY IN-MEMORY DATABASE
# ---------------------------------------------------------

incidents = []


# ---------------------------------------------------------
# ROOT
# ---------------------------------------------------------

@app.get("/")
def root():
    return {
        "success": True,
        "message": "Smart Disaster Response API is running",
        "version": "1.0.0",
    }


# ---------------------------------------------------------
# HEALTH CHECK
# ---------------------------------------------------------

@app.get("/health")
def health():
    return {
        "success": True,
        "status": "healthy",
    }


# ---------------------------------------------------------
# CREATE INCIDENT
# ---------------------------------------------------------

@app.post("/incidents")
def create_incident(incident: IncidentCreate):

    incident_id = str(uuid4())

    severity = incident.severity or 3

    new_incident = {
        "id": incident_id,
        "type": incident.type,
        "description": incident.description,
        "location": {
            "lat": incident.location.lat,
            "lng": incident.location.lng,
        },
        "severity": severity,
        "status": "reported",
        "priority_score": severity * 20,
        "created_at": datetime.utcnow().isoformat(),
    }

    incidents.append(new_incident)

    return {
        "success": True,
        "data": new_incident,
        "error": None,
    }


# ---------------------------------------------------------
# GET ALL INCIDENTS
# ---------------------------------------------------------

@app.get("/incidents")
def get_incidents(
    status: Optional[str] = None,
    type: Optional[str] = None,
):
    results = incidents

    if status:
        results = [
            incident
            for incident in results
            if incident["status"] == status
        ]

    if type:
        results = [
            incident
            for incident in results
            if incident["type"].lower() == type.lower()
        ]

    return {
        "success": True,
        "data": results,
        "error": None,
    }


# ---------------------------------------------------------
# GET SINGLE INCIDENT
# ---------------------------------------------------------

@app.get("/incidents/{incident_id}")
def get_incident(incident_id: str):

    for incident in incidents:
        if incident["id"] == incident_id:
            return {
                "success": True,
                "data": incident,
                "error": None,
            }

    raise HTTPException(
        status_code=404,
        detail="Incident not found",
    )


# ---------------------------------------------------------
# UPDATE INCIDENT
# ---------------------------------------------------------

@app.patch("/incidents/{incident_id}")
def update_incident(
    incident_id: str,
    update: IncidentUpdate,
):

    for incident in incidents:

        if incident["id"] == incident_id:

            if update.status:
                incident["status"] = update.status

            if update.note:
                incident["last_note"] = update.note

            incident["updated_at"] = datetime.utcnow().isoformat()

            return {
                "success": True,
                "data": incident,
                "error": None,
            }

    raise HTTPException(
        status_code=404,
        detail="Incident not found",
    )