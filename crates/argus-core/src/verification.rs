use crate::derive_proof_id;
use crate::hashing::{hash_bytes, hash_image, hex_decode_32, hex_encode};
use crate::manifest::{
    is_jpeg_image, ARGUS_MANIFEST_SCHEMA_VERSION, ARGUS_USE_CASE_MARKETPLACE_LISTING,
    MAX_CANONICAL_MANIFEST_JSON_BYTES, MAX_NATIVE_CAPTURE_IMAGE_BYTES,
};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerificationResult {
    pub manifest_hash_matches: bool,
    pub calculated_manifest_hash: String,
    pub expected_manifest_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureProofVerificationResult {
    pub manifest_hash_matches: bool,
    pub proof_id_matches: bool,
    pub image_hash_matches: bool,
    pub schema_version_matches: bool,
    pub proof_level_supported: bool,
    pub required_commitments_present: bool,
    pub calculated_manifest_hash: String,
    pub calculated_image_hash: String,
    pub calculated_proof_id: Option<String>,
    pub expected_manifest_hash: String,
    pub expected_proof_id: String,
}

impl CaptureProofVerificationResult {
    pub fn proof_material_matches(&self) -> bool {
        self.manifest_hash_matches
            && self.proof_id_matches
            && self.image_hash_matches
            && self.schema_version_matches
            && self.proof_level_supported
            && self.required_commitments_present
    }
}

// kr: verify_manifest_hash는 verifier가 받은 manifest JSON이 등록된 hash와 같은지 확인하고,
// canonical Argus app_capture manifest가 아니면 실패로 처리합니다.
// en: verify_manifest_hash checks the registered hash and fails closed unless the JSON is a
// canonical Argus app_capture manifest.
pub fn verify_manifest_hash(
    canonical_manifest_json: &str,
    expected_manifest_hash: &str,
) -> VerificationResult {
    if canonical_manifest_json.as_bytes().len() > MAX_CANONICAL_MANIFEST_JSON_BYTES {
        return VerificationResult {
            manifest_hash_matches: false,
            calculated_manifest_hash: String::new(),
            expected_manifest_hash: expected_manifest_hash.to_string(),
        };
    }

    let calculated_hash = hash_bytes(canonical_manifest_json.as_bytes());
    let calculated_hex = hex_encode(&calculated_hash);
    let manifest_supported = parse_manifest(canonical_manifest_json)
        .as_ref()
        .is_some_and(manifest_supports_registry_policy);

    VerificationResult {
        manifest_hash_matches: calculated_hex == expected_manifest_hash && manifest_supported,
        calculated_manifest_hash: calculated_hex,
        expected_manifest_hash: expected_manifest_hash.to_string(),
    }
}

// kr: verify_capture_proof는 registry 신뢰 검사가 아니라 photo/manifest/proof commitment 결합만 확인합니다.
// en: verify_capture_proof only checks photo/manifest/proof commitment binding, not registry trust.
pub fn verify_capture_proof(
    photo_bytes: &[u8],
    canonical_manifest_json: &str,
    expected_manifest_hash: &str,
    expected_proof_id: &str,
) -> CaptureProofVerificationResult {
    let manifest_result = verify_manifest_hash(canonical_manifest_json, expected_manifest_hash);
    let manifest = parse_manifest(canonical_manifest_json);
    let photo_bytes_within_native_limit = photo_bytes.len() <= MAX_NATIVE_CAPTURE_IMAGE_BYTES;
    let photo_bytes_satisfy_native_policy =
        photo_bytes_within_native_limit && is_jpeg_image(photo_bytes);
    let calculated_image_hash = if photo_bytes_within_native_limit {
        hex_encode(&hash_image(photo_bytes))
    } else {
        String::new()
    };
    let manifest_image_hash = manifest
        .as_ref()
        .and_then(|value| extract_string_field(value, "image_sha256"));
    let calculated_proof_id = manifest
        .as_ref()
        .and_then(|value| calculate_proof_id(value, &manifest_result));
    let proof_id_matches = calculated_proof_id
        .as_ref()
        .is_some_and(|proof_id| proof_id == expected_proof_id);
    let image_hash_matches = manifest_image_hash.as_ref().is_some_and(|image_hash| {
        photo_bytes_satisfy_native_policy && image_hash == &calculated_image_hash
    });
    let schema_version_matches = manifest
        .as_ref()
        .and_then(|value| extract_string_field(value, "schema_version"))
        .is_some_and(|schema_version| schema_version == ARGUS_MANIFEST_SCHEMA_VERSION);
    let proof_level = manifest
        .as_ref()
        .and_then(|value| extract_string_field(value, "proof_level"));
    let proof_level_supported = proof_level
        .as_ref()
        .is_some_and(|level| is_supported_proof_level(level));
    // kr: unsupported proof_level은 commitment가 있어도 부분 성공 신호를 주지 않습니다. Level 3/4 bytes는 app_capture 안에서만 bind되고 root 검증은 외부 policy입니다.
    // en: Unsupported proof levels do not get a partial-success commitment signal; Level 3/4 bytes are bound only inside app_capture and root validation is external policy.
    let required_commitments_present = proof_level.as_ref().is_some_and(|level| {
        proof_level_supported
            && manifest
                .as_ref()
                .is_some_and(|value| required_commitments_present(value, level))
    });

    CaptureProofVerificationResult {
        manifest_hash_matches: manifest_result.manifest_hash_matches,
        proof_id_matches,
        image_hash_matches,
        schema_version_matches,
        proof_level_supported,
        required_commitments_present,
        calculated_manifest_hash: manifest_result.calculated_manifest_hash,
        calculated_image_hash,
        calculated_proof_id,
        expected_manifest_hash: expected_manifest_hash.to_string(),
        expected_proof_id: expected_proof_id.to_string(),
    }
}

fn calculate_proof_id(manifest: &Value, manifest_result: &VerificationResult) -> Option<String> {
    let manifest_hash = hex_decode_32(&manifest_result.calculated_manifest_hash)?;
    let image_hash = hex_decode_32(&extract_string_field(manifest, "image_sha256")?)?;
    let nonce = hex_decode_32(&extract_string_field(manifest, "nonce")?)?;

    Some(hex_encode(&derive_proof_id(
        &manifest_hash,
        &image_hash,
        &nonce,
    )))
}

fn is_supported_proof_level(value: &str) -> bool {
    value == "app_capture"
}

fn manifest_supports_registry_policy(manifest: &Value) -> bool {
    extract_string_field(manifest, "schema_version")
        .is_some_and(|schema_version| schema_version == ARGUS_MANIFEST_SCHEMA_VERSION)
        && extract_string_field(manifest, "proof_level")
            .is_some_and(|proof_level| proof_level == "app_capture")
        && required_commitments_present(manifest, "app_capture")
}

fn required_commitments_present(manifest: &Value, proof_level: &str) -> bool {
    match proof_level {
        "app_capture" => {
            has_hash_field(manifest, "camera_evidence_commitment")
                && has_hash_field(manifest, "device_integrity_commitment")
                && has_hash_field(manifest, "app_identity_hash")
        }
        _ => false,
    }
}

fn has_hash_field(manifest: &Value, key: &str) -> bool {
    extract_string_field(manifest, key)
        .and_then(|value| hex_decode_32(&value))
        .is_some_and(|hash| hash != [0u8; 32])
}

fn parse_manifest(json: &str) -> Option<Value> {
    if json.as_bytes().len() > MAX_CANONICAL_MANIFEST_JSON_BYTES {
        return None;
    }

    let manifest: Value = serde_json::from_str(json).ok()?;
    validate_canonical_manifest_shape(&manifest, json)?;
    Some(manifest)
}

fn extract_string_field(manifest: &Value, key: &str) -> Option<String> {
    manifest.get(key)?.as_str().map(ToString::to_string)
}

fn validate_canonical_manifest_shape(manifest: &Value, json: &str) -> Option<()> {
    let object = manifest.as_object()?;
    if object.len() != 12 {
        return None;
    }

    let captured_at_ms = manifest.get("captured_at_ms")?.as_i64()?;
    if captured_at_ms <= 0 {
        return None;
    }

    let partner_id_hash = required_hash_field(manifest, "partner_id_hash")?;
    let use_case = required_nonblank_string_field(manifest, "use_case")?;
    if use_case != ARGUS_USE_CASE_MARKETPLACE_LISTING {
        return None;
    }

    let capture_session_id =
        required_trimmed_nonblank_string_field(manifest, "capture_session_id")?;
    let image_sha256 = required_hash_field(manifest, "image_sha256")?;
    let metadata_commitment = optional_hash_field(manifest, "metadata_commitment")?;
    let camera_evidence_commitment = optional_hash_field(manifest, "camera_evidence_commitment")?;
    let device_integrity_commitment = optional_hash_field(manifest, "device_integrity_commitment")?;
    let app_identity_hash = optional_hash_field(manifest, "app_identity_hash")?;
    let nonce = required_hash_field(manifest, "nonce")?;

    // kr: serde_json은 중복 key를 하나의 object처럼 보여줄 수 있으므로 원문 JSON도 다시 만든 canonical JSON과 같아야 합니다.
    // en: serde_json can present duplicate keys as one object, so the original JSON must also match the rebuilt canonical JSON.
    let canonical = canonical_manifest_json_from_parts(
        required_nonblank_string_field(manifest, "schema_version")?,
        partner_id_hash,
        use_case,
        capture_session_id,
        captured_at_ms,
        image_sha256,
        metadata_commitment,
        camera_evidence_commitment,
        device_integrity_commitment,
        app_identity_hash,
        nonce,
        required_nonblank_string_field(manifest, "proof_level")?,
    );

    (canonical == json).then_some(())
}

fn required_nonblank_string_field<'a>(manifest: &'a Value, key: &str) -> Option<&'a str> {
    let value = manifest.get(key)?.as_str()?;
    (!value.trim().is_empty()).then_some(value)
}

