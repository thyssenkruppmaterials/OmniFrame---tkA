// Created and developed by Jai Singh
//! Data Models for Drone AI Analysis
//! 
//! Defines the structures for AI analysis results and database operations.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// Main analysis result from AI vision model
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AnalysisResult {
    #[serde(default)]
    pub texts: Vec<DetectedText>,
    
    #[serde(default)]
    pub barcodes: Vec<DetectedBarcode>,
    
    #[serde(default)]
    pub location: Option<LocationInfo>,
    
    #[serde(default)]
    pub inventory: Option<InventoryAssessment>,
    
    #[serde(default)]
    pub objects: Vec<DetectedObject>,
    
    #[serde(default)]
    pub spatial_description: String,
}

impl AnalysisResult {
    /// Convert to searchable raw text for full-text search
    pub fn to_searchable_text(&self) -> String {
        let mut parts = Vec::new();
        
        for text in &self.texts {
            parts.push(text.value.clone());
        }
        
        for barcode in &self.barcodes {
            parts.push(barcode.value.clone());
        }
        
        if let Some(ref loc) = self.location {
            if let Some(ref zone) = loc.zone {
                parts.push(zone.clone());
            }
            if let Some(ref aisle) = loc.aisle {
                parts.push(aisle.clone());
            }
            if let Some(ref shelf) = loc.shelf {
                parts.push(shelf.clone());
            }
        }
        
        parts.push(self.spatial_description.clone());
        
        parts.join(" ")
    }
}

/// Detected text with classification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedText {
    pub value: String,
    
    #[serde(rename = "type")]
    pub text_type: String,  // sku, lot, barcode, label, expiration
    
    #[serde(default)]
    pub confidence: f32,
    
    #[serde(default)]
    pub bbox: Option<Vec<f32>>,  // [x, y, width, height]
}

/// Detected barcode or QR code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedBarcode {
    pub value: String,
    
    #[serde(default)]
    pub format: String,  // UPC-A, EAN-13, QR, Code128, etc.
    
    #[serde(default)]
    pub confidence: f32,
    
    #[serde(default)]
    pub bbox: Option<Vec<f32>>,
}

/// Location information extracted from image
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocationInfo {
    pub shelf: Option<String>,
    pub aisle: Option<String>,
    pub zone: Option<String>,
    pub rack: Option<String>,
    pub level: Option<String>,
}

/// Inventory assessment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryAssessment {
    pub level: String,  // full, partial, empty
    
    #[serde(default)]
    pub estimated_fill: f32,  // 0.0 - 1.0
    
    #[serde(default)]
    pub issues: Vec<String>,
    
    #[serde(default)]
    pub damage_detected: bool,
}

/// Detected object
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedObject {
    pub label: String,
    
    #[serde(default)]
    pub confidence: f32,
    
    #[serde(default)]
    pub bbox: Option<Vec<f32>>,
    
    #[serde(default)]
    pub count: Option<i32>,
}

/// Database row for drone scan
#[derive(Debug, FromRow)]
#[allow(dead_code)] // Used by sqlx FromRow for query results
pub struct DroneScan {
    pub id: Uuid,
    pub captured_at: DateTime<Utc>,
    pub image_url: String,
    pub thumbnail_url: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lng: Option<f64>,
    pub altitude_m: Option<f64>,
    pub warehouse_zone: Option<String>,
    pub aisle: Option<String>,
    pub ai_analysis_status: String,
    pub ai_model_used: Option<String>,
    pub organization_id: Uuid,
}

/// Request to analyze an image
#[derive(Debug, Deserialize)]
pub struct AnalyzeRequest {
    pub image_url: String,
    pub scan_id: Option<Uuid>,
    pub prompt_type: Option<String>,  // warehouse, damage, barcode
    pub organization_id: Option<String>,  // For organization context validation
}

/// Request to analyze multiple images
#[derive(Debug, Deserialize)]
pub struct BatchAnalyzeRequest {
    pub images: Vec<AnalyzeRequest>,
}

/// Response for analysis
#[derive(Debug, Serialize)]
pub struct AnalyzeResponse {
    pub success: bool,
    pub scan_id: Option<Uuid>,
    pub result: Option<AnalysisResult>,
    pub provider: Option<String>,
    pub fallback_used: bool,
    pub processing_time_ms: u64,
    pub error: Option<String>,
}

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub database: String,
    pub ai_provider: String,
}

// Created and developed by Jai Singh
