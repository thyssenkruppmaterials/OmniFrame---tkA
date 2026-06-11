// Created and developed by Jai Singh
//! Pure-function port of `omni_agent/reversal_engine.py:compute_inverse`.
//!
//! No SAP, no helper round-trip. The Rust implementation is byte-
//! compatible with the Python `/sap/reversal/compute-inverse` response
//! shape so the FE preview pane keeps working unchanged.

use std::collections::HashMap;

use agent_types::{InverseRequest, InverseResponse};
use serde_json::Value;

/// Returns the inverse payload, or `None` if the action is irreversible
/// or unsupported. The Rust signature mirrors the Python one
/// (`compute_inverse(action, payload, prev_state) -> Option<dict>`).
pub fn compute_inverse(
    action: &str,
    payload: &HashMap<String, Value>,
    prev_state: Option<&HashMap<String, Value>>,
) -> Option<HashMap<String, Value>> {
    if action.is_empty() {
        return None;
    }

    match action {
        "material_master_bin" => {
            let prev = prev_state?;
            // Need a captured prev `storage_bin` (empty string is OK
            // — it means "the bin was originally empty / cleared").
            if !prev.contains_key("storage_bin") {
                return None;
            }
            let mut out = payload.clone();
            out.insert(
                "storage_bin".to_string(),
                prev.get("storage_bin")
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
            );
            Some(out)
        }

        "material_master_storage_types" => {
            let prev = prev_state?;
            let mut out = payload.clone();
            out.insert(
                "removal_storage_type".to_string(),
                prev.get("removal_storage_type")
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
            );
            out.insert(
                "placement_storage_type".to_string(),
                prev.get("placement_storage_type")
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
            );
            Some(out)
        }

        // Pure swap — no prev_state needed.
        "transfer_inventory" => {
            let mut out = payload.clone();
            let src_t = payload
                .get("dest_storage_type")
                .cloned()
                .unwrap_or(Value::String(String::new()));
            let src_b = payload
                .get("dest_storage_bin")
                .cloned()
                .unwrap_or(Value::String(String::new()));
            let dst_t = payload
                .get("source_storage_type")
                .cloned()
                .unwrap_or(Value::String(String::new()));
            let dst_b = payload
                .get("source_storage_bin")
                .cloned()
                .unwrap_or(Value::String(String::new()));
            out.insert("source_storage_type".to_string(), src_t);
            out.insert("source_storage_bin".to_string(), src_b);
            out.insert("dest_storage_type".to_string(), dst_t);
            out.insert("dest_storage_bin".to_string(), dst_b);
            Some(out)
        }

        "set_bin_blocks" => {
            let prev = prev_state?;
            let mut out = payload.clone();
            out.insert(
                "putaway_block".to_string(),
                Value::Bool(coerce_bool(prev.get("putaway_block"))),
            );
            out.insert(
                "stock_removal_block".to_string(),
                Value::Bool(coerce_bool(prev.get("stock_removal_block"))),
            );
            Some(out)
        }

        // LT12 confirms are atomic in SAP.
        "confirm_transfer_order" => None,

        // Anything else: unsupported by the engine.
        _ => None,
    }
}

pub fn is_action_reversible_in_principle(action: &str) -> bool {
    matches!(
        action,
        "material_master_bin"
            | "material_master_storage_types"
            | "transfer_inventory"
            | "set_bin_blocks"
    )
}

/// Build the `InverseResponse` shape the FE expects.
pub fn build_response(req: &InverseRequest) -> InverseResponse {
    let prev = if req.prev_state.is_empty() {
        None
    } else {
        Some(&req.prev_state)
    };

    if let Some(inverse) = compute_inverse(&req.action, &req.payload, prev) {
        let endpoint = endpoint_for_action(&req.action).map(str::to_string);
        return InverseResponse {
            ok: true,
            reversible: true,
            inverse_payload: Some(inverse),
            endpoint,
            reason: None,
            message: None,
        };
    }

    if req.action == "confirm_transfer_order" {
        return InverseResponse {
            ok: false,
            reversible: false,
            inverse_payload: None,
            endpoint: None,
            reason: Some("irreversible_action".to_string()),
            message: Some(
                "LT12 confirmations are atomic in SAP and cannot be auto-reversed. Open a manual cancellation TO."
                    .to_string(),
            ),
        };
    }

    if !is_action_reversible_in_principle(&req.action) {
        return InverseResponse {
            ok: false,
            reversible: false,
            inverse_payload: None,
            endpoint: None,
            reason: Some("unsupported_action".to_string()),
            message: Some(format!(
                "The reversal engine does not yet know how to invert action '{}'.",
                req.action
            )),
        };
    }

    InverseResponse {
        ok: false,
        reversible: false,
        inverse_payload: None,
        endpoint: None,
        reason: Some("missing_prev_state".to_string()),
        message: Some(
            "No pre-mutation snapshot was captured for this row. Run the original mutation through the dry-run preview first so prev_state is populated."
                .to_string(),
        ),
    }
}

