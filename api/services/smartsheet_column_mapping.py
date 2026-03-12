"""
Column mapping configuration for Smartsheet ticket management.
Maps application fields to Smartsheet column IDs for sheet 2987059899748228.
"""

from typing import Dict, Optional, Any, List
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class TicketColumn(str, Enum):
    """Ticket column identifiers."""
    TICKET_ID = "ticket_id"
    CUSTOMER_ID = "customer_id"
    CUSTOMER_EMAIL = "customer_email"
    SUBJECT = "subject"
    DESCRIPTION = "description"
    STATUS = "status"
    PRIORITY = "priority"
    CATEGORY = "category"
    ASSIGNED_TO = "assigned_to"
    NOTES = "notes"
    CREATED_DATE = "created_date"
    UPDATED_DATE = "updated_date"
    TKA_UPDATES = "tka_updates"
    ROLLS_ROYCE_UPDATES = "rolls_royce_updates"
    RESOLUTION = "resolution"
    ILC_DEPARTMENT = "ilc_department"
    REQUESTOR_NAME = "requestor_name"


class SmartsheetColumnMapper:
    """
    Manages column mapping between application fields and Smartsheet columns.
    Dynamically discovers column IDs from the sheet structure.
    """
    
    def __init__(self):
        """Initialize column mapper."""
        self._column_map: Dict[str, int] = {}
        self._column_names: Dict[str, str] = {
            TicketColumn.TICKET_ID: "Request ID",
            TicketColumn.CUSTOMER_ID: "Customer ID",
            TicketColumn.CUSTOMER_EMAIL: "Customer Email",
            TicketColumn.SUBJECT: "Subject",
            TicketColumn.DESCRIPTION: "Request Notes",
            TicketColumn.STATUS: "Status",
            TicketColumn.PRIORITY: "Priority",
            TicketColumn.CATEGORY: "Category",
            TicketColumn.ASSIGNED_TO: "Assigned To",
            TicketColumn.NOTES: "Notes",
            TicketColumn.CREATED_DATE: "Created Date",
            TicketColumn.UPDATED_DATE: "Updated Date",
            TicketColumn.TKA_UPDATES: "TKA Updates",
            TicketColumn.ROLLS_ROYCE_UPDATES: "Rolls Royce Updates",
            TicketColumn.RESOLUTION: "Resolution",
            TicketColumn.ILC_DEPARTMENT: "ILC Department",
            TicketColumn.REQUESTOR_NAME: "Requestor Name",
        }
        self._is_initialized = False
    
    def initialize_from_sheet(self, sheet_data: Dict[str, Any]) -> None:
        """
        Initialize column mapping from sheet structure.
        
        Args:
            sheet_data: Sheet data including columns information
        """
        if not sheet_data or 'columns' not in sheet_data:
            raise ValueError("Invalid sheet data: missing columns")
        
        columns = sheet_data['columns']
        
        # Build mapping from column names to IDs
        for column in columns:
            column_title = column.get('title', '').strip()
            column_id = column.get('id')
            
            # Match column titles to our field names
            for field_key, expected_title in self._column_names.items():
                if column_title.lower() == expected_title.lower():
                    self._column_map[field_key] = column_id
                    logger.debug(f"Mapped {field_key} to column ID {column_id} ('{column_title}')")
                    break
        
        # Check for required columns
        required_columns = [
            TicketColumn.TICKET_ID,
            TicketColumn.CUSTOMER_ID,
            TicketColumn.CUSTOMER_EMAIL,
            TicketColumn.SUBJECT,
            TicketColumn.STATUS
        ]
        
        missing_columns = [col for col in required_columns if col not in self._column_map]
        if missing_columns:
            logger.warning(f"Missing required columns: {missing_columns}")
            logger.info("Available columns: " + ", ".join([col.get('title', 'Unknown') for col in columns]))
        
        self._is_initialized = True
        logger.info(f"Column mapping initialized with {len(self._column_map)} columns")
    
    def get_column_id(self, field: str) -> Optional[int]:
        """
        Get Smartsheet column ID for a field.
        
        Args:
            field: Field identifier
            
        Returns:
            Column ID or None if not found
        """
        return self._column_map.get(field)
    
    def get_all_mappings(self) -> Dict[str, int]:
        """Get all column mappings."""
        return self._column_map.copy()
    
    def is_initialized(self) -> bool:
        """Check if mapper is initialized."""
        return self._is_initialized
    
    def create_cell_updates(self, ticket_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Create cell updates for ticket data.
        
        Args:
            ticket_data: Dictionary of ticket field values
            
        Returns:
            List of cell update objects
        """
        if not self._is_initialized:
            raise RuntimeError("Column mapper not initialized. Call initialize_from_sheet() first.")
        
        cells = []
        
        for field, value in ticket_data.items():
            column_id = self.get_column_id(field)
            if column_id and value is not None:
                cells.append({
                    'column_id': column_id,
                    'value': str(value) if not isinstance(value, (int, float, bool)) else value
                })
        
        return cells
    
    def parse_row_to_ticket(self, row_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse Smartsheet row data to ticket dictionary.
        
        Args:
            row_data: Row data from Smartsheet
            
        Returns:
            Dictionary of ticket fields
        """
        if not self._is_initialized:
            raise RuntimeError("Column mapper not initialized. Call initialize_from_sheet() first.")
        
        ticket = {
            'row_id': row_data.get('id'),
            'created_at': row_data.get('created_at'),
            'modified_at': row_data.get('modified_at'),
        }
        
        # Reverse lookup: column_id -> field_name
        id_to_field = {v: k for k, v in self._column_map.items()}
        
        # Extract cell values
        cells = row_data.get('cells', [])
        for cell in cells:
            column_id = cell.get('column_id')
            field_name = id_to_field.get(column_id)
            
            if field_name:
                value = cell.get('value')
                display_value = cell.get('display_value')
                # Prefer display_value for formatted fields, fallback to value
                ticket[field_name] = display_value if display_value is not None else value
        
        return ticket
    
    def get_primary_column_id(self) -> Optional[int]:
        """Get the primary column ID (Ticket ID)."""
        return self.get_column_id(TicketColumn.TICKET_ID)
    
    def get_customer_email_column_id(self) -> Optional[int]:
        """Get the customer email column ID for filtering."""
        return self.get_column_id(TicketColumn.CUSTOMER_EMAIL)
    
    def get_customer_id_column_id(self) -> Optional[int]:
        """Get the customer ID column ID for filtering."""
        return self.get_column_id(TicketColumn.CUSTOMER_ID)


# Global column mapper instance
_column_mapper: Optional[SmartsheetColumnMapper] = None


def get_column_mapper() -> SmartsheetColumnMapper:
    """Get the global column mapper instance."""
    global _column_mapper
    if _column_mapper is None:
        _column_mapper = SmartsheetColumnMapper()
    return _column_mapper


def reset_column_mapper():
    """Reset the global column mapper (useful for testing)."""
    global _column_mapper
    _column_mapper = None

# Developer and Creator: Jai Singh

