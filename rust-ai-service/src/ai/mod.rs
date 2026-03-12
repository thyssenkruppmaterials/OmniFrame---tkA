//! AI Vision Analysis Module
//! 
//! Provides AI-powered image analysis using Hugging Face Inference API
//! with Qwen3-VL-8B-Instruct model, with fallback to Novita.

mod huggingface;
mod novita;
mod prompts;
mod fallback;

pub use fallback::AIService;
pub use prompts::{WAREHOUSE_ANALYSIS_PROMPT, DAMAGE_DETECTION_PROMPT, BARCODE_FOCUS_PROMPT};
