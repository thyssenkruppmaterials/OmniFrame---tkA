// Created and developed by Jai Singh
//! AI Service with Fallback Chain
//! 
//! Coordinates between Hugging Face and Novita APIs with automatic
//! retry and fallback logic.

use backoff::{future::retry, ExponentialBackoff};
use std::time::Duration;
use thiserror::Error;

use super::huggingface::{HuggingFaceClient, HuggingFaceError};
use super::novita::{NovitaClient, NovitaError};
use super::prompts::WAREHOUSE_ANALYSIS_PROMPT;
use crate::models::AnalysisResult;

#[derive(Error, Debug)]
pub enum AIError {
    #[error("Hugging Face error: {0}")]
    HuggingFace(#[from] HuggingFaceError),
    
    #[error("Novita error: {0}")]
    Novita(#[from] NovitaError),
    
    #[error("All providers failed")]
    AllProvidersFailed,
    
    #[error("Failed to parse AI response: {0}")]
    ParseError(String),
    
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// Analysis result with provider metadata
#[derive(Debug)]
pub struct AIAnalysisResult {
    pub result: AnalysisResult,
    pub provider: String,
    pub fallback_used: bool,
    pub processing_time_ms: u64,
}

/// Main AI service with fallback chain
pub struct AIService {
    hf_client: HuggingFaceClient,
    novita_client: Option<NovitaClient>,
    _max_retries: u32,
}

impl AIService {
    pub fn new(hf_api_key: String, novita_api_key: Option<String>) -> Self {
        let hf_client = HuggingFaceClient::new(hf_api_key);
        let novita_client = novita_api_key.map(NovitaClient::new);
        
        Self {
            hf_client,
            novita_client,
            _max_retries: 3,
        }
    }
    
    /// Analyze an image with automatic retries and fallback
    pub async fn analyze(&self, image_url: &str) -> Result<AIAnalysisResult, AIError> {
        self.analyze_with_prompt(image_url, WAREHOUSE_ANALYSIS_PROMPT).await
    }
    
    /// Analyze with a custom prompt
    pub async fn analyze_with_prompt(
        &self, 
        image_url: &str, 
        prompt: &str
    ) -> Result<AIAnalysisResult, AIError> {
        let start = std::time::Instant::now();
        
        // Try Hugging Face first with retries
        match self.try_huggingface(image_url, prompt).await {
            Ok(text) => {
                let result = self.parse_response(&text)?;
                return Ok(AIAnalysisResult {
                    result,
                    provider: "huggingface".to_string(),
                    fallback_used: false,
                    processing_time_ms: start.elapsed().as_millis() as u64,
                });
            }
            Err(e) => {
                tracing::warn!("Hugging Face failed: {:?}, trying fallback", e);
            }
        }
        
        // Try Novita fallback
        if let Some(ref novita) = self.novita_client {
            match self.try_novita(novita, image_url, prompt).await {
                Ok(text) => {
                    let result = self.parse_response(&text)?;
                    return Ok(AIAnalysisResult {
                        result,
                        provider: "novita".to_string(),
                        fallback_used: true,
                        processing_time_ms: start.elapsed().as_millis() as u64,
                    });
                }
                Err(e) => {
                    tracing::warn!("Novita fallback failed: {:?}", e);
                }
            }
        }
        
        Err(AIError::AllProvidersFailed)
    }
    
    async fn try_huggingface(&self, image_url: &str, prompt: &str) -> Result<String, HuggingFaceError> {
        let backoff = ExponentialBackoff {
            max_elapsed_time: Some(Duration::from_secs(60)),
            max_interval: Duration::from_secs(10),
            ..Default::default()
        };
        
        let image_url = image_url.to_string();
        let prompt = prompt.to_string();
        
        retry(backoff, || async {
            self.hf_client.analyze(&image_url, &prompt).await
                .map_err(|e| {
                    match &e {
                        HuggingFaceError::ModelLoading => backoff::Error::transient(e),
                        HuggingFaceError::RateLimited(_) => backoff::Error::transient(e),
                        _ => backoff::Error::permanent(e),
                    }
                })
        }).await
    }
    
    async fn try_novita(
        &self, 
        client: &NovitaClient, 
        image_url: &str, 
        prompt: &str
    ) -> Result<String, NovitaError> {
        let backoff = ExponentialBackoff {
            max_elapsed_time: Some(Duration::from_secs(30)),
            max_interval: Duration::from_secs(5),
            ..Default::default()
        };
        
        let image_url = image_url.to_string();
        let prompt = prompt.to_string();
        
        retry(backoff, || async {
            client.analyze(&image_url, &prompt).await
                .map_err(|e| {
                    match &e {
                        NovitaError::RateLimited => backoff::Error::transient(e),
                        _ => backoff::Error::permanent(e),
                    }
                })
        }).await
    }
    
    fn parse_response(&self, text: &str) -> Result<AnalysisResult, AIError> {
        // Try to extract JSON from the response
        // The model might include explanatory text before/after JSON
        
        let json_str = self.extract_json(text);
        
        serde_json::from_str::<AnalysisResult>(&json_str)
            .map_err(|e| AIError::ParseError(format!(
                "Failed to parse JSON: {}. Raw response: {}", e, &text[..text.len().min(500)]
            )))
    }
    
    fn extract_json(&self, text: &str) -> String {
        // Find JSON block in response
        // Models often wrap JSON in code blocks or add text before/after
        
        // Try to find ```json ... ``` block
        if let Some(start) = text.find("```json") {
            if let Some(end) = text[start + 7..].find("```") {
                return text[start + 7..start + 7 + end].trim().to_string();
            }
        }
        
        // Try to find { ... } block
        if let Some(start) = text.find('{') {
            if let Some(end) = text.rfind('}') {
                if end > start {
                    return text[start..=end].to_string();
                }
            }
        }
        
        // Return original text if no JSON found
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_json_from_code_block() {
        let service = AIService::new("test".to_string(), None);
        let text = r#"Here's the analysis:
```json
{"texts": [], "barcodes": []}
```
That's the result."#;
        
        let json = service.extract_json(text);
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }
    
    #[test]
    fn test_extract_json_direct() {
        let service = AIService::new("test".to_string(), None);
        let text = r#"{"texts": [], "barcodes": []}"#;
        
        let json = service.extract_json(text);
        assert_eq!(json, text);
    }
}

// Created and developed by Jai Singh
