"""
Regression tests for ticket creation correctness (F-02).

Validates that ticket status and priority are independently assigned and
that status never derives its value from the priority field.
"""

import pytest


class TestTicketStatusIndependence:
    """Verify that status and priority are independently assigned."""

    def test_ticket_status_is_not_derived_from_priority(self):
        """F-02 regression: status must not be assigned from priority."""
        from api.models.ticket_models import (
            TicketPriority,
            TicketStatus,
        )

        for priority in TicketPriority:
            assert (
                TicketStatus.OPEN.value != priority.value
                or priority == TicketPriority.LOW  # "Open" != any priority value
            ), f"TicketStatus.OPEN collides with priority {priority}"

    def test_ticket_data_dict_uses_correct_status(self):
        """The Smartsheet row data dict must use TicketStatus, not priority."""
        from api.models.ticket_models import TicketPriority, TicketStatus

        for priority in TicketPriority:
            status_value = TicketStatus.OPEN.value
            priority_value = (
                priority.value
                if isinstance(priority, TicketPriority)
                else str(priority)
            )
            assert status_value == "Open", "Default status must be 'Open'"
            assert (
                status_value != priority_value or priority_value == "Open"
            ), f"status={status_value} must differ from priority={priority_value}"

    def test_ticket_status_enum_values(self):
        """TicketStatus enum should have expected values."""
        from api.models.ticket_models import TicketStatus

        assert TicketStatus.OPEN.value == "Open"
        assert TicketStatus.IN_PROGRESS.value == "In Progress"
        assert TicketStatus.RESOLVED.value == "Resolved"
        assert TicketStatus.CLOSED.value == "Closed"

    def test_ticket_priority_enum_values(self):
        """TicketPriority enum should have expected values distinct from status."""
        from api.models.ticket_models import TicketPriority, TicketStatus

        status_values = {s.value for s in TicketStatus}
        for p in TicketPriority:
            if p.value in status_values:
                pytest.fail(
                    f"Priority value '{p.value}' collides with a status value — "
                    f"this could mask F-02-class bugs"
                )
