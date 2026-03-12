//! Supabase Storage Module
//! 
//! Handles image upload to Supabase Storage (S3-compatible).

use reqwest::Client;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    
    #[error("Upload failed: {0}")]
    UploadFailed(String),
}

/// Supabase Storage client
pub struct SupabaseStorage {
    client: Client,
    base_url: String,
    service_key: String,
    bucket: String,
}

impl SupabaseStorage {
    pub fn new(supabase_url: String, service_key: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("Failed to create HTTP client");
        
        // Storage URL is supabase_url + /storage/v1
        let base_url = format!("{}/storage/v1", supabase_url);
        
        Self {
            client,
            base_url,
            service_key,
            bucket: "drone-images".to_string(),
        }
    }
    
    /// Upload an image and return the public URL
    pub async fn upload_image(
        &self,
        data: Vec<u8>,
        path: &str,
        content_type: &str,
    ) -> Result<String, StorageError> {
        let url = format!(
            "{}/object/{}/{}",
            self.base_url, self.bucket, path
        );
        
        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .header("Content-Type", content_type)
            .body(data)
            .send()
            .await?;
        
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(StorageError::UploadFailed(body));
        }
        
        // Return public URL
        let public_url = format!(
            "{}/object/public/{}/{}",
            self.base_url, self.bucket, path
        );
        
        Ok(public_url)
    }
    
    /// Create a signed URL for temporary access
    pub async fn create_signed_url(
        &self,
        path: &str,
        expires_in: u64,
    ) -> Result<String, StorageError> {
        let url = format!(
            "{}/object/sign/{}/{}",
            self.base_url, self.bucket, path
        );
        
        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .json(&serde_json::json!({
                "expiresIn": expires_in
            }))
            .send()
            .await?;
        
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(StorageError::UploadFailed(body));
        }
        
        #[derive(serde::Deserialize)]
        struct SignedUrlResponse {
            #[serde(rename = "signedURL")]
            signed_url: String,
        }
        
        let result: SignedUrlResponse = response.json().await?;
        Ok(result.signed_url)
    }
    
    /// Delete an image
    pub async fn delete_image(&self, path: &str) -> Result<(), StorageError> {
        let url = format!(
            "{}/object/{}/{}",
            self.base_url, self.bucket, path
        );
        
        let response = self.client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .send()
            .await?;
        
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(StorageError::UploadFailed(body));
        }
        
        Ok(())
    }
}
