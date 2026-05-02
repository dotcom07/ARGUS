use crate::canonical::canonical_manifest_json;
use crate::derive_proof_id;
use crate::hashing::{hash_bytes, hash_image, hex_encode};
use crate::manifest::{
    is_jpeg_image, CaptureManifest, ProofLevel, ARGUS_MANIFEST_SCHEMA_VERSION,
    ARGUS_USE_CASE_MARKETPLACE_LISTING, MAX_CANONICAL_MANIFEST_JSON_BYTES,
    MAX_NATIVE_CAPTURE_IMAGE_BYTES,
};
use crate::ArgusError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistryPayload {
    pub proof_id: String,
    pub manifest_hash: String,
    pub image_hash: String,
    pub partner_id_hash: String,
    pub use_case: String,
    pub capture_timestamp: i64,
    pub proof_level: String,
    pub schema_version: u16,
}

// kr: build_registry_payload는 Solana registry에 보낼 최소 commitment 필드만 준비합니다.
// en: build_registry_payload prepares only the minimum commitment fields sent to the Solana registry.
// kr: production program, relayer fee payer, sponsored gas 같은 trust root 검사는 Rust core 밖의 backend/verifier policy입니다.
// en: Production program, relayer fee payer, and sponsored-gas trust roots are backend/verifier policy outside Rust core.
pub fn build_registry_payload(
    manifest: &CaptureManifest,
    proof_id: [u8; 32],
    manifest_hash: [u8; 32],
    image_bytes: &[u8],
) -> Result<RegistryPayload, ArgusError> {
    validate_registry_manifest(manifest)?;

    if image_bytes.len() > MAX_NATIVE_CAPTURE_IMAGE_BYTES {
        return Err(ArgusError::InvalidInput(
            "image_bytes exceed native capture photo byte limit".to_string(),
        ));
    }

    let canonical_manifest = canonical_manifest_json(manifest);
    if canonical_manifest.as_bytes().len() > MAX_CANONICAL_MANIFEST_JSON_BYTES {
        return Err(ArgusError::InvalidInput(
            "canonical_manifest_json exceeds JSON text limit".to_string(),
        ));
    }

    let expected_manifest_hash = hash_bytes(canonical_manifest.as_bytes());
    if manifest_hash != expected_manifest_hash {
        return Err(ArgusError::InvalidInput(
            "manifest_hash does not match canonical manifest".to_string(),
        ));
    }

    // kr: Registry payload은 전달받은 proof_id를 신뢰하지 않고 manifest/image/nonce로 다시 계산합니다.
    // en: The registry payload does not trust the supplied proof_id; it recomputes it from manifest, image hash, and nonce.
    // kr: nonce를 뺀 hash-only proof id는 registry payload가 만들어지기 전에 fail-closed 됩니다.
    // en: Hash-only proof ids that omit the nonce fail closed before a registry payload is emitted.
    let expected_proof_id = derive_proof_id(
        &expected_manifest_hash,
        &manifest.image_sha256,
        &manifest.nonce,
    );
    if proof_id != expected_proof_id {
        return Err(ArgusError::InvalidInput(
            "proof_id does not match canonical manifest".to_string(),
        ));
    }

    if !is_jpeg_image(image_bytes) {
        return Err(ArgusError::InvalidInput(
            "image_bytes must pass the native-capture JPEG-like byte policy".to_string(),
        ));
    }

    if hash_image(image_bytes) != manifest.image_sha256 {
        return Err(ArgusError::InvalidInput(
            "image_sha256 does not match image_bytes".to_string(),
        ));
    }

    Ok(RegistryPayload {
        proof_id: hex_encode(&proof_id),
        manifest_hash: hex_encode(&manifest_hash),
        image_hash: hex_encode(&manifest.image_sha256),
        partner_id_hash: hex_encode(&manifest.partner_id_hash),
        use_case: manifest.use_case.clone(),
        capture_timestamp: manifest.captured_at_ms,
        proof_level: manifest.proof_level.as_str().to_string(),
        schema_version: 1,
    })
}

fn validate_registry_manifest(manifest: &CaptureManifest) -> Result<(), ArgusError> {
    if manifest.schema_version != ARGUS_MANIFEST_SCHEMA_VERSION {
        return Err(ArgusError::InvalidInput(
            "schema_version is not supported by the registry".to_string(),
        ));
    }

    // kr: Registry payload은 현재 production app_capture만 허용해 demo/device_attested가 등록 badge로 과장되지 않게 합니다.
    // en: Registry payloads currently allow only production app_capture so demo/device_attested proofs are not overstated as registered badges.
    if manifest.proof_level != ProofLevel::AppCapture {
        return Err(ArgusError::InvalidInput(
            "proof_level is not supported by the registry".to_string(),
        ));
    }

    if manifest.use_case != ARGUS_USE_CASE_MARKETPLACE_LISTING {
        return Err(ArgusError::InvalidInput(
            "use_case is not supported by the registry".to_string(),
        ));
    }

    if manifest.partner_id_hash == [0u8; 32] {
        return Err(ArgusError::InvalidInput(
            "partner_id_hash cannot be zero".to_string(),
        ));
    }

    if manifest.capture_session_id.trim().is_empty()
        || manifest.capture_session_id != manifest.capture_session_id.trim()
    {
        return Err(ArgusError::InvalidInput(
            "capture_session_id must be a trimmed non-empty string".to_string(),
        ));
    }

    if manifest.capture_session_id.as_bytes().len() > MAX_CANONICAL_MANIFEST_JSON_BYTES {
        return Err(ArgusError::InvalidInput(
            "capture_session_id exceeds canonical manifest JSON text limit".to_string(),
        ));
    }

    if manifest.captured_at_ms <= 0 {
        return Err(ArgusError::InvalidInput(
            "captured_at_ms must be positive".to_string(),
        ));
    }

    if manifest.image_sha256 == [0u8; 32] {
        return Err(ArgusError::InvalidInput(
            "image_sha256 cannot be zero".to_string(),
        ));
    }

    reject_zero_optional(manifest.metadata_commitment, "metadata_commitment")?;

    if manifest.nonce == [0u8; 32] {
        return Err(ArgusError::InvalidInput("nonce cannot be zero".to_string()));
    }

    require_nonzero(
        manifest.camera_evidence_commitment,
        "camera_evidence_commitment",
    )?;
    require_nonzero(
        manifest.device_integrity_commitment,
        "device_integrity_commitment",
    )?;
    require_nonzero(manifest.app_identity_hash, "app_identity_hash")?;

    Ok(())
}

fn reject_zero_optional(value: Option<[u8; 32]>, field: &str) -> Result<(), ArgusError> {
    if value.is_some_and(|commitment| commitment == [0u8; 32]) {
        return Err(ArgusError::InvalidInput(format!(
            "{field} cannot be zero when present"
        )));
    }

    Ok(())
}

fn require_nonzero(value: Option<[u8; 32]>, field: &str) -> Result<(), ArgusError> {
    if value.is_some_and(|commitment| commitment != [0u8; 32]) {
        return Ok(());
    }

    Err(ArgusError::InvalidInput(format!(
        "{field} is required for app_capture registry payload"
    )))
}
