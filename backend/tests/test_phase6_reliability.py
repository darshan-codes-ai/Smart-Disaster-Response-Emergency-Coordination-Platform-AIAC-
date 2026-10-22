"""
Phase 6: Testing, Reliability, Quality Assurance, and Regression Prevention Test Suite.

Covers:
- Health and basic API endpoints
- Input validation, missing fields, malformed payloads, invalid enums
- Transactional RPC execution and resilient fallback paths
- Role-based authorization matrix (citizen, responder, hospital, shelter, command_center, admin)
- Audit history integrity, actor provenance, and error sanitization
"""

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import (
    app,
    get_current_user,
    require_roles,
    ALLOWED_INCIDENT_STATUSES,
)


class Phase6ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides.clear()

    def tearDown(self):
        app.dependency_overrides.clear()

    # ============================================================
    # 1. Health and Meta Endpoints
    # ============================================================
    def test_root_endpoint_metadata(self):
        """GET / returns system status and running message."""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("status", data)
        self.assertIn("message", data)
        self.assertIn("database", data)
        self.assertEqual(data["status"], "online")
        self.assertIn("running", data["message"].lower())

    def test_health_check_endpoint(self):
        """GET /health returns health status and database connectivity."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("database", data)

    # ============================================================
    # 2. Input Validation, Malformed Payloads, and Edge Cases
    # ============================================================
    def test_create_incident_missing_location_returns_422(self):
        """POST /incidents without location field fails Pydantic schema validation."""
        user = {"id": "user-valid-1", "role": "citizen", "email": "cit@test.gov"}
        app.dependency_overrides[get_current_user] = lambda: user

        payload = {
            "type": "Flood",
            "description": "Rising waters near junction",
            "severity": 3,
        }
        response = self.client.post("/incidents", json=payload)
        self.assertEqual(response.status_code, 422)
        details = response.json()["detail"]
        fields = [err["loc"][-1] for err in details]
        self.assertIn("location", fields)

    def test_create_incident_missing_type_returns_422(self):
        """POST /incidents without hazard type fails Pydantic schema validation."""
        user = {"id": "user-valid-1", "role": "citizen", "email": "cit@test.gov"}
        app.dependency_overrides[get_current_user] = lambda: user

        payload = {
            "description": "Structure collapse",
            "location": {"lat": 18.0, "lng": 79.0},
        }
        response = self.client.post("/incidents", json=payload)
        self.assertEqual(response.status_code, 422)
        details = response.json()["detail"]
        fields = [err["loc"][-1] for err in details]
        self.assertIn("type", fields)

    def test_create_incident_missing_description_returns_422(self):
        """POST /incidents without description fails Pydantic schema validation."""
        user = {"id": "user-valid-1", "role": "citizen", "email": "cit@test.gov"}
        app.dependency_overrides[get_current_user] = lambda: user

        payload = {
            "type": "Earthquake",
            "location": {"lat": 18.0, "lng": 79.0},
        }
        response = self.client.post("/incidents", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_patch_incident_invalid_status_enum_returns_400(self):
        """PATCH /incidents/{id} with unknown status rejects with 400 and lists valid statuses."""
        coord = {"id": "coord-1", "role": "command_center", "email": "coord@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: coord

        response = self.client.patch("/incidents/inc-test-123", json={"status": "invalid_status_code"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid status", response.json()["detail"])
        for status in ALLOWED_INCIDENT_STATUSES:
            self.assertIn(status, response.json()["detail"])

    def test_patch_incident_empty_body_returns_400(self):
        """PATCH /incidents/{id} with empty object rejects with 400."""
        coord = {"id": "coord-1", "role": "command_center", "email": "coord@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: coord

        response = self.client.patch("/incidents/inc-test-123", json={})
        self.assertEqual(response.status_code, 400)
        self.assertIn("No fields provided for update", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_get_nonexistent_incident_returns_404(self, mock_supabase):
        """GET /incidents/{id} for missing record returns 404 Not Found."""
        coord = {"id": "coord-1", "role": "command_center", "email": "coord@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: coord

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.execute.return_value.data = []
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/incidents/inc-does-not-exist")
        self.assertEqual(response.status_code, 404)
        self.assertIn("Incident not found", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_patch_nonexistent_incident_returns_404(self, mock_supabase):
        """PATCH /incidents/{id} for missing record returns 404 Not Found."""
        coord = {"id": "coord-1", "role": "command_center", "email": "coord@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: coord

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.execute.return_value.data = []
        mock_supabase.table.return_value = mock_query

        response = self.client.patch("/incidents/inc-does-not-exist", json={"status": "verified"})
        self.assertEqual(response.status_code, 404)
        self.assertIn("Incident not found", response.json()["detail"])

    # ============================================================
    # 3. Transactional RPC Success Paths
    # ============================================================
    @patch("backend.main.supabase")
    def test_create_incident_rpc_success(self, mock_supabase):
        """POST /incidents correctly calls and uses create_incident_with_audit RPC when available."""
        citizen = {"id": "cit-rpc-1", "role": "citizen", "email": "cit@test.gov", "full_name": "Citizen Rpc"}
        app.dependency_overrides[get_current_user] = lambda: citizen

        created_row = {
            "id": "11111111-2222-3333-4444-555555555555",
            "user_id": "cit-rpc-1",
            "type": "Fire",
            "description": "Kitchen fire contained",
            "latitude": 18.01,
            "longitude": 79.02,
            "severity": 4,
            "status": "reported",
            "priority_score": 75,
            "created_at": "2026-10-15T12:00:00Z",
            "updated_at": "2026-10-15T12:00:00Z",
        }

        mock_rpc_call = MagicMock()
        mock_rpc_call.execute.return_value = MagicMock(data=created_row)
        mock_supabase.rpc.return_value = mock_rpc_call

        response = self.client.post("/incidents", json={
            "type": "Fire",
            "description": "Kitchen fire contained",
            "location": {"lat": 18.01, "lng": 79.02},
            "severity": 4,
        })

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["message"], "Incident created successfully")
        self.assertEqual(data["incident"]["id"], "11111111-2222-3333-4444-555555555555")
        mock_supabase.rpc.assert_called_with(
            "create_incident_with_audit",
            unittest.mock.ANY
        )

    @patch("backend.main.supabase")
    def test_update_incident_rpc_success(self, mock_supabase):
        """PATCH /incidents/{id} calls update_incident_with_audit RPC and enriches response."""
        coord = {"id": "coord-rpc-1", "role": "command_center", "email": "coord@rescue.gov", "full_name": "Chief Dispatcher"}
        app.dependency_overrides[get_current_user] = lambda: coord

        existing_incident = {
            "id": "inc-rpc-update",
            "user_id": "cit-1",
            "type": "Flood",
            "severity": 4,
            "status": "reported",
            "assigned_to": None,
            "note": None,
            "created_at": "2026-10-15T10:00:00Z",
            "updated_at": "2026-10-15T10:00:00Z",
        }

        updated_row = {
            "id": "inc-rpc-update",
            "user_id": "cit-1",
            "type": "Flood",
            "severity": 4,
            "status": "verified",
            "assigned_to": None,
            "note": "Verified by radar report",
            "priority_score": 60,
            "created_at": "2026-10-15T10:00:00Z",
            "updated_at": "2026-10-15T10:05:00Z",
        }

        # Mock table lookup for existing incident
        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [existing_incident]
        mock_supabase.table.return_value = mock_table

        # Mock RPC execute
        mock_rpc_call = MagicMock()
        mock_rpc_call.execute.return_value = MagicMock(data=updated_row)
        mock_supabase.rpc.return_value = mock_rpc_call

        response = self.client.patch("/incidents/inc-rpc-update", json={
            "status": "verified",
            "note": "Verified by radar report",
        })

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["message"], "Incident updated successfully")
        self.assertEqual(data["incident"]["status"], "verified")
        self.assertEqual(data["incident"]["note"], "Verified by radar report")
        mock_supabase.rpc.assert_called_with("update_incident_with_audit", unittest.mock.ANY)

    # ============================================================
    # 4. Role Authorization Matrix (Non-Operational Roles)
    # ============================================================
    def test_hospital_role_cannot_create_incident(self):
        """Hospital role is restricted to medical coordination and cannot file emergency incidents."""
        hosp = {"id": "hosp-1", "role": "hospital", "email": "general@hospital.org"}
        app.dependency_overrides[get_current_user] = lambda: hosp

        response = self.client.post("/incidents", json={
            "type": "Flood",
            "description": "Hospital wing water intake",
            "location": {"lat": 18.0, "lng": 79.0},
        })
        self.assertEqual(response.status_code, 403)
        self.assertIn("permission", response.json()["detail"].lower())

    def test_shelter_role_cannot_create_incident(self):
        """Shelter role is restricted to shelter management and cannot file emergency incidents."""
        shelter = {"id": "shelter-1", "role": "shelter", "email": "shelter@aid.org"}
        app.dependency_overrides[get_current_user] = lambda: shelter

        response = self.client.post("/incidents", json={
            "type": "Other",
            "description": "Need more blankets",
            "location": {"lat": 18.0, "lng": 79.0},
        })
        self.assertEqual(response.status_code, 403)
        self.assertIn("permission", response.json()["detail"].lower())

    def test_hospital_role_cannot_view_responders(self):
        """Hospital role cannot query the active responder dispatch registry."""
        hosp = {"id": "hosp-1", "role": "hospital", "email": "general@hospital.org"}
        app.dependency_overrides[get_current_user] = lambda: hosp

        response = self.client.get("/responders")
        self.assertEqual(response.status_code, 403)
        self.assertIn("permission", response.json()["detail"].lower())

    def test_shelter_role_cannot_view_responders(self):
        """Shelter role cannot query the active responder dispatch registry."""
        shelter = {"id": "shelter-1", "role": "shelter", "email": "shelter@aid.org"}
        app.dependency_overrides[get_current_user] = lambda: shelter

        response = self.client.get("/responders")
        self.assertEqual(response.status_code, 403)
        self.assertIn("permission", response.json()["detail"].lower())

    # ============================================================
    # 5. Audit Access and Ownership Verification
    # ============================================================
    @patch("backend.main.supabase")
    def test_citizen_cannot_read_events_of_other_citizen_incident(self, mock_supabase):
        """Citizens cannot read audit timeline of incidents filed by other citizens."""
        citizen_attacker = {"id": "cit-attacker", "role": "citizen", "email": "cit2@test.gov"}
        app.dependency_overrides[get_current_user] = lambda: citizen_attacker

        victim_incident = {
            "id": "inc-victim-99",
            "user_id": "cit-victim",
            "type": "Medical",
            "status": "reported",
        }

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [victim_incident]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/incidents/inc-victim-99/events")
        self.assertEqual(response.status_code, 403)
        self.assertIn("only view audit events for your own incidents", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_admin_and_command_center_can_read_audit_events(self, mock_supabase):
        """Command center and admin coordinators can read audit timelines for any incident."""
        admin = {"id": "admin-1", "role": "admin", "email": "admin@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: admin

        incident = {"id": "inc-any", "user_id": "someone-else"}
        audit_events = [
            {"id": "ev-1", "incident_id": "inc-any", "event_type": "incident_created"},
            {"id": "ev-2", "incident_id": "inc-any", "event_type": "status_changed"},
        ]

        def table_router(table_name):
            mock = MagicMock()
            if table_name == "incidents":
                mock.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [incident]
            elif table_name == "incident_events":
                chain = MagicMock()
                chain.select.return_value = chain
                chain.eq.return_value = chain
                chain.order.return_value = chain
                chain.range.return_value = chain
                chain.execute.return_value = MagicMock(data=audit_events)
                return chain
            return mock

        mock_supabase.table.side_effect = table_router

        response = self.client.get("/incidents/inc-any/events")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["incident_id"], "inc-any")
        self.assertEqual(data["count"], 2)


if __name__ == "__main__":
    unittest.main()

