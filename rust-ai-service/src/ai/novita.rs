// Created and developed by Jai Singh
//! Novita AI API Client (Fallback Provider)
//! 
//! Provides OpenAI-compatible API access to Qwen3-VL-8B-Instruct
//! as a fallback when Hugging Face API is unavailable.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const NOVITA_API_URL: &str = "https://api.novita.ai/v3/openai/chat/completions";

#[derive(Error, Debug)]
pub enum NovitaError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    
    #[error("API error: {0}")]
    ApiError(String),
    
    #[error("Rate limited")]
    RateLimited,
    
    #[error("JSON parsing error: {0}")]
    JsonError(#[from] serde_json::Error),
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: Vec<ContentPart>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ContentPart {
    Text { r#type: String, text: String },
    Image { r#type: String, image_url: ImageUrl },
}

#[derive(Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Deserialize, Debug)]
struct ChatResponse {
    choices: Vec<Choice>,
    error: Option<ErrorResponse>,
}

#[derive(Deserialize, Debug)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize, Debug)]
struct ResponseMessage {
    content: String,
}

#[derive(Deserialize, Debug)]
struct ErrorResponse {
    message: String,
}

/// Novita AI client using OpenAI-compatible API
pub struct NovitaClient {
    client: Client,
    api_key: String,
}

impl NovitaClient {
    pub fn new(api_key: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client");
        
        Self { client, api_key }
    }
    
    /// Analyze an image with the given prompt using Novita's API
    pub async fn analyze(&self, image_url: &str, prompt: &str) -> Result<String, NovitaError> {
        tracing::debug!("Sending request to Novita API (fallback)");
        
        let request = ChatRequest {
            model: "qwen/qwen3-vl-8b-instruct".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: vec![
                    ContentPart::Image {
                        r#type: "image_url".to_string(),
                        image_url: ImageUrl {
                            url: image_url.to_string(),
                        },
                    },
                    ContentPart::Text {
                        r#type: "text".to_string(),
                        text: prompt.to_string(),
                    },
                ],
            }],
            max_tokens: 2048,
            temperature: 0.7,
        };
        
        let response = self.client
            .post(NOVITA_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;
        
        let status = response.status();
        
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(NovitaError::RateLimited);
        }
        
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(NovitaError::ApiError(format!(
                "Status {}: {}", status, body
            )));
        }
        
        let result: ChatResponse = response.json().await?;
        
        if let Some(error) = result.error {
            return Err(NovitaError::ApiError(error.message));
        }
        
        result.choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| NovitaError::ApiError("No response content".to_string()))
    }
}

// Created and developed by Jai Singh
