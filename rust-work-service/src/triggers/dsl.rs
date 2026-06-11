// Created and developed by Jai Singh
//! Phase 9 — whitelist-only filter DSL parser + evaluator.
//!
//! The parser accepts a JSON document and walks it into a typed
//! [`Filter`] tree. Anything that's not in the whitelist (function
//! calls, operators with the wrong shape, unknown keys, etc.) returns
//! a [`FilterError`] with a JSON pointer that the FE form's "match
//! preview" can render verbatim.
//!
//! The evaluator (`Filter::eval`) walks the tree against a JSON
//! row and returns `bool`. It never mutates the row, never escapes
//! into the wider service, and never does I/O — it's a pure function
//! over (`Filter`, `serde_json::Value`).
//!
//! Grammar (also documented in
//! [`memorybank/OmniFrame/Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`]):
//!
//! ```text
//! filter         := boolean_op | comparison_op | null_op | empty_object
//! boolean_op     := { "all": [filter, ...] }
//!                 | { "any": [filter, ...] }
//!                 | { "not": filter }
//! comparison_op  := { "eq":  { "field": <path>, "value":  <literal> } }
//!                 | { "neq": { "field": <path>, "value":  <literal> } }
//!                 | { "in":  { "field": <path>, "values": [<literal>, ...] } }
//!                 | { "gt":  { "field": <path>, "value":  <number> } }
//!                 | { "gte": { "field": <path>, "value":  <number> } }
//!                 | { "lt":  { "field": <path>, "value":  <number> } }
//!                 | { "lte": { "field": <path>, "value":  <number> } }
//! null_op        := { "is_null":     { "field": <path> } }
//!                 | { "is_not_null": { "field": <path> } }
//! empty_object   := {}    # always-match shorthand
//!
//! <path>         := dot-separated string referencing into row_to_jsonb(NEW)
//! <literal>      := string | number | boolean | null  (NO objects/arrays)
//! ```

use serde_json::Value;
use std::fmt;

/// Error type for DSL parse failures. Carries a JSON pointer (RFC 6901
/// notation, e.g. `/all/0/eq/value`) so the FE form's "match preview"
/// panel can highlight the exact offending node verbatim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterError {
    pub pointer: String,
    pub message: String,
}

impl FilterError {
    fn new(pointer: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            pointer: pointer.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for FilterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (at {})", self.message, self.pointer)
    }
}

impl std::error::Error for FilterError {}

/// Parsed DSL filter tree. `parse_filter` is the only constructor.
#[derive(Debug, Clone, PartialEq)]
pub enum Filter {
    /// Logical AND. All children must be true. Empty list → `true`.
    All(Vec<Filter>),
    /// Logical OR. Any child true. Empty list → `false`.
    Any(Vec<Filter>),
    /// Logical NOT. Child must be false.
    Not(Box<Filter>),
    /// Field equals a literal value. Numeric equality is bit-for-bit
    /// per `serde_json::Number::eq` — i.e. `42 == 42.0` is true,
    /// matching JSON expectations.
    Eq { field: String, value: ResolvedValue },
    /// Field not equal to a literal value.
    Neq { field: String, value: ResolvedValue },
    /// Field equals one of the listed literals.
    In {
        field: String,
        values: Vec<ResolvedValue>,
    },
    /// Numeric `field > value`. Both sides must be parseable as f64;
    /// non-numeric coerces to false.
    Gt { field: String, value: f64 },
    /// Numeric `field >= value`.
    Gte { field: String, value: f64 },
    /// Numeric `field < value`.
    Lt { field: String, value: f64 },
    /// Numeric `field <= value`.
    Lte { field: String, value: f64 },
    /// Field path resolves to a JSON null OR is absent from the row.
    IsNull { field: String },
    /// Field path resolves to a non-null JSON value (string / number /
    /// boolean / object / array).
    IsNotNull { field: String },
    /// `{}` empty filter — always true. The shorthand admins use to
    /// build "fire on every INSERT" triggers.
    Always,
}

