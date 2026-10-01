"""
Automated unit & integration test suite for Milestone 1:
Infrastructure & Security Hardening.

Tests:
- Unauthenticated requests are rejected (401)
- Citizen can access own incident (200)
- Citizen cannot access another citizen's incident (403)
- Operational roles (responder, command_center, etc.) can access any incident (200)
- Authorized operational role can update an incident (200)
- Citizen cannot update another citizen's incident (403)
- Invalid incident statuses are rejected (400)
- All valid incident statuses are accepted (200)
- Empty update payloads are rejected (400)
- Public root and health endpoints
"""

import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import (
    app,
    get_current_user,
    ALLOWED_INCIDENT_STATUSES,
)


class IncidentApiSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides.clear()

    def tearDown(self):
        app.dependency_overrides.clear()

    # ------------------------------------------------------------
    # 1. Unauthenticated Request Rejection
    # ------------------------------------------------------------
    def test_unauthenticated_requests_rejected(self):
        """Verify endpoints requiring auth reject requests without a Bearer token."""
        endpoints = [
            ("GET", "/me"),
            ("GET", "/incidents"),
            ("GET", "/incidents/test-id-123"),
            ("POST", "/incidents"),
            ("PATCH", "/incidents/test-id-123"),
        ]

        for method, endpoint in endpoints:
            with self.subTest(method=method, endpoint=endpoint):
                if method == "GET":
                    response = self.client.get(endpoint)
                elif method == "POST":
                    response = self.client.post(endpoint, json={
                        "type": "Fire",
                        "description": "Test fire",
                        "location": {"lat": 18.0, "lng": 79.0}
                    })
                elif method == "PATCH":
                    response = self.client.patch(endpoint, json={"status": "in_progress"})

                self.assertEqual(
                    response.status_code,
                    401,
                    f"Expected 401 for unauthenticated {method} {endpoint}, got {response.status_code}"
                )
                self.assertIn("detail", response.json())

    # ------------------------------------------------------------
    # 2. Citizen Access Controls (Own vs Other's Incidents)
    # ------------------------------------------------------------
    @patch("backend.main.supabase")
    def test_citizen_can_access_own_incident(self, mock_supabase):
        """Citizen should be able to view their own incident."""
        citizen_user = {
            "id": "citizen-uuid-1",
            "email": "citizen1@example.com",
            "role": "citizen",
            "full_name": "Citizen One",
        }
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_incident = {
            "id": "inc-100",
            "user_id": "citizen-uuid-1",
            "type": "Flood",
            "description": "Street flooded",
            "latitude": 18.087,
            "longitude": 79.468,
            "severity": 3,
            "status": "reported",
            "priority_score": 60,
            "created_at": "2026-10-02T00:00:00Z",
        }

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.execute.return_value.data = [mock_incident]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/incidents/inc-100")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], "inc-100")
        self.assertEqual(data["user_id"], "citizen-uuid-1")

    @patch("backend.main.supabase")
    def test_citizen_cannot_access_another_citizen_incident(self, mock_supabase):
        """Citizen must receive 403 Forbidden when accessing another user's incident."""
        citizen_user = {
            "id": "citizen-uuid-1",
            "email": "citizen1@example.com",
            "role": "citizen",
            "full_name": "Citizen One",
        }
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_other_incident = {
            "id": "inc-200",
            "user_id": "citizen-uuid-2",  # Different owner
            "type": "Fire",
            "description": "Building smoke",
            "latitude": 18.089,
            "longitude": 79.470,
            "severity": 4,
            "status": "reported",
        }

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.execute.return_value.data = [mock_other_incident]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/incidents/inc-200")
        self.assertEqual(response.status_code, 403)
        self.assertIn("You can only view your own incidents", response.json()["detail"])

    # ------------------------------------------------------------
    # 3. Operational Role Access
    # ------------------------------------------------------------
    @patch("backend.main.supabase")
    def test_responder_can_access_operational_incidents(self, mock_supabase):
        """Responder role can view any incident regardless of ownership."""
        responder_user = {
            "id": "responder-uuid-1",
            "email": "responder@rescue.gov",
            "role": "responder",
            "full_name": "Officer Smith",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        mock_incident = {
            "id": "inc-300",
            "user_id": "citizen-uuid-99",
            "type": "Medical Emergency",
            "description": "Ambulance requested",
            "latitude": 18.085,
            "longitude": 79.460,
            "severity": 5,
            "status": "reported",
        }

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.execute.return_value.data = [mock_incident]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/incidents/inc-300")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "inc-300")

    # ------------------------------------------------------------
    # 4. Incident Updates & Status Validation
    # ------------------------------------------------------------
    @patch("backend.main.supabase")
    def test_authorized_operational_role_can_update_incident(self, mock_supabase):
        """Responder can update incident status and note."""
        responder_user = {
            "id": "responder-uuid-1",
            "role": "responder",
            "email": "resp@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        # Existing record check
        existing_query = MagicMock()
        existing_query.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-400", "user_id": "citizen-uuid-5"}
        ]

        # Update execution
        updated_incident = {
            "id": "inc-400",
            "user_id": "citizen-uuid-5",
            "status": "in_progress",
            "note": "Rescue squad deployed",
            "updated_at": "2026-10-02T01:00:00Z",
        }
        update_query = MagicMock()
        update_query.update.return_value.eq.return_value.execute.return_value.data = [updated_incident]

        # Route table mock
        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-400", "user_id": "citizen-uuid-5"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [updated_incident]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-400", json={
            "status": "in_progress",
            "note": "Rescue squad deployed"
        })

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["incident"]["status"], "in_progress")
        self.assertEqual(data["incident"]["note"], "Rescue squad deployed")

    @patch("backend.main.supabase")
    def test_citizen_cannot_update_another_citizen_incident(self, mock_supabase):
        """Citizen receives 403 Forbidden when attempting to update another's report."""
        citizen_user = {
            "id": "citizen-uuid-1",
            "role": "citizen",
            "email": "c1@example.com",
        }
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-500", "user_id": "citizen-uuid-2"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-500", json={
            "status": "cancelled"
        })

        self.assertEqual(response.status_code, 403)
        self.assertIn("You can only update your own incidents", response.json()["detail"])

    def test_invalid_status_is_rejected(self):
        """PATCH /incidents/{id} must reject invalid status values with 400 Bad Request."""
        responder_user = {
            "id": "responder-uuid-1",
            "role": "responder",
            "email": "resp@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        invalid_statuses = ["flying", "unknown_status", "PENDING", "closed", ""]

        for bad_status in invalid_statuses:
            with self.subTest(bad_status=bad_status):
                response = self.client.patch("/incidents/inc-123", json={
                    "status": bad_status
                })
                self.assertEqual(response.status_code, 400)
                self.assertIn("Invalid status", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_all_valid_statuses_accepted(self, mock_supabase):
        """Every status in ALLOWED_INCIDENT_STATUSES must be accepted."""
        responder_user = {
            "id": "responder-uuid-1",
            "role": "responder",
            "email": "resp@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        for valid_status in ALLOWED_INCIDENT_STATUSES:
            with self.subTest(status=valid_status):
                mock_table = MagicMock()
                mock_table.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-valid", "user_id": "citizen-uuid-1"}
                ]
                mock_table.update.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-valid", "status": valid_status}
                ]
                mock_supabase.table.return_value = mock_table

                response = self.client.patch("/incidents/inc-valid", json={
                    "status": valid_status
                })
                self.assertEqual(
                    response.status_code,
                    200,
                    f"Status '{valid_status}' should be accepted with 200, got {response.status_code}"
                )

    def test_empty_update_rejected(self):
        """PATCH with no fields should return 400."""
        responder_user = {
            "id": "responder-uuid-1",
            "role": "responder",
            "email": "resp@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        response = self.client.patch("/incidents/inc-123", json={})
        self.assertEqual(response.status_code, 400)
        self.assertIn("No fields provided for update", response.json()["detail"])

    # ------------------------------------------------------------
    # 5. Public / System Endpoints
    # ------------------------------------------------------------
    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "online")

    @patch("backend.main.supabase")
    def test_health_endpoint_healthy(self, mock_supabase):
        mock_query = MagicMock()
        mock_query.select.return_value.limit.return_value.execute.return_value.data = [{"id": "1"}]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "healthy")


if __name__ == "__main__":
    unittest.main()
