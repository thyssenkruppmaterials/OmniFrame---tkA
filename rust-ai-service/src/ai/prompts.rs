// Created and developed by Jai Singh
//! Warehouse-Specific Prompt Templates for AI Analysis
//! 
//! These prompts are optimized for Qwen3-VL to extract structured
//! information from warehouse drone images.

/// Main analysis prompt for comprehensive warehouse image analysis
pub const WAREHOUSE_ANALYSIS_PROMPT: &str = r#"
Analyze this warehouse drone image and extract information in JSON format.

Extract:
1. **Text/Labels**: All visible text including SKUs, lot numbers, barcodes, expiration dates
2. **Location**: Shelf position, aisle markers, zone indicators  
3. **Inventory Status**: Stock levels (full/partial/empty), any damage or issues
4. **Objects**: Products, pallets, equipment visible

Return ONLY valid JSON in this exact format:
{
  "texts": [
    {"value": "SKU12345", "type": "sku", "confidence": 0.95, "bbox": [x,y,w,h]},
    {"value": "LOT-2025-001", "type": "lot", "confidence": 0.92, "bbox": [x,y,w,h]}
  ],
  "barcodes": [
    {"value": "012345678905", "format": "UPC-A", "bbox": [x,y,w,h]}
  ],
  "location": {
    "shelf": "B3",
    "aisle": "A12", 
    "zone": "Receiving"
  },
  "inventory": {
    "level": "partial",
    "estimated_fill": 0.65,
    "issues": ["items_misaligned"],
    "damage_detected": false
  },
  "objects": [
    {"label": "cardboard_box", "confidence": 0.89, "count": 12}
  ],
  "spatial_description": "Warehouse shelf B3 in aisle A12 showing partially stocked cardboard boxes. SKU labels visible on front-facing items."
}
"#;

/// Prompt focused on damage and safety issue detection
pub const DAMAGE_DETECTION_PROMPT: &str = r#"
Inspect this warehouse image for any damage, safety issues, or inventory problems.

Focus on:
- Torn or damaged packaging
- Water damage or stains
- Fallen or misplaced items
- Blocked aisles or safety hazards
- Expired products (if dates visible)
- Structural damage to shelving

Return JSON with this format:
{
  "damage_report": [
    {
      "type": "torn_packaging",
      "description": "Box on shelf B3 has visible tear on top",
      "severity": "low",
      "bbox": [x,y,w,h]
    }
  ],
  "safety_issues": [
    {
      "type": "blocked_aisle",
      "description": "Pallet blocking aisle A12",
      "severity": "medium"
    }
  ],
  "overall_severity": "low",
  "requires_attention": true,
  "summary": "Minor packaging damage detected, one blocked aisle"
}

Severity levels: low, medium, high, critical
"#;

/// Prompt focused specifically on barcode and QR code extraction
pub const BARCODE_FOCUS_PROMPT: &str = r#"
Extract ALL barcodes and QR codes visible in this warehouse image.

For each code found, provide:
- value: The decoded content
- format: UPC-A, UPC-E, EAN-13, EAN-8, Code-128, Code-39, QR, DataMatrix
- confidence: How confident you are in the reading (0.0-1.0)
- bbox: Bounding box coordinates [x, y, width, height]
- readable: Whether the code appears clear enough to scan

Return JSON array:
{
  "barcodes": [
    {
      "value": "012345678905",
      "format": "UPC-A",
      "confidence": 0.95,
      "bbox": [100, 200, 150, 50],
      "readable": true
    },
    {
      "value": "https://example.com/product/123",
      "format": "QR",
      "confidence": 0.88,
      "bbox": [300, 150, 100, 100],
      "readable": true
    }
  ],
  "total_found": 2,
  "unreadable_count": 0
}
"#;

/// Prompt for quick OCR-only extraction (faster, less comprehensive)
#[allow(dead_code)] // Available prompt template for API consumers
pub const QUICK_OCR_PROMPT: &str = r#"
Extract all visible text from this warehouse image.
Return as a simple JSON object with array of text items:
{
  "texts": ["SKU12345", "LOT-2025-001", "QTY: 50"],
  "raw_text": "SKU12345 LOT-2025-001 QTY: 50"
}
"#;

/// Prompt for inventory level assessment only
#[allow(dead_code)] // Available prompt template for API consumers
pub const INVENTORY_LEVEL_PROMPT: &str = r#"
Assess the inventory level shown in this warehouse shelf image.
Estimate how full each visible shelf section is.

Return JSON:
{
  "sections": [
    {"position": "top", "fill_level": 0.8, "status": "full"},
    {"position": "middle", "fill_level": 0.3, "status": "partial"},
    {"position": "bottom", "fill_level": 0.0, "status": "empty"}
  ],
  "overall_fill": 0.37,
  "restock_needed": true,
  "priority": "medium"
}
"#;

// Created and developed by Jai Singh