/// Literal value the DSL is permitted to compare against. Mirrors
/// `serde_json::Value` MINUS the recursive `Object` / `Array`
/// variants — those would let an admin build trees of nested
/// comparisons inside a value, which is out of grammar.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedValue {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
}

impl ResolvedValue {
    /// True when this value structurally equals a row-resolved JSON
    /// value. Non-`String` types compare strictly; strings ignore case
    /// only when both sides are strings (we deliberately keep this
    /// case-sensitive — admin filters are explicit, and SAP / RF
    /// rows use stable codes like `to_status='Completed'` exact).
    fn matches(&self, row_value: &Value) -> bool {
        match (self, row_value) {
            (ResolvedValue::Null, Value::Null) => true,
            (ResolvedValue::Bool(b), Value::Bool(rv)) => b == rv,
            (ResolvedValue::Number(n), Value::Number(rn)) => {
                // serde_json::Number doesn't implement `Eq` for f64
                // — fall back to the f64 representation. Both sides
                // must successfully resolve as f64.
                match (n.as_f64(), rn.as_f64()) {
                    (Some(a), Some(b)) => a == b,
                    _ => false,
                }
            }
            (ResolvedValue::String(s), Value::String(rs)) => s == rs,
            _ => false,
        }
    }

    fn from_json(v: &Value, pointer: &str) -> Result<Self, FilterError> {
        match v {
            Value::Null => Ok(ResolvedValue::Null),
            Value::Bool(b) => Ok(ResolvedValue::Bool(*b)),
            Value::Number(n) => Ok(ResolvedValue::Number(n.clone())),
            Value::String(s) => Ok(ResolvedValue::String(s.clone())),
            Value::Object(_) | Value::Array(_) => Err(FilterError::new(
                pointer,
                "literal value must be a string, number, boolean, or null \
                 (objects and arrays are not permitted as comparison \
                 operands)",
            )),
        }
    }
}

/// Resolve a dot-separated path into a JSON row. Returns `None` for
/// missing keys (the caller decides whether absence is `null`,
/// `false`, etc).
///
/// `payload.material` → `row["payload"]["material"]`. Array indexing
/// is INTENTIONALLY NOT supported in v1 — the row payloads we care
/// about (`rf_putaway_operations`, `sap_agent_jobs`, `work_tasks`)
/// don't use arrays for the fields admins want to filter on.
fn resolve_path<'a>(row: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = row;
    for part in path.split('.') {
        if part.is_empty() {
            return None;
        }
        current = current.as_object()?.get(part)?;
    }
    Some(current)
}

impl Filter {
    /// Evaluate this filter against a JSON row. Pure function — no
    /// I/O, no allocation beyond intermediate JSON ref walks.
    pub fn eval(&self, row: &Value) -> bool {
        match self {
            Filter::Always => true,
            Filter::All(children) => children.iter().all(|c| c.eval(row)),
            Filter::Any(children) => children.iter().any(|c| c.eval(row)),
            Filter::Not(child) => !child.eval(row),
            Filter::Eq { field, value } => match resolve_path(row, field) {
                Some(rv) => value.matches(rv),
                None => matches!(value, ResolvedValue::Null),
            },
            Filter::Neq { field, value } => match resolve_path(row, field) {
                Some(rv) => !value.matches(rv),
                None => !matches!(value, ResolvedValue::Null),
            },
            Filter::In { field, values } => match resolve_path(row, field) {
                Some(rv) => values.iter().any(|v| v.matches(rv)),
                None => values.iter().any(|v| matches!(v, ResolvedValue::Null)),
            },
            Filter::Gt { field, value } => {
                resolve_numeric(row, field).is_some_and(|n| n > *value)
            }
            Filter::Gte { field, value } => {
                resolve_numeric(row, field).is_some_and(|n| n >= *value)
            }
            Filter::Lt { field, value } => {
                resolve_numeric(row, field).is_some_and(|n| n < *value)
            }
            Filter::Lte { field, value } => {
                resolve_numeric(row, field).is_some_and(|n| n <= *value)
            }
            Filter::IsNull { field } => match resolve_path(row, field) {
                Some(Value::Null) | None => true,
                Some(_) => false,
            },
            Filter::IsNotNull { field } => {
                matches!(resolve_path(row, field), Some(v) if !v.is_null())
            }
        }
    }
}

