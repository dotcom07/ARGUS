use crate::hashing::hex_encode;
use crate::{create_capture_proof, ManifestInput};

// kr: create_capture_proof_json_for_jni는 Kotlin JNI 경계에서 proof 요약을 문자열로 받기 위한 얇은 helper입니다.
// en: create_capture_proof_json_for_jni is a thin helper for Kotlin JNI boundaries that need a proof summary string.
pub fn create_capture_proof_json_for_jni(input: ManifestInput) -> Result<String, String> {
    let proof = create_capture_proof(input).map_err(|error| error.to_string())?;

    let mut json = String::new();
    json.push('{');
    json.push_str("\"proof_id\":\"");
    json.push_str(&hex_encode(&proof.proof_id));
    json.push_str("\",\"manifest_hash\":\"");
    json.push_str(&hex_encode(&proof.manifest_hash));
    json.push_str("\",\"image_hash\":\"");
    json.push_str(&hex_encode(&proof.manifest.image_sha256));
    json.push_str("\"}");
    Ok(json)
}
