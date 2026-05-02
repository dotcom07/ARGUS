use crate::hashing::hex_encode;
use crate::manifest::CaptureManifest;

// kr: canonical_manifest_json은 manifest hash 계산을 위해 항상 같은 key 순서의 JSON을 만듭니다.
// en: canonical_manifest_json creates JSON with a stable key order for manifest hash calculation.
pub fn canonical_manifest_json(manifest: &CaptureManifest) -> String {
    let mut json = String::new();
    json.push('{');
    push_string_field(&mut json, "schema_version", &manifest.schema_version, false);
    push_string_field(
        &mut json,
        "partner_id_hash",
        &hex_encode(&manifest.partner_id_hash),
        true,
    );
    push_string_field(&mut json, "use_case", &manifest.use_case, true);
    push_string_field(
        &mut json,
        "capture_session_id",
        &manifest.capture_session_id,
        true,
    );
    push_number_field(&mut json, "captured_at_ms", manifest.captured_at_ms);
    push_string_field(
        &mut json,
        "image_sha256",
        &hex_encode(&manifest.image_sha256),
        true,
    );
    push_optional_hash_field(
        &mut json,
        "metadata_commitment",
        manifest.metadata_commitment,
    );
    push_optional_hash_field(
        &mut json,
        "camera_evidence_commitment",
        manifest.camera_evidence_commitment,
    );
    push_optional_hash_field(
        &mut json,
        "device_integrity_commitment",
        manifest.device_integrity_commitment,
    );
    push_optional_hash_field(&mut json, "app_identity_hash", manifest.app_identity_hash);
    push_string_field(&mut json, "nonce", &hex_encode(&manifest.nonce), true);
    push_string_field(
        &mut json,
        "proof_level",
        manifest.proof_level.as_str(),
        true,
    );
    json.push('}');
    json
}

fn push_string_field(json: &mut String, key: &str, value: &str, comma_before: bool) {
    if comma_before {
        json.push(',');
    }

    json.push('"');
    json.push_str(key);
    json.push_str("\":\"");
    json.push_str(&escape_json(value));
    json.push('"');
}

fn push_number_field(json: &mut String, key: &str, value: i64) {
    json.push(',');
    json.push('"');
    json.push_str(key);
    json.push_str("\":");
    json.push_str(&value.to_string());
}

fn push_optional_hash_field(json: &mut String, key: &str, value: Option<[u8; 32]>) {
    json.push(',');
    json.push('"');
    json.push_str(key);
    json.push_str("\":");

    match value {
        Some(hash) => {
            json.push('"');
            json.push_str(&hex_encode(&hash));
            json.push('"');
        }
        None => json.push_str("null"),
    }
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::new();

    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\u{0008}' => escaped.push_str("\\b"),
            '\u{000c}' => escaped.push_str("\\f"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\u{0000}'..='\u{001f}' => {
                escaped.push_str("\\u");
                escaped.push_str(&format!("{:04x}", character as u32));
            }
            _ => escaped.push(character),
        }
    }

    escaped
}