fn resolve_numeric(row: &Value, path: &str) -> Option<f64> {
    resolve_path(row, path).and_then(|v| v.as_f64())
}

/// Parse a JSON document into a [`Filter`]. Rejects anything not in
/// the whitelisted grammar; `pointer` accumulates the JSON path of the
/// current sub-tree so error messages point at the exact node.
pub fn parse_filter(input: &Value) -> Result<Filter, FilterError> {
    parse_node(input, "")
}

fn parse_node(input: &Value, pointer: &str) -> Result<Filter, FilterError> {
    let obj = input.as_object().ok_or_else(|| {
        FilterError::new(pointer, "filter node must be a JSON object")
    })?;

    if obj.is_empty() {
        return Ok(Filter::Always);
    }

    if obj.len() != 1 {
        let keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        return Err(FilterError::new(
            pointer,
            format!(
                "filter node must have exactly one operator key; \
                 found {} keys: {:?}",
                obj.len(),
                keys
            ),
        ));
    }

    let (op, value) = obj.iter().next().expect("non-empty by check above");
    let child_pointer = if pointer.is_empty() {
        format!("/{}", op)
    } else {
        format!("{}/{}", pointer, op)
    };

    match op.as_str() {
        "all" => parse_boolean_list(value, &child_pointer).map(Filter::All),
        "any" => parse_boolean_list(value, &child_pointer).map(Filter::Any),
        "not" => parse_node(value, &child_pointer).map(|c| Filter::Not(Box::new(c))),
        "eq" => {
            let (field, lit) = parse_field_value(value, &child_pointer)?;
            Ok(Filter::Eq { field, value: lit })
        }
        "neq" => {
            let (field, lit) = parse_field_value(value, &child_pointer)?;
            Ok(Filter::Neq { field, value: lit })
        }
        "in" => {
            let (field, values) = parse_field_values(value, &child_pointer)?;
            Ok(Filter::In { field, values })
        }
        "gt" => parse_numeric_comparison(value, &child_pointer)
            .map(|(field, value)| Filter::Gt { field, value }),
        "gte" => parse_numeric_comparison(value, &child_pointer)
            .map(|(field, value)| Filter::Gte { field, value }),
        "lt" => parse_numeric_comparison(value, &child_pointer)
            .map(|(field, value)| Filter::Lt { field, value }),
        "lte" => parse_numeric_comparison(value, &child_pointer)
            .map(|(field, value)| Filter::Lte { field, value }),
        "is_null" => parse_field_only(value, &child_pointer)
            .map(|field| Filter::IsNull { field }),
        "is_not_null" => parse_field_only(value, &child_pointer)
            .map(|field| Filter::IsNotNull { field }),
        unknown => Err(FilterError::new(
            child_pointer,
            format!(
                "unknown operator '{}' (allowed: all, any, not, eq, neq, \
                 in, gt, gte, lt, lte, is_null, is_not_null)",
                unknown
            ),
        )),
    }
}

fn parse_boolean_list(value: &Value, pointer: &str) -> Result<Vec<Filter>, FilterError> {
    let arr = value.as_array().ok_or_else(|| {
        FilterError::new(
            pointer,
            "boolean operator (all/any) expects an array of child filters",
        )
    })?;
    let mut out = Vec::with_capacity(arr.len());
    for (idx, child) in arr.iter().enumerate() {
        let child_pointer = format!("{}/{}", pointer, idx);
        out.push(parse_node(child, &child_pointer)?);
    }
    Ok(out)
}

