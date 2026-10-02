"""
Automated unit & integration test suite for RescueGrid:
Milestone 1 (Security Hardening), Milestone 2 (Operational Workflow),
and Milestone 3 (Smart Dispatch & Incident Prioritization).
"""

import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.main import (
    app,
    get_current_user,
    calculate_priority_score,
    get_priority_tier,
    ALLOWED_INCIDENT_STATUSES,
)


class IncidentApiSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides.clear()

    def tearDown(self):
        app.dependency_overrides.clear()

    # ============================================================
    # 1. Unauthenticated Request Rejection
    # ============================================================
    def test_unauthenticated_requests_rejected(self):
        """Verify endpoints requiring auth reject requests without a Bearer token."""
        endpoints = [
            ("GET", "/me"),
            ("GET", "/incidents"),
            ("GET", "/incidents/test-id-123"),
            ("POST", "/incidents"),
            ("PATCH", "/incidents/test-id-123"),
            ("GET", "/responders"),
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

    # ============================================================
    # 2. Citizen Access Controls (Own vs Other's Incidents)
    # ============================================================
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
        self.assertEqual(response.json()["id"], "inc-100")

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

        mock_incident = {
            "id": "inc-200",
            "user_id": "citizen-uuid-2",
            "type": "Fire",
            "description": "Other citizen's fire",
            "latitude": 18.087,
            "longitude": 79.468,
            "severity": 4,
            "status": "reported",
            "priority_score": 80,
            "created_at": "2026-10-02T00:00:00Z",
        }

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.execute.return_value.data = [mock_incident]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/incidents/inc-200")
        self.assertEqual(response.status_code, 403)
        self.assertIn("You can only view your own incidents", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_citizen_cannot_update_another_citizen_incident(self, mock_supabase):
        """Citizen receives 403 Forbidden when attempting to update another's report."""
        citizen_user = {
            "id": "citizen-uuid-1",
            "email": "citizen1@example.com",
            "role": "citizen",
            "full_name": "Citizen One",
        }
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_incident = {
            "id": "inc-300",
            "user_id": "citizen-uuid-OTHER",
            "status": "reported",
        }

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [mock_incident]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-300", json={"note": "intruder note"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("You can only update your own incidents", response.json()["detail"])

    # ============================================================
    # 3. Operational Role Access Controls
    # ============================================================
    @patch("backend.main.create_client")
    def test_responder_can_access_operational_incidents(self, mock_create_client):
        """Responder role can view any incident regardless of ownership."""
        responder_user = {
            "id": "responder-uuid-1",
            "email": "responder@rescue.gov",
            "role": "responder",
            "full_name": "First Responder",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        mock_incidents = [
            {"id": "inc-1", "user_id": "citizen-1", "type": "Flood", "severity": 3, "status": "reported", "created_at": "2026-10-02T00:00:00Z"},
            {"id": "inc-2", "user_id": "citizen-2", "type": "Fire", "severity": 4, "status": "verified", "created_at": "2026-10-02T00:00:00Z"},
        ]

        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.order.return_value.execute.return_value.data = mock_incidents
        mock_create_client.return_value = mock_client

        response = self.client.get("/incidents")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 2)

    @patch("backend.main.supabase")
    def test_authorized_operational_role_can_update_incident(self, mock_supabase):
        """Responder can update incident status and note."""
        responder_user = {
            "id": "responder-uuid-1",
            "email": "responder@rescue.gov",
            "role": "responder",
            "full_name": "First Responder",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-500", "user_id": "citizen-1", "status": "assigned", "type": "Flood", "severity": 3, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-500", "status": "in_progress", "note": "Unit on scene"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-500", json={
            "status": "in_progress",
            "note": "Unit on scene"
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident"]["status"], "in_progress")

    # ============================================================
    # 4. Status Validation & Constraints
    # ============================================================
    def test_invalid_status_is_rejected(self):
        """PATCH /incidents/{id} must reject invalid status values with 400 Bad Request."""
        coordinator_user = {
            "id": "coordinator-uuid-1",
            "role": "command_center",
            "email": "cmd@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: coordinator_user

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
        """Every status in ALLOWED_INCIDENT_STATUSES must be accepted for command_center."""
        cc_user = {
            "id": "coordinator-uuid-1",
            "role": "command_center",
            "email": "cmd@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: cc_user

        for valid_status in ALLOWED_INCIDENT_STATUSES:
            with self.subTest(status=valid_status):
                mock_table = MagicMock()
                mock_table.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-valid", "user_id": "citizen-uuid-1", "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
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

    # ============================================================
    # 5. Operational Workflow & Role Access Tests
    # ============================================================
    @patch("backend.main.supabase")
    def test_command_center_can_update_incident(self, mock_supabase):
        """Command center coordinator can update incident status and add operational notes."""
        cc_user = {
            "id": "cc-user-1",
            "role": "command_center",
            "email": "dispatch@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: cc_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-op-1", "user_id": "citizen-1", "status": "reported", "type": "Flood", "severity": 3, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-op-1", "status": "verified", "note": "Verified by radar"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-op-1", json={
            "status": "verified",
            "note": "Verified by radar"
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident"]["status"], "verified")

    @patch("backend.main.supabase")
    def test_command_center_can_progress_workflow(self, mock_supabase):
        """Command center can move incidents through the complete operational workflow."""
        cc_user = {
            "id": "cc-user-1",
            "role": "command_center",
            "email": "dispatch@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: cc_user

        workflow_sequence = ["verified", "assigned", "in_progress", "resolved"]
        for st in workflow_sequence:
            with self.subTest(status=st):
                mock_table = MagicMock()
                mock_table.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-flow", "user_id": "citizen-1", "status": "reported", "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
                ]
                mock_table.update.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-flow", "status": st}
                ]
                mock_supabase.table.return_value = mock_table

                response = self.client.patch("/incidents/inc-flow", json={"status": st})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["incident"]["status"], st)

    @patch("backend.main.supabase")
    def test_responder_can_update_incident_workflow(self, mock_supabase):
        """Responder can update incident to in_progress and resolved with field notes."""
        responder_user = {
            "id": "responder-user-1",
            "role": "responder",
            "email": "unit1@rescue.gov",
        }
        app.dependency_overrides[get_current_user] = lambda: responder_user

        for st in ["in_progress", "resolved"]:
            with self.subTest(status=st):
                mock_table = MagicMock()
                mock_table.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-resp", "user_id": "citizen-1", "status": "assigned", "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
                ]
                mock_table.update.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-resp", "status": st, "note": f"Field note for {st}"}
                ]
                mock_supabase.table.return_value = mock_table

                response = self.client.patch("/incidents/inc-resp", json={
                    "status": st,
                    "note": f"Field note for {st}"
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["incident"]["status"], st)

    @patch("backend.main.supabase")
    def test_citizen_cannot_set_operational_statuses(self, mock_supabase):
        """Citizens cannot mark incidents as verified, assigned, in_progress, or resolved."""
        citizen_user = {
            "id": "citizen-user-1",
            "role": "citizen",
            "email": "citizen@test.com",
        }
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-own", "user_id": "citizen-user-1"}
        ]
        mock_supabase.table.return_value = mock_table

        operational_statuses = ["verified", "assigned", "in_progress", "resolved"]
        for op_status in operational_statuses:
            with self.subTest(op_status=op_status):
                response = self.client.patch("/incidents/inc-own", json={
                    "status": op_status
                })
                self.assertEqual(response.status_code, 403)
                self.assertIn("Citizens may only cancel or provide notes", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_citizen_can_cancel_own_incident(self, mock_supabase):
        """Citizens can cancel their own incident report."""
        citizen_user = {
            "id": "citizen-user-1",
            "role": "citizen",
            "email": "citizen@test.com",
        }
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-own", "user_id": "citizen-user-1", "type": "Fire", "severity": 2, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-own", "status": "cancelled", "note": "False alarm"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-own", json={
            "status": "cancelled",
            "note": "False alarm"
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident"]["status"], "cancelled")

    @patch("backend.main.supabase")
    def test_unauthorized_role_cannot_update_incident(self, mock_supabase):
        """Users with non-operational roles cannot update incidents."""
        unauthorized_user = {
            "id": "guest-user-1",
            "role": "external_guest",
            "email": "guest@unknown.com",
        }
        app.dependency_overrides[get_current_user] = lambda: unauthorized_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-any", "user_id": "citizen-9"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-any", json={"status": "in_progress"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("You do not have permission to update incidents", response.json()["detail"])

    # ============================================================
    # 6. Milestone 3: Deterministic Smart Priority Calculation
    # ============================================================
    def test_deterministic_priority_calculation(self):
        """Verify deterministic calculation returns expected scores."""
        # Severity 3 (30) + Flood (15) + Reported (15) + 0 aging = 60
        score = calculate_priority_score(
            severity=3,
            hazard_type="Flood",
            status="reported",
            created_at=None,
            assigned_to=None
        )
        self.assertEqual(score, 60)
        self.assertEqual(get_priority_tier(score), "HIGH")

    def test_high_severity_high_hazard_priority(self):
        """Verify high severity + high hazard produces critical priority."""
        # Severity 5 (50) + Medical Emergency (25) + Verified (10) + 0 aging = 85
        score = calculate_priority_score(
            severity=5,
            hazard_type="Medical Emergency",
            status="verified",
            created_at=None,
            assigned_to=None
        )
        self.assertEqual(score, 85)
        self.assertEqual(get_priority_tier(score), "CRITICAL")

    def test_low_severity_priority(self):
        """Verify low severity and routine hazard produces low priority."""
        # Severity 1 (10) + Road Accident (10) + Resolved (0) = 20
        score = calculate_priority_score(
            severity=1,
            hazard_type="Road Accident",
            status="resolved",
            created_at=None,
            assigned_to=None
        )
        self.assertEqual(score, 20)
        self.assertEqual(get_priority_tier(score), "LOW")

    def test_priority_clamping(self):
        """Verify priority scores are clamped between 1 and 100."""
        now = datetime.now(timezone.utc)
        six_hours_ago = (now - timedelta(hours=6)).isoformat()
        # Severity 5 (50) + Building Collapse (25) + Reported (15) + Max Aging (10) = 100
        max_score = calculate_priority_score(
            severity=5,
            hazard_type="Building Collapse",
            status="reported",
            created_at=six_hours_ago,
            assigned_to=None,
            now=now
        )
        self.assertEqual(max_score, 100)
        self.assertEqual(get_priority_tier(max_score), "CRITICAL")

        # Test lower bound clamp
        min_score = calculate_priority_score(
            severity=0,
            hazard_type="",
            status="cancelled",
            created_at=None,
            assigned_to=None
        )
        self.assertGreaterEqual(min_score, 1)

    # ============================================================
    # 7. Milestone 3: Dispatch & Responder Assignment RBAC
    # ============================================================
    @patch("backend.main.supabase")
    def test_command_center_can_assign_responder(self, mock_supabase):
        """Command center can assign a responder to an incident."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        resp_uuid = "00000000-0000-0000-0000-000000000001"

        def table_side_effect(table_name):
            mock = MagicMock()
            if table_name == "incidents":
                mock.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "reported", "severity": 4, "type": "Fire", "created_at": "2026-10-02T00:00:00Z"}
                ]
                mock.update.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "assigned", "assigned_to": resp_uuid, "severity": 4, "type": "Fire"}
                ]
            elif table_name == "profiles":
                mock.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
                    {"id": resp_uuid, "role": "responder", "full_name": "Officer Dave"}
                ]
            return mock

        mock_supabase.table.side_effect = table_side_effect

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": resp_uuid})
        self.assertEqual(response.status_code, 200)
        data = response.json()["incident"]
        self.assertEqual(data["assigned_to"], resp_uuid)
        self.assertEqual(data["status"], "assigned")

    @patch("backend.main.supabase")
    def test_admin_can_assign_responder(self, mock_supabase):
        """Admin can assign a responder to an incident."""
        admin_user = {"id": "admin-1", "role": "admin", "email": "admin@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: admin_user

        resp_uuid = "00000000-0000-0000-0000-000000000001"

        def table_side_effect(table_name):
            mock = MagicMock()
            if table_name == "incidents":
                mock.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "verified", "severity": 3, "type": "Flood", "created_at": "2026-10-02T00:00:00Z"}
                ]
                mock.update.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "assigned", "assigned_to": resp_uuid, "severity": 3, "type": "Flood"}
                ]
            elif table_name == "profiles":
                mock.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
                    {"id": resp_uuid, "role": "responder", "full_name": "Officer Dave"}
                ]
            return mock

        mock_supabase.table.side_effect = table_side_effect

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": resp_uuid})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident"]["status"], "assigned")

    @patch("backend.main.supabase")
    def test_command_center_can_unassign(self, mock_supabase):
        """Command center can explicitly unassign an incident with null."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        def table_side_effect(table_name):
            mock = MagicMock()
            if table_name == "incidents":
                mock.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "assigned", "assigned_to": "some-uuid", "severity": 3, "type": "Flood", "created_at": "2026-10-02T00:00:00Z"}
                ]
                mock.update.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "verified", "assigned_to": None, "severity": 3, "type": "Flood"}
                ]
            return mock

        mock_supabase.table.side_effect = table_side_effect

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": None})
        self.assertEqual(response.status_code, 200)
        data = response.json()["incident"]
        self.assertIsNone(data["assigned_to"])
        self.assertEqual(data["status"], "verified")

    def test_invalid_responder_uuid_rejected(self):
        """Invalid responder UUID is rejected with 400 Bad Request."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": "not-a-uuid"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid responder UUID", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_non_responder_target_rejected(self, mock_supabase):
        """Target user that does not have role 'responder' is rejected with 400."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        citizen_target = "00000000-0000-0000-0000-000000000099"

        def table_side_effect(table_name):
            mock = MagicMock()
            if table_name == "incidents":
                mock.select.return_value.eq.return_value.execute.return_value.data = [
                    {"id": "inc-1", "status": "reported", "severity": 3, "type": "Flood", "created_at": "2026-10-02T00:00:00Z"}
                ]
            elif table_name == "profiles":
                mock.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
                    {"id": citizen_target, "role": "citizen", "full_name": "Regular Joe"}
                ]
            return mock

        mock_supabase.table.side_effect = table_side_effect

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": citizen_target})
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a responder", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_citizen_cannot_assign(self, mock_supabase):
        """Citizen cannot set assigned_to (403 Forbidden)."""
        citizen_user = {"id": "cit-1", "role": "citizen", "email": "cit@test.com"}
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "user_id": "cit-1", "status": "reported"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": "00000000-0000-0000-0000-000000000001"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Only command_center or admin roles may assign", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_responder_cannot_assign(self, mock_supabase):
        """Responder cannot set assigned_to (403 Forbidden)."""
        resp_user = {"id": "resp-1", "role": "responder", "email": "resp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: resp_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "user_id": "cit-1", "status": "assigned"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": "00000000-0000-0000-0000-000000000002"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Only command_center or admin roles may assign", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_hospital_cannot_assign(self, mock_supabase):
        """Hospital role cannot set assigned_to (403 Forbidden)."""
        hosp_user = {"id": "hosp-1", "role": "hospital", "email": "hosp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: hosp_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "user_id": "cit-1", "status": "reported"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": "00000000-0000-0000-0000-000000000001"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Only command_center or admin roles may assign", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_shelter_cannot_assign(self, mock_supabase):
        """Shelter role cannot set assigned_to (403 Forbidden)."""
        shelter_user = {"id": "shelter-1", "role": "shelter", "email": "shelter@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: shelter_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "user_id": "cit-1", "status": "reported"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": "00000000-0000-0000-0000-000000000001"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Only command_center or admin roles may assign", response.json()["detail"])

    # ============================================================
    # 8. Milestone 3: Responder Permissions Boundary
    # ============================================================
    @patch("backend.main.supabase")
    def test_responder_cannot_verify(self, mock_supabase):
        """Responder cannot mark incident verified (403 Forbidden)."""
        resp_user = {"id": "resp-1", "role": "responder", "email": "resp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: resp_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "reported"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"status": "verified"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Responders may only mark incidents in_progress or resolved", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_responder_cannot_cancel(self, mock_supabase):
        """Responder cannot mark incident cancelled (403 Forbidden)."""
        resp_user = {"id": "resp-1", "role": "responder", "email": "resp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: resp_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "in_progress"}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"status": "cancelled"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Responders may only mark incidents in_progress or resolved", response.json()["detail"])

    @patch("backend.main.supabase")
    def test_responder_can_mark_in_progress(self, mock_supabase):
        """Responder can mark incident in_progress."""
        resp_user = {"id": "resp-1", "role": "responder", "email": "resp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: resp_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "assigned", "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "in_progress", "type": "Fire", "severity": 4}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"status": "in_progress"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident"]["status"], "in_progress")

    @patch("backend.main.supabase")
    def test_responder_can_mark_resolved(self, mock_supabase):
        """Responder can mark incident resolved."""
        resp_user = {"id": "resp-1", "role": "responder", "email": "resp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: resp_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "in_progress", "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "resolved", "type": "Fire", "severity": 4}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"status": "resolved"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["incident"]["status"], "resolved")

    # ============================================================
    # 9. Milestone 3: GET /responders Access & Listing
    # ============================================================
    @patch("backend.main.supabase")
    def test_get_responders_accessible_to_command_center(self, mock_supabase):
        """GET /responders is accessible to command_center."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.order.return_value.execute.return_value.data = [
            {"id": "resp-uuid-1", "full_name": "Alice Officer", "role": "responder"},
            {"id": "resp-uuid-2", "full_name": "Bob Medic", "role": "responder"},
        ]
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/responders")
        self.assertEqual(response.status_code, 200)
        responders = response.json()["responders"]
        self.assertEqual(len(responders), 2)
        self.assertEqual(responders[0]["full_name"], "Alice Officer")

    @patch("backend.main.supabase")
    def test_get_responders_accessible_to_admin(self, mock_supabase):
        """GET /responders is accessible to admin."""
        admin_user = {"id": "admin-1", "role": "admin", "email": "admin@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: admin_user

        mock_query = MagicMock()
        mock_query.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []
        mock_supabase.table.return_value = mock_query

        response = self.client.get("/responders")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["responders"], [])

    def test_get_responders_forbidden_for_citizen(self):
        """GET /responders returns 403 Forbidden for citizen."""
        citizen_user = {"id": "cit-1", "role": "citizen", "email": "cit@test.com"}
        app.dependency_overrides[get_current_user] = lambda: citizen_user

        response = self.client.get("/responders")
        self.assertEqual(response.status_code, 403)

    def test_get_responders_forbidden_for_responder(self):
        """GET /responders returns 403 Forbidden for responder."""
        resp_user = {"id": "resp-1", "role": "responder", "email": "resp@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: resp_user

        response = self.client.get("/responders")
        self.assertEqual(response.status_code, 403)

    # ============================================================
    # 10. Milestone 3: Assignment Workflow Semantics
    # ============================================================
    @patch("backend.main.supabase")
    def test_omitted_assigned_to_preserves_assignment(self, mock_supabase):
        """Omitting assigned_to in PATCH payload does not overwrite existing assignment."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        existing_assigned_id = "00000000-0000-0000-0000-000000000001"

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "assigned", "assigned_to": existing_assigned_id, "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "assigned", "assigned_to": existing_assigned_id, "note": "Updated note", "type": "Fire", "severity": 4}
        ]
        mock_supabase.table.return_value = mock_table

        # Payload does NOT contain assigned_to
        response = self.client.patch("/incidents/inc-1", json={"note": "Updated note"})
        self.assertEqual(response.status_code, 200)

        # Verify update call did not include assigned_to in update dict
        update_args = mock_table.update.call_args[0][0]
        self.assertNotIn("assigned_to", update_args)

    @patch("backend.main.supabase")
    def test_explicit_assigned_to_null_unassigns(self, mock_supabase):
        """Explicitly passing assigned_to: null unassigns the incident."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "assigned", "assigned_to": "00000000-0000-0000-0000-000000000001", "type": "Fire", "severity": 4, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "verified", "assigned_to": None, "type": "Fire", "severity": 4}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": None})
        self.assertEqual(response.status_code, 200)

        update_args = mock_table.update.call_args[0][0]
        self.assertIn("assigned_to", update_args)
        self.assertIsNone(update_args["assigned_to"])

    @patch("backend.main.supabase")
    def test_assignment_automatically_changes_reported_or_verified_to_assigned(self, mock_supabase):
        """Assigning a responder to a reported or verified incident automatically sets status to assigned."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        resp_uuid = "00000000-0000-0000-0000-000000000001"

        for initial_status in ["reported", "verified"]:
            with self.subTest(initial_status=initial_status):
                def table_side_effect(table_name):
                    mock = MagicMock()
                    if table_name == "incidents":
                        mock.select.return_value.eq.return_value.execute.return_value.data = [
                            {"id": "inc-1", "status": initial_status, "type": "Flood", "severity": 3, "created_at": "2026-10-02T00:00:00Z"}
                        ]
                        mock.update.return_value.eq.return_value.execute.return_value.data = [
                            {"id": "inc-1", "status": "assigned", "assigned_to": resp_uuid, "type": "Flood", "severity": 3}
                        ]
                    elif table_name == "profiles":
                        mock.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
                            {"id": resp_uuid, "role": "responder", "full_name": "Dave"}
                        ]
                    return mock

                mock_supabase.table.side_effect = table_side_effect

                response = self.client.patch("/incidents/inc-1", json={"assigned_to": resp_uuid})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["incident"]["status"], "assigned")

    @patch("backend.main.supabase")
    def test_unassignment_changes_assigned_to_verified(self, mock_supabase):
        """Unassigning an incident that is currently 'assigned' reverts status to 'verified'."""
        cc_user = {"id": "cc-1", "role": "command_center", "email": "cc@rescue.gov"}
        app.dependency_overrides[get_current_user] = lambda: cc_user

        mock_table = MagicMock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "assigned", "assigned_to": "00000000-0000-0000-0000-000000000001", "type": "Flood", "severity": 3, "created_at": "2026-10-02T00:00:00Z"}
        ]
        mock_table.update.return_value.eq.return_value.execute.return_value.data = [
            {"id": "inc-1", "status": "verified", "assigned_to": None, "type": "Flood", "severity": 3}
        ]
        mock_supabase.table.return_value = mock_table

        response = self.client.patch("/incidents/inc-1", json={"assigned_to": None})
        self.assertEqual(response.status_code, 200)

        update_args = mock_table.update.call_args[0][0]
        self.assertEqual(update_args["status"], "verified")
        self.assertIsNone(update_args["assigned_to"])

    # ============================================================
    # 11. Public / System Endpoints
    # ============================================================
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
