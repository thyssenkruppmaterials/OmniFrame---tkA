//! Hugging Face Inference API Client
//! 
//! Provides async client for Qwen3-VL-8B-Instruct vision-language model.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const HF_API_URL: &str = "https://api-inference.huggingface.co/models/Qwen/Qwen3-VL-8B-Instruct";

#[derive(Error, Debug)]
pub enum HuggingFaceError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    
    #[error("API error: {0}")]
    ApiError(String),
    
    #[error("Model is loading, retry later")]
    ModelLoading,
    
    #[error("Rate limited, retry after {0} seconds")]
    RateLimited(u64),
    
    #[error("Invalid response format: {0}")]
    InvalidResponse(String),
    
    #[error("JSON parsing error: {0}")]
    JsonError(#[from] serde_json::Error),
}

#[derive(Serialize)]
struct HFRequest {
    inputs: HFInputs,
    parameters: HFParameters,
}

#[derive(Serialize)]
struct HFInputs {
    image: String,
    text: String,
}

#[derive(Serialize)]
struct HFParameters {
    max_new_tokens: u32,
    temperature: f32,
    top_p: f32,
    return_full_text: bool,
}

#[derive(Deserialize, Debug)]
struct HFResponse {
    generated_text: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize, Debug)]
struct HFErrorResponse {
    error: String,
    #[allow(dead_code)] // Present in HF API response shape; needed for deserialization
    estimated_time: Option<f64>,
}

/// Hugging Face API client for vision-language inference
pub struct HuggingFaceClient {
    client: Client,
    api_key: String,
}

impl HuggingFaceClient {
    pub fn new(api_key: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client");
        
        Self { client, api_key }
    }
    
    /// Analyze an image with the given prompt
    /// 
    /// # Arguments
    /// * `image_url` - Public URL to the image
    /// * `prompt` - Analysis prompt
    /// 
    /// # Returns
    /// Raw response text from the model
    pub async fn analyze(&self, image_url: &str, prompt: &str) -> Result<String, HuggingFaceError> {
        tracing::debug!("Sending request to Hugging Face API");
        
        let request = HFRequest {
            inputs: HFInputs {
                image: image_url.to_string(),
                text: prompt.to_string(),
            },
            parameters: HFParameters {
                max_new_tokens: 2048,
                temperature: 0.7,
                top_p: 0.8,
                return_full_text: false,
            },
        };
        
        let response = self.client
            .post(HF_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;
        
        let status = response.status();
        
        // Handle rate limiting
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(60);
            return Err(HuggingFaceError::RateLimited(retry_after));
        }
        
        // Handle service unavailable (model loading)
        if status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
            let body: HFErrorResponse = response.json().await?;
            if body.error.contains("loading") {
                return Err(HuggingFaceError::ModelLoading);
            }
            return Err(HuggingFaceError::ApiError(body.error));
        }
        
        // Handle other errors
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(HuggingFaceError::ApiError(format!(
                "Status {}: {}", status, body
            )));
        }
        
        // Parse successful response
        let body = response.text().await?;
        
        // Try to parse as array (HF often returns array of results)
        if let Ok(results) = serde_json::from_str::<Vec<HFResponse>>(&body) {
            if let Some(first) = results.first() {
                if let Some(text) = &first.generated_text {
                    return Ok(text.clone());
                }
                if let Some(error) = &first.error {
                    return Err(HuggingFaceError::ApiError(error.clone()));
                }
            }
        }
        
        // Try to parse as single object
        if let Ok(result) = serde_json::from_str::<HFResponse>(&body) {
            if let Some(text) = result.generated_text {
                return Ok(text);
            }
            if let Some(error) = result.error {
                return Err(HuggingFaceError::ApiError(error));
            }
        }
        
        // Return raw body if can't parse
        Ok(body)
    }
    
    /// Analyze with base64-encoded image
    #[allow(dead_code)] // Public API for callers that have base64 image data
    pub async fn analyze_base64(&self, image_base64: &str, prompt: &str) -> Result<String, HuggingFaceError> {
        let image_data = format!("data:image/jpeg;base64,{}", image_base64);
        self.analyze(&image_data, prompt).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_client_creation() {
        let client = HuggingFaceClient::new("test_key".to_string());
        assert!(!client.api_key.is_empty());
    }
}