fn parse_field_value(value: &Value, pointer: &str) -> Result<(String, ResolvedValue), FilterError> {
    let obj = require_object(value, pointer)?;
    let field = require_field(obj, pointer)?;
    let raw_value = obj.get("value").ok_or_else(|| {
        FilterError::new(
            pointer,
            "comparison node requires a 'value' key",
        )
    })?;
    let value_pointer = format!("{}/value", pointer);
    let lit = ResolvedValue::from_json(raw_value, &value_pointer)?;
    reject_extra_keys(obj, &["field", "value"], pointer)?;
    Ok((field, lit))
}

fn parse_field_values(value: &Value, pointer: &str) -> Result<(String, Vec<ResolvedValue>), FilterError> {
    let obj = require_object(value, pointer)?;
    let field = require_field(obj, pointer)?;
    let raw_values = obj.get("values").ok_or_else(|| {
        FilterError::new(
            pointer,
            "'in' node requires a 'values' array",
        )
    })?;
    let arr = raw_values.as_array().ok_or_else(|| {
        FilterError::new(
            format!("{}/values", pointer),
            "'in' node 'values' must be a JSON array of literal values",
        )
    })?;
    let mut out = Vec::with_capacity(arr.len());
    for (idx, v) in arr.iter().enumerate() {
        let val_pointer = format!("{}/values/{}", pointer, idx);
        out.push(ResolvedValue::from_json(v, &val_pointer)?);
    }
    reject_extra_keys(obj, &["field", "values"], pointer)?;
    Ok((field, out))
}

fn parse_numeric_comparison(value: &Value, pointer: &str) -> Result<(String, f64), FilterError> {
    let obj = require_object(value, pointer)?;
    let field = require_field(obj, pointer)?;
    let raw_value = obj.get("value").ok_or_else(|| {
        FilterError::new(
            pointer,
            "numeric comparison requires a 'value' key",
        )
    })?;
    let value_pointer = format!("{}/value", pointer);
    let n = raw_value.as_f64().ok_or_else(|| {
        FilterError::new(
            value_pointer,
            "numeric comparison value must be a JSON number",
        )
    })?;
    reject_extra_keys(obj, &["field", "value"], pointer)?;
    Ok((field, n))
}

fn parse_field_only(value: &Value, pointer: &str) -> Result<String, FilterError> {
    let obj = require_object(value, pointer)?;
    let field = require_field(obj, pointer)?;
    reject_extra_keys(obj, &["field"], pointer)?;
    Ok(field)
}

fn require_object<'a>(
    value: &'a Value,
    pointer: &str,
) -> Result<&'a serde_json::Map<String, Value>, FilterError> {
    value.as_object().ok_or_else(|| {
        FilterError::new(
            pointer,
            "operator body must be a JSON object",
        )
    })
}

fn require_field(
    obj: &serde_json::Map<String, Value>,
    pointer: &str,
) -> Result<String, FilterError> {
    let raw_field = obj.get("field").ok_or_else(|| {
        FilterError::new(pointer, "operator body requires a 'field' key")
    })?;
    let field = raw_field.as_str().ok_or_else(|| {
        FilterError::new(
            format!("{}/field", pointer),
            "'field' must be a JSON string (dot-separated row path)",
        )
    })?;
    if field.is_empty() {
        return Err(FilterError::new(
            format!("{}/field", pointer),
            "'field' must not be empty",
        ));
    }
    if field.starts_with('.') || field.ends_with('.') || field.contains("..") {
        return Err(FilterError::new(
            format!("{}/field", pointer),
            "'field' must be a non-empty dot-separated path \
             (no leading/trailing/empty segments)",
        ));
    }
    // Defence-in-depth — disallow any character that would let an
    // admin reach into nested SQL paths. The path resolver already
    // refuses anything but `Map` lookups, but we belt-and-brace the
    // string syntax too.
    for ch in field.chars() {
        if !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '.') {
            return Err(FilterError::new(
                format!("{}/field", pointer),
                format!(
                    "'field' may only contain ASCII alphanumeric characters, \
                     underscores, and dots (got '{}')",
                    ch
                ),
            ));
        }
    }
    Ok(field.to_string())
}