fn required_trimmed_nonblank_string_field<'a>(manifest: &'a Value, key: &str) -> Option<&'a str> {
    let value = required_nonblank_string_field(manifest, key)?;
    (value == value.trim()).then_some(value)
}

fn required_hash_field(manifest: &Value, key: &str) -> Option<String> {
    let value = manifest.get(key)?.as_str()?;
    let hash = hex_decode_32(value)?;

    // kr: required hash field에서 all-zero hash는 "값이 있음"으로 취급하지 않고 canonical 검증을 실패시킵니다.
    // en: For required hash fields, an all-zero hash is not treated as present and fails canonical validation.
    (hash != [0u8; 32]).then(|| hex_encode(&hash))
}

fn optional_hash_field(manifest: &Value, key: &str) -> Option<Option<String>> {
    let value = manifest.get(key)?;
    if value.is_null() {
        return Some(None);
    }

    // kr: null은 commitment 생략이지만, all-zero hash는 실제 commitment로 보지 않고 fail-closed 합니다.
    // en: null means the commitment is omitted; an all-zero hash is not accepted as a real commitment and fails closed.
    let text = value.as_str()?;
    let hash = hex_decode_32(text)?;

    (hash != [0u8; 32]).then(|| Some(hex_encode(&hash)))
}

#[allow(clippy::too_many_arguments)]
fn canonical_manifest_json_from_parts(
    schema_version: &str,
    partner_id_hash: String,
    use_case: &str,
    capture_session_id: &str,
    captured_at_ms: i64,
    image_sha256: String,
    metadata_commitment: Option<String>,
    camera_evidence_commitment: Option<String>,
    device_integrity_commitment: Option<String>,
    app_identity_hash: Option<String>,
    nonce: String,
    proof_level: &str,
) -> String {
    let mut json = String::new();
    json.push('{');
    push_string_field(&mut json, "schema_version", schema_version, false);
    push_string_field(&mut json, "partner_id_hash", &partner_id_hash, true);
    push_string_field(&mut json, "use_case", use_case, true);
    push_string_field(&mut json, "capture_session_id", capture_session_id, true);
    push_number_field(&mut json, "captured_at_ms", captured_at_ms);
    push_string_field(&mut json, "image_sha256", &image_sha256, true);
    push_optional_string_field(&mut json, "metadata_commitment", metadata_commitment);
    push_optional_string_field(
        &mut json,
        "camera_evidence_commitment",
        camera_evidence_commitment,
    );
    push_optional_string_field(
        &mut json,
        "device_integrity_commitment",
        device_integrity_commitment,
    );
    push_optional_string_field(&mut json, "app_identity_hash", app_identity_hash);
    push_string_field(&mut json, "nonce", &nonce, true);
    push_string_field(&mut json, "proof_level", proof_level, true);
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

fn push_optional_string_field(json: &mut String, key: &str, value: Option<String>) {
    json.push(',');
    json.push('"');
    json.push_str(key);
    json.push_str("\":");

    match value {
        Some(hash) => {
            json.push('"');
            json.push_str(&hash);
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