fn endpoint_for_action(action: &str) -> Option<&'static str> {
    Some(match action {
        "material_master_bin" => "/sap/material-master-bin",
        "material_master_storage_types" => "/sap/material-master-storage-types",
        "transfer_inventory" => "/sap/transfer-inventory",
        "set_bin_blocks" => "/sap/bin-blocks",
        _ => return None,
    })
}

fn coerce_bool(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => matches!(s.to_ascii_lowercase().as_str(), "true" | "1" | "yes"),
        Some(Value::Number(n)) => n.as_i64().map(|i| i != 0).unwrap_or(false),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(items: &[(&str, Value)]) -> HashMap<String, Value> {
        items
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn material_master_bin_inverts() {
        let payload = map(&[("storage_bin", json!("NEW"))]);
        let prev = map(&[("storage_bin", json!("OLD"))]);
        let inv = compute_inverse("material_master_bin", &payload, Some(&prev)).unwrap();
        assert_eq!(inv.get("storage_bin"), Some(&json!("OLD")));
    }

    #[test]
    fn material_master_bin_clears_to_empty() {
        let payload = map(&[("storage_bin", json!("X"))]);
        let prev = map(&[("storage_bin", json!(""))]);
        let inv = compute_inverse("material_master_bin", &payload, Some(&prev)).unwrap();
        assert_eq!(inv.get("storage_bin"), Some(&json!("")));
    }

    #[test]
    fn transfer_inventory_swap_no_prev_state_needed() {
        let payload = map(&[
            ("source_storage_type", json!("001")),
            ("source_storage_bin", json!("A")),
            ("dest_storage_type", json!("002")),
            ("dest_storage_bin", json!("B")),
        ]);
        let inv = compute_inverse("transfer_inventory", &payload, None).unwrap();
        assert_eq!(inv.get("source_storage_type"), Some(&json!("002")));
        assert_eq!(inv.get("source_storage_bin"), Some(&json!("B")));
        assert_eq!(inv.get("dest_storage_type"), Some(&json!("001")));
        assert_eq!(inv.get("dest_storage_bin"), Some(&json!("A")));
    }

    #[test]
    fn confirm_to_is_irreversible() {
        let payload = map(&[("to_number", json!("8801"))]);
        assert!(compute_inverse("confirm_transfer_order", &payload, None).is_none());
    }

    #[test]
    fn build_response_irreversible() {
        let req = InverseRequest {
            action: "confirm_transfer_order".to_string(),
            payload: HashMap::new(),
            prev_state: HashMap::new(),
        };
        let resp = build_response(&req);
        assert!(!resp.ok);
        assert!(!resp.reversible);
        assert_eq!(resp.reason.as_deref(), Some("irreversible_action"));
    }

    #[test]
    fn build_response_unsupported() {
        let req = InverseRequest {
            action: "make_coffee".to_string(),
            payload: HashMap::new(),
            prev_state: HashMap::new(),
        };
        let resp = build_response(&req);
        assert_eq!(resp.reason.as_deref(), Some("unsupported_action"));
    }

    #[test]
    fn build_response_missing_prev_state() {
        let req = InverseRequest {
            action: "set_bin_blocks".to_string(),
            payload: HashMap::new(),
            prev_state: HashMap::new(),
        };
        let resp = build_response(&req);
        assert_eq!(resp.reason.as_deref(), Some("missing_prev_state"));
    }

    #[test]
    fn build_response_happy_path() {
        let req = InverseRequest {
            action: "material_master_bin".to_string(),
            payload: map(&[("storage_bin", json!("NEW"))]),
            prev_state: map(&[("storage_bin", json!("OLD"))]),
        };
        let resp = build_response(&req);
        assert!(resp.ok);
        assert!(resp.reversible);
        assert_eq!(resp.endpoint.as_deref(), Some("/sap/material-master-bin"));
        let inv = resp.inverse_payload.unwrap();
        assert_eq!(inv.get("storage_bin"), Some(&json!("OLD")));
    }
}

// Created and developed by Jai Singh