fn reject_extra_keys(
    obj: &serde_json::Map<String, Value>,
    allowed: &[&str],
    pointer: &str,
) -> Result<(), FilterError> {
    for key in obj.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(FilterError::new(
                format!("{}/{}", pointer, key),
                format!(
                    "unknown key '{}' in operator body (allowed: {:?})",
                    key, allowed
                ),
            ));
        }
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(v: Value) -> Result<Filter, FilterError> {
        parse_filter(&v)
    }

    // ── Empty / shorthand ──────────────────────────────────────────

    #[test]
    fn empty_object_means_always_match() {
        let f = parse(json!({})).expect("empty filter is valid");
        assert!(matches!(f, Filter::Always));
        assert!(f.eval(&json!({"to_status": "anything"})));
    }

    // ── Boolean operators ──────────────────────────────────────────

    #[test]
    fn all_logical_and() {
        let f = parse(json!({
            "all": [
                { "eq": { "field": "to_status", "value": "Completed" } },
                { "eq": { "field": "warehouse", "value": "WH5" } },
            ]
        }))
        .expect("valid all");
        assert!(f.eval(&json!({"to_status": "Completed", "warehouse": "WH5"})));
        assert!(!f.eval(&json!({"to_status": "Completed", "warehouse": "WH6"})));
        assert!(!f.eval(&json!({"to_status": "InProgress", "warehouse": "WH5"})));
    }

    #[test]
    fn all_empty_list_matches_all_rows() {
        let f = parse(json!({"all": []})).expect("empty all is valid");
        assert!(f.eval(&json!({"any": "row"})));
    }

    #[test]
    fn any_logical_or() {
        let f = parse(json!({
            "any": [
                { "eq": { "field": "to_status", "value": "Completed" } },
                { "eq": { "field": "to_status", "value": "Confirmed" } },
            ]
        }))
        .expect("valid any");
        assert!(f.eval(&json!({"to_status": "Completed"})));
        assert!(f.eval(&json!({"to_status": "Confirmed"})));
        assert!(!f.eval(&json!({"to_status": "InProgress"})));
    }

    #[test]
    fn any_empty_list_never_matches() {
        let f = parse(json!({"any": []})).expect("empty any is valid");
        assert!(!f.eval(&json!({"any": "row"})));
    }

    #[test]
    fn not_inverts_child() {
        let f = parse(json!({
            "not": { "eq": { "field": "is_mca_workflow", "value": true } }
        }))
        .expect("valid not");
        assert!(f.eval(&json!({"is_mca_workflow": false})));
        assert!(!f.eval(&json!({"is_mca_workflow": true})));
    }

    // ── Comparison operators ───────────────────────────────────────

    #[test]
    fn eq_string_match() {
        let f = parse(json!({"eq": {"field": "to_status", "value": "Completed"}})).unwrap();
        assert!(f.eval(&json!({"to_status": "Completed"})));
        assert!(!f.eval(&json!({"to_status": "completed"})));
        assert!(!f.eval(&json!({"to_status": "InProgress"})));
    }

    #[test]
    fn eq_dotted_path() {
        let f = parse(json!({"eq": {"field": "payload.material", "value": "MAT-001"}})).unwrap();
        assert!(f.eval(&json!({"payload": {"material": "MAT-001"}})));
        assert!(!f.eval(&json!({"payload": {"material": "MAT-002"}})));
        assert!(!f.eval(&json!({"payload": {}})));
    }

    #[test]
    fn neq_basic() {
        let f = parse(json!({"neq": {"field": "to_status", "value": "Completed"}})).unwrap();
        assert!(f.eval(&json!({"to_status": "InProgress"})));
        assert!(!f.eval(&json!({"to_status": "Completed"})));
    }

    #[test]
    fn in_membership() {
        let f = parse(json!({
            "in": { "field": "task_type", "values": ["pick", "putaway", "cycle_count"] }
        }))
        .expect("valid in");
        assert!(f.eval(&json!({"task_type": "pick"})));
        assert!(f.eval(&json!({"task_type": "cycle_count"})));
        assert!(!f.eval(&json!({"task_type": "zone_audit"})));
    }

    #[test]
    fn gt_gte_lt_lte_numeric() {
        let gt = parse(json!({"gt": {"field": "qty", "value": 10}})).unwrap();
        assert!(gt.eval(&json!({"qty": 11})));
        assert!(!gt.eval(&json!({"qty": 10})));
        assert!(!gt.eval(&json!({"qty": 9})));

        let gte = parse(json!({"gte": {"field": "qty", "value": 10}})).unwrap();
        assert!(gte.eval(&json!({"qty": 10})));
        assert!(gte.eval(&json!({"qty": 11})));
        assert!(!gte.eval(&json!({"qty": 9})));

        let lt = parse(json!({"lt": {"field": "qty", "value": 10}})).unwrap();
        assert!(lt.eval(&json!({"qty": 9})));
        assert!(!lt.eval(&json!({"qty": 10})));

        let lte = parse(json!({"lte": {"field": "qty", "value": 10}})).unwrap();
        assert!(lte.eval(&json!({"qty": 10})));
        assert!(lte.eval(&json!({"qty": 9})));
        assert!(!lte.eval(&json!({"qty": 11})));
    }

    #[test]
    fn numeric_comparison_against_non_numeric_is_false() {
        let f = parse(json!({"gt": {"field": "qty", "value": 0}})).unwrap();
        assert!(!f.eval(&json!({"qty": "ten"})));
        assert!(!f.eval(&json!({"qty": null})));
        assert!(!f.eval(&json!({})));
    }

    // ── Null operators ─────────────────────────────────────────────

    #[test]
    fn is_null_handles_explicit_null_and_missing() {
        let f = parse(json!({"is_null": {"field": "confirmed_at"}})).unwrap();
        assert!(f.eval(&json!({"confirmed_at": null})));
        assert!(f.eval(&json!({})));
        assert!(!f.eval(&json!({"confirmed_at": "2026-05-07T01:00:00Z"})));
    }

    #[test]
    fn is_not_null_inverse() {
        let f = parse(json!({"is_not_null": {"field": "confirmed_at"}})).unwrap();
        assert!(f.eval(&json!({"confirmed_at": "2026-05-07T01:00:00Z"})));
        assert!(!f.eval(&json!({"confirmed_at": null})));
        assert!(!f.eval(&json!({})));
    }

    // ── Real-world rule (recreate the deleted hardcoded trigger) ───

    #[test]
    fn real_rf_putaway_completed_rule() {
        // Mirrors what an admin would type into the new CRUD UI to
        // recreate `_HARDCODED_TRIGGERS[0]` from the deleted agent.
        let f = parse(json!({
            "all": [
                { "eq":  { "field": "to_status", "value": "Completed" } },
                { "neq": { "field": "is_mca_workflow", "value": true } },
                { "is_null": { "field": "confirmed_source" } }
            ]
        }))
        .expect("real rule must parse");

        assert!(f.eval(&json!({
            "to_status": "Completed",
            "is_mca_workflow": false,
            "confirmed_source": null
        })));
        assert!(!f.eval(&json!({
            "to_status": "Completed",
            "is_mca_workflow": true,
            "confirmed_source": null
        })));
        assert!(!f.eval(&json!({
            "to_status": "Completed",
            "is_mca_workflow": false,
            "confirmed_source": "manual"
        })));
        assert!(!f.eval(&json!({
            "to_status": "InProgress",
            "is_mca_workflow": false,
            "confirmed_source": null
        })));
    }

    // ── Negative cases — security-critical surface ────────────────

    #[test]
    fn unknown_operator_is_rejected() {
        let err = parse(json!({"shell_exec": {"cmd": "rm -rf /"}})).unwrap_err();
        assert!(err.message.contains("unknown operator"));
        assert_eq!(err.pointer, "/shell_exec");
    }

    #[test]
    fn multi_key_object_is_rejected() {
        // Ambiguous — admin can't smuggle two operators into one node.
        let err = parse(json!({
            "eq": { "field": "x", "value": 1 },
            "neq": { "field": "y", "value": 2 }
        }))
        .unwrap_err();
        assert!(err.message.contains("exactly one operator key"));
    }

    #[test]
    fn extra_keys_in_operator_body_are_rejected() {
        let err = parse(json!({
            "eq": { "field": "x", "value": 1, "evil": "side_effect" }
        }))
        .unwrap_err();
        assert!(err.message.contains("unknown key 'evil'"));
        assert_eq!(err.pointer, "/eq/evil");
    }

    #[test]
    fn object_value_is_rejected() {
        // An admin can't put a sub-object in `value` — that would
        // open the door to nested expressions.
        let err = parse(json!({"eq": {"field": "x", "value": {"nested": "expression"}}}))
            .unwrap_err();
        assert!(err.message.contains("must be a string, number, boolean, or null"));
        assert_eq!(err.pointer, "/eq/value");
    }

    #[test]
    fn array_value_is_rejected_in_eq() {
        let err = parse(json!({"eq": {"field": "x", "value": [1, 2, 3]}})).unwrap_err();
        assert!(err.message.contains("must be a string, number, boolean, or null"));
    }

    #[test]
    fn missing_field_is_rejected() {
        let err = parse(json!({"eq": {"value": 42}})).unwrap_err();
        assert!(err.message.contains("requires a 'field' key"));
    }

    #[test]
    fn empty_field_is_rejected() {
        let err = parse(json!({"eq": {"field": "", "value": 1}})).unwrap_err();
        assert!(err.message.contains("must not be empty"));
    }

    #[test]
    fn dotted_field_with_special_chars_is_rejected() {
        let err = parse(json!({"eq": {"field": "x; DROP TABLE users", "value": 1}}))
            .unwrap_err();
        assert!(err.message.contains("ASCII alphanumeric"));
    }

    #[test]
    fn field_with_array_index_is_rejected() {
        // Array indexing not supported in v1 — the rejection is
        // explicit so a future v2 grammar that adds `payload[0]`
        // syntax requires an opt-in.
        let err = parse(json!({"eq": {"field": "items[0]", "value": "x"}})).unwrap_err();
        assert!(err.message.contains("ASCII alphanumeric"));
    }

    #[test]
    fn double_dot_in_field_is_rejected() {
        let err = parse(json!({"eq": {"field": "a..b", "value": 1}})).unwrap_err();
        assert!(err.message.contains("dot-separated"));
    }

    #[test]
    fn non_object_root_is_rejected() {
        let err = parse(json!("just a string")).unwrap_err();
        assert!(err.message.contains("filter node must be a JSON object"));
    }

    #[test]
    fn non_array_in_all_is_rejected() {
        let err = parse(json!({"all": {"oops": "object"}})).unwrap_err();
        assert!(err.message.contains("expects an array"));
    }

    #[test]
    fn non_numeric_value_in_gt_is_rejected() {
        let err = parse(json!({"gt": {"field": "qty", "value": "ten"}})).unwrap_err();
        assert!(err.message.contains("must be a JSON number"));
        assert_eq!(err.pointer, "/gt/value");
    }

    #[test]
    fn missing_values_in_in_is_rejected() {
        let err = parse(json!({"in": {"field": "x"}})).unwrap_err();
        assert!(err.message.contains("'values' array"));
    }

    #[test]
    fn nested_filter_pointer_is_correct() {
        // Critical for the FE form: when an admin's `all[2].eq.value`
        // is malformed, the error must point to the exact node so
        // the form can highlight it.
        let err = parse(json!({
            "all": [
                { "eq": { "field": "a", "value": 1 } },
                { "eq": { "field": "b", "value": 2 } },
                { "eq": { "field": "c", "value": { "nested": "fail" } } }
            ]
        }))
        .unwrap_err();
        assert_eq!(err.pointer, "/all/2/eq/value");
    }
}

// Created and developed by Jai Singh
