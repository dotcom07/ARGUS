pub mod canonical;
pub mod ffi;
pub mod hashing;
pub mod manifest;
pub mod solana_payload;
pub mod verification;

use std::fmt;

pub use canonical::canonical_manifest_json;
pub use hashing::{hash_bytes, hash_image, hex_decode_32, hex_encode};
pub use manifest::{build_manifest, CaptureManifest, ManifestInput, ProofLevel};
pub use solana_payload::{build_registry_payload, RegistryPayload};
pub use verification::{
    verify_capture_proof, verify_manifest_hash, CaptureProofVerificationResult, VerificationResult,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArgusError {
    InvalidInput(String),
}

impl fmt::Display for ArgusError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ArgusError::InvalidInput(message) => write!(formatter, "invalid input: {}", message),
        }
    }
}

impl std::error::Error for ArgusError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArgusCoreProof {
    pub proof_id: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub canonical_manifest_json: String,
    pub manifest: CaptureManifest,
}

// kr: create_capture_proof는 Argus proof core의 메인 함수이며 manifest와 proof id를 생성합니다.
// en: create_capture_proof is the main Argus proof core function that creates the manifest and proof id.
pub fn create_capture_proof(input: ManifestInput) -> Result<ArgusCoreProof, ArgusError> {
    let manifest = build_manifest(input)?;
    let canonical_json = canonical_manifest_json(&manifest);
    if canonical_json.as_bytes().len() > manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES {
        return Err(ArgusError::InvalidInput(
            "canonical_manifest_json exceeds JSON text limit".to_string(),
        ));
    }

    let manifest_hash = hash_bytes(canonical_json.as_bytes());
    let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

    Ok(ArgusCoreProof {
        proof_id,
        manifest_hash,
        canonical_manifest_json: canonical_json,
        manifest,
    })
}

// kr: derive_proof_id는 manifest hash, image hash, nonce를 묶어 verifier용 proof id를 만듭니다.
// en: derive_proof_id binds the manifest hash, image hash, and nonce into a verifier-facing proof id.
pub fn derive_proof_id(
    manifest_hash: &[u8; 32],
    image_hash: &[u8; 32],
    nonce: &[u8; 32],
) -> [u8; 32] {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"argus-proof-v1");
    bytes.extend_from_slice(manifest_hash);
    bytes.extend_from_slice(image_hash);
    bytes.extend_from_slice(nonce);
    hash_bytes(&bytes)
}

#[cfg(test)]
mod tests {
    use super::{
        build_registry_payload, canonical_manifest_json, create_capture_proof, derive_proof_id,
        hash_bytes, hex_decode_32, hex_encode, verify_capture_proof, verify_manifest_hash,
        ManifestInput, ProofLevel,
    };

    fn sample_image_bytes() -> Vec<u8> {
        vec![
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
            0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
            0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
        ]
    }

    fn duplicate_sos_component_id_jpeg_bytes() -> Vec<u8> {
        let mut image_bytes = sample_image_bytes();
        image_bytes[10] = 0x00;
        image_bytes[11] = 0x0e;
        image_bytes[17] = 0x02;
        image_bytes.splice(21..21, [0x02, 0x11, 0x00]);
        image_bytes[26] = 0x00;
        image_bytes[27] = 0x0a;
        image_bytes[28] = 0x02;
        image_bytes.splice(31..31, [0x01, 0x00]);
        image_bytes
    }

    fn second_sos_inside_scan_jpeg_bytes() -> Vec<u8> {
        let mut image_bytes = sample_image_bytes();
        let eoi_index = image_bytes.len() - 2;
        image_bytes.splice(eoi_index..eoi_index, [0xff, 0xda, 0x00, 0x08]);
        image_bytes
    }

    fn escaped_ff_and_restart_marker_scan_jpeg_bytes() -> Vec<u8> {
        let mut image_bytes = sample_image_bytes();
        let eoi_index = image_bytes.len() - 2;
        image_bytes.splice(eoi_index..eoi_index, [0xff, 0x00, 0xff, 0xd0]);
        image_bytes
    }

    fn jpeg_bytes_of_len(len: usize) -> Vec<u8> {
        let sample = sample_image_bytes();
        assert!(len >= sample.len());
        let mut bytes = Vec::with_capacity(len);
        bytes.extend_from_slice(&sample[..sample.len() - 2]);
        bytes.resize(len - 2, 0x00);
        bytes.extend_from_slice(&sample[sample.len() - 2..]);
        bytes
    }

    fn native_capture_limit_jpeg_bytes() -> Vec<u8> {
        jpeg_bytes_of_len(crate::manifest::MAX_NATIVE_CAPTURE_IMAGE_BYTES)
    }

    fn oversized_jpeg_bytes() -> Vec<u8> {
        jpeg_bytes_of_len(crate::manifest::MAX_NATIVE_CAPTURE_IMAGE_BYTES + 1)
    }

    fn sample_input() -> ManifestInput {
        ManifestInput {
            partner_id: "recommerce-demo".to_string(),
            use_case: "marketplace_listing".to_string(),
            capture_session_id: "capture-session-001".to_string(),
            captured_at_ms: 1_777_000_000_000,
            image_bytes: sample_image_bytes(),
            metadata_json: Some("{\"listingId\":\"demo-listing-001\"}".to_string()),
            camera_evidence_json: Some(
                "{\"cameraMetadata\":true,\"motionSnapshot\":true}".to_string(),
            ),
            device_integrity_json: Some("{\"appIdentityHash\":true}".to_string()),
            app_identity_json: Some(hex_encode(&[9u8; 32])),
            nonce: [7u8; 32],
            proof_level: ProofLevel::AppCapture,
        }
    }

    fn level_four_device_integrity_json() -> String {
        "{\"androidEvidenceLevel\":4,\"evidenceLevel\":\"level_4_hardware_attestation\",\
         \"hardwareAttestation\":{\"certificateChainPem\":[\"-----BEGIN CERTIFICATE-----\\nargus-root\\n-----END CERTIFICATE-----\"],\
         \"hardwareBacked\":true,\"supported\":true},\"keystoreSignature\":true,\
         \"level4HardwareAttestation\":true}"
            .to_string()
    }

    #[test]
    fn creates_deterministic_capture_proof() {
        let first = create_capture_proof(sample_input()).expect("first proof should build");
        let second = create_capture_proof(sample_input()).expect("second proof should build");

        assert_eq!(first.proof_id, second.proof_id);
        assert_eq!(first.manifest_hash, second.manifest_hash);
        assert_eq!(
            first.canonical_manifest_json,
            second.canonical_manifest_json
        );
        assert_eq!(first.manifest.proof_level, ProofLevel::AppCapture);
    }

    #[test]
    fn canonical_manifest_uses_javascript_short_control_escapes() {
        let mut input = sample_input();
        input.capture_session_id = "capture-\u{0008}\u{000c}-id".to_string();
        let proof = create_capture_proof(input).expect("proof should build");

        assert!(proof
            .canonical_manifest_json
            .contains("\"capture_session_id\":\"capture-\\b\\f-id\""));

        let expected_hash = hex_encode(&proof.manifest_hash);
        let result = verify_manifest_hash(&proof.canonical_manifest_json, &expected_hash);
        assert!(result.manifest_hash_matches);
    }

    #[test]
    fn verifier_rejects_non_js_short_control_escape_manifest() {
        let mut input = sample_input();
        input.capture_session_id = "capture-\u{0008}\u{000c}-id".to_string();
        let proof = create_capture_proof(input).expect("proof should build");
        let non_js_manifest_json = proof
            .canonical_manifest_json
            .replace("\\b\\f", "\\u0008\\u000c");
        let manifest_hash = hash_bytes(non_js_manifest_json.as_bytes());

        let result = verify_manifest_hash(&non_js_manifest_json, &hex_encode(&manifest_hash));

        assert!(!result.manifest_hash_matches);
    }

    #[test]
    fn evidence_commitments_hash_exact_public_input_bytes() {
        let metadata_json = " {\"listingId\":\"demo-listing-001\"} ".to_string();
        let camera_evidence_json =
            " {\"cameraMetadata\":true,\"motionSnapshot\":true} ".to_string();
        let device_integrity_json = " {\"appIdentityHash\":true} ".to_string();
        let mut input = sample_input();
        input.metadata_json = Some(metadata_json.clone());
        input.camera_evidence_json = Some(camera_evidence_json.clone());
        input.device_integrity_json = Some(device_integrity_json.clone());

        let proof = create_capture_proof(input).expect("proof should build");

        assert_eq!(
            proof.manifest.metadata_commitment,
            Some(hash_bytes(metadata_json.as_bytes()))
        );
        assert_eq!(
            proof.manifest.camera_evidence_commitment,
            Some(hash_bytes(camera_evidence_json.as_bytes()))
        );
        assert_eq!(
            proof.manifest.device_integrity_commitment,
            Some(hash_bytes(device_integrity_json.as_bytes()))
        );
        assert_ne!(
            proof.manifest.metadata_commitment,
            Some(hash_bytes(metadata_json.trim().as_bytes()))
        );
    }

    #[test]
    fn verifier_accepts_matching_manifest_hash() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let expected_hash = hex_encode(&proof.manifest_hash);
        let result = verify_manifest_hash(&proof.canonical_manifest_json, &expected_hash);

        assert!(result.manifest_hash_matches);
    }

    #[test]
    fn verifier_rejects_changed_manifest_hash() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let result = verify_manifest_hash(&proof.canonical_manifest_json, "not-the-right-hash");

        assert!(!result.manifest_hash_matches);
    }

    #[test]
    fn manifest_hash_helper_rejects_hash_only_non_argus_json() {
        let arbitrary_json = "{\"image_sha256\":\"not-an-argus-manifest\"}";
        let arbitrary_hash = hex_encode(&hash_bytes(arbitrary_json.as_bytes()));
        let result = verify_manifest_hash(arbitrary_json, &arbitrary_hash);

        assert!(!result.manifest_hash_matches);
    }

    #[test]
    fn manifest_hash_helper_rejects_duplicate_key_even_when_hash_matches() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let duplicate_nonce_json = format!(
            "\"nonce\":\"{}\",\"proof_level\":\"app_capture\"}}",
            hex_encode(&proof.manifest.nonce)
        );
        let duplicate_key_manifest_json = proof
            .canonical_manifest_json
            .replace("\"proof_level\":\"app_capture\"}", &duplicate_nonce_json);
        let manifest_hash = hex_encode(&hash_bytes(duplicate_key_manifest_json.as_bytes()));

        let result = verify_manifest_hash(&duplicate_key_manifest_json, &manifest_hash);

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_manifest_hash, manifest_hash);
    }

    #[test]
    fn manifest_hash_helper_rejects_zero_required_commitment_even_when_hash_matches() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let zero_camera_manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"camera_evidence_commitment\":\"{}\"",
                hex_encode(&proof.manifest.camera_evidence_commitment.unwrap())
            ),
            &format!("\"camera_evidence_commitment\":\"{}\"", "0".repeat(64)),
        );
        let manifest_hash = hex_encode(&hash_bytes(zero_camera_manifest_json.as_bytes()));

        let result = verify_manifest_hash(&zero_camera_manifest_json, &manifest_hash);

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_manifest_hash, manifest_hash);
    }

    #[test]
    fn manifest_hash_helper_rejects_zero_optional_commitment_even_when_hash_matches() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let zero_metadata_manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"metadata_commitment\":\"{}\"",
                hex_encode(&proof.manifest.metadata_commitment.unwrap())
            ),
            &format!("\"metadata_commitment\":\"{}\"", "0".repeat(64)),
        );
        let manifest_hash = hex_encode(&hash_bytes(zero_metadata_manifest_json.as_bytes()));

        let result = verify_manifest_hash(&zero_metadata_manifest_json, &manifest_hash);

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_manifest_hash, manifest_hash);
    }

    #[test]
    fn manifest_hash_helper_rejects_oversized_manifest_without_hashing() {
        let oversized_manifest_json =
            " ".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES + 1);
        let result = verify_manifest_hash(&oversized_manifest_json, &"1".repeat(64));

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_manifest_hash, "");
    }

    #[test]
    fn verifier_accepts_matching_proof_id_and_manifest_hash() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let result = verify_capture_proof(
            &sample_image_bytes(),
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(result.image_hash_matches);
        assert!(result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_oversized_manifest_without_proof_id_calculation() {
        let oversized_manifest_json =
            " ".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES + 1);
        let result = verify_capture_proof(
            &sample_image_bytes(),
            &oversized_manifest_json,
            &"1".repeat(64),
            &"2".repeat(64),
        );

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_manifest_hash, "");
        assert_eq!(result.calculated_proof_id, None);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_changed_proof_id() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let result = verify_capture_proof(
            &sample_image_bytes(),
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &"0".repeat(64),
        );

        assert!(result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_proof_id_that_omits_nonce_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let proof_id_without_nonce =
            hash_bytes(&[proof.manifest_hash, proof.manifest.image_sha256].concat());

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof_id_without_nonce),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.image_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_changed_image_bytes() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let result = verify_capture_proof(
            b"tampered image bytes",
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.image_hash_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_empty_photo_bytes_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let empty_image_hash = hash_bytes(b"");
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"image_sha256\":\"{}\"",
                hex_encode(&proof.manifest.image_sha256)
            ),
            &format!("\"image_sha256\":\"{}\"", hex_encode(&empty_image_hash)),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &empty_image_hash, &proof.manifest.nonce);

        let result = verify_capture_proof(
            b"",
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.image_hash_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_non_jpeg_photo_bytes_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let non_jpeg_bytes = b"not camera jpeg bytes";
        let non_jpeg_hash = hash_bytes(non_jpeg_bytes);
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"image_sha256\":\"{}\"",
                hex_encode(&proof.manifest.image_sha256)
            ),
            &format!("\"image_sha256\":\"{}\"", hex_encode(&non_jpeg_hash)),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &non_jpeg_hash, &proof.manifest.nonce);

        let result = verify_capture_proof(
            non_jpeg_bytes,
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.image_hash_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_duplicate_sos_component_id_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let image_bytes = duplicate_sos_component_id_jpeg_bytes();
        let image_hash = hash_bytes(&image_bytes);
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"image_sha256\":\"{}\"",
                hex_encode(&proof.manifest.image_sha256)
            ),
            &format!("\"image_sha256\":\"{}\"", hex_encode(&image_hash)),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &image_hash, &proof.manifest.nonce);

        let result = verify_capture_proof(
            &image_bytes,
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.image_hash_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_second_sos_inside_scan_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let image_bytes = second_sos_inside_scan_jpeg_bytes();
        let image_hash = hash_bytes(&image_bytes);
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"image_sha256\":\"{}\"",
                hex_encode(&proof.manifest.image_sha256)
            ),
            &format!("\"image_sha256\":\"{}\"", hex_encode(&image_hash)),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &image_hash, &proof.manifest.nonce);

        let result = verify_capture_proof(
            &image_bytes,
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.image_hash_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_oversized_jpeg_photo_bytes_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let oversized_jpeg_bytes = oversized_jpeg_bytes();
        let oversized_image_hash = hash_bytes(&oversized_jpeg_bytes);
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"image_sha256\":\"{}\"",
                hex_encode(&proof.manifest.image_sha256)
            ),
            &format!("\"image_sha256\":\"{}\"", hex_encode(&oversized_image_hash)),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id =
            derive_proof_id(&manifest_hash, &oversized_image_hash, &proof.manifest.nonce);

        let result = verify_capture_proof(
            &oversized_jpeg_bytes,
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert_eq!(result.calculated_image_hash, "");
        assert!(!result.image_hash_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_accepts_jpeg_photo_bytes_at_native_capture_limit() {
        let exact_limit_bytes = native_capture_limit_jpeg_bytes();
        let mut input = sample_input();
        input.image_bytes = exact_limit_bytes.clone();
        let proof = create_capture_proof(input).expect("exact-limit proof should build");

        let result = verify_capture_proof(
            &exact_limit_bytes,
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );

        assert!(result.proof_material_matches());
    }

    #[test]
    fn proof_creation_rejects_non_jpeg_image_bytes() {
        let mut input = sample_input();
        input.image_bytes = b"not camera jpeg bytes".to_vec();

        let error =
            create_capture_proof(input).expect_err("non-JPEG app_capture bytes should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_oversized_image_bytes_before_jpeg_parse() {
        let mut input = sample_input();
        input.image_bytes = vec![0xff; crate::manifest::MAX_NATIVE_CAPTURE_IMAGE_BYTES + 1];

        let error = create_capture_proof(input).expect_err("oversized image bytes should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes exceed native capture photo byte limit".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_oversized_metadata_json_before_commitment() {
        let mut input = sample_input();
        input.metadata_json = Some("a".repeat(crate::manifest::MAX_METADATA_JSON_BYTES + 1));
        input.image_bytes.clear();

        let error = create_capture_proof(input).expect_err("oversized metadata should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput("metadata_json exceeds JSON text limit".to_string())
        );
    }

    #[test]
    fn proof_creation_rejects_oversized_camera_evidence_json_before_commitment() {
        let mut input = sample_input();
        input.camera_evidence_json = Some("a".repeat(crate::manifest::MAX_EVIDENCE_JSON_BYTES + 1));
        input.image_bytes.clear();

        let error = create_capture_proof(input).expect_err("oversized camera evidence should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "camera_evidence_json exceeds JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_oversized_device_integrity_json_before_commitment() {
        let mut input = sample_input();
        input.device_integrity_json =
            Some("a".repeat(crate::manifest::MAX_EVIDENCE_JSON_BYTES + 1));
        input.image_bytes.clear();

        let error =
            create_capture_proof(input).expect_err("oversized device integrity should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "device_integrity_json exceeds JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_oversized_capture_session_id_before_manifest_generation() {
        let mut input = sample_input();
        input.capture_session_id =
            "a".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES + 1);

        let error =
            create_capture_proof(input).expect_err("oversized capture session id should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "capture_session_id exceeds canonical manifest JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_generated_manifest_over_json_text_limit() {
        let mut input = sample_input();
        input.capture_session_id =
            "a".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES - 1);

        let error = create_capture_proof(input).expect_err("oversized manifest should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "canonical_manifest_json exceeds JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_accepts_image_bytes_at_native_capture_limit() {
        let exact_limit_bytes = native_capture_limit_jpeg_bytes();
        let mut input = sample_input();
        input.image_bytes = exact_limit_bytes.clone();

        let proof = create_capture_proof(input).expect("exact-limit image bytes should build");

        assert_eq!(proof.manifest.image_sha256, hash_bytes(&exact_limit_bytes));
    }

    #[test]
    fn scan_data_policy_accepts_escaped_ff_and_restart_marker_across_boundaries() {
        let image_bytes = escaped_ff_and_restart_marker_scan_jpeg_bytes();
        let mut input = sample_input();
        input.image_bytes = image_bytes.clone();
        let proof = create_capture_proof(input).expect("scan-data marker exceptions should build");

        let verification = verify_capture_proof(
            &image_bytes,
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );
        assert!(verification.proof_material_matches());

        let payload = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &image_bytes,
        )
        .expect("scan-data marker exceptions should build a registry payload");
        assert_eq!(payload.image_hash, hex_encode(&proof.manifest.image_sha256));
    }

    #[test]
    fn proof_creation_rejects_truncated_jpeg_image_bytes() {
        let mut input = sample_input();
        input.image_bytes = vec![0xff, 0xd8, 0xff, 0xe0];

        let error =
            create_capture_proof(input).expect_err("JPEG without an end marker should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_marker_only_jpeg_image_bytes() {
        let mut input = sample_input();
        input.image_bytes = vec![0xff, 0xd8, 0xff, 0xd9];

        let error = create_capture_proof(input).expect_err("marker-only JPEG bytes should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_restart_marker_before_scan_data() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes.splice(2..2, [0xff, 0xd0]);
        input.image_bytes = image_bytes;

        let error = create_capture_proof(input).expect_err("restart marker before SOS should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_empty_start_of_frame_segment() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes[10] = 0x00;
        image_bytes[11] = 0x02;
        input.image_bytes = image_bytes;

        let error =
            create_capture_proof(input).expect_err("empty SOF segment should fail JPEG policy");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_empty_start_of_scan_segment() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes[23] = 0x00;
        image_bytes[24] = 0x02;
        input.image_bytes = image_bytes;

        let error =
            create_capture_proof(input).expect_err("empty SOS segment should fail JPEG policy");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_duplicate_start_of_frame_component_id() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes[10] = 0x00;
        image_bytes[11] = 0x0e;
        image_bytes[17] = 0x02;
        image_bytes.splice(21..21, [0x01, 0x11, 0x00]);
        input.image_bytes = image_bytes;

        let error =
            create_capture_proof(input).expect_err("duplicate SOF component ids should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_start_of_scan_component_count_that_exceeds_frame() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes[23] = 0x00;
        image_bytes[24] = 0x0a;
        image_bytes[25] = 0x02;
        image_bytes.splice(28..28, [0x02, 0x00]);
        input.image_bytes = image_bytes;

        let error = create_capture_proof(input)
            .expect_err("SOS component count must not exceed SOF component count");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_duplicate_start_of_scan_component_id() {
        let mut input = sample_input();
        input.image_bytes = duplicate_sos_component_id_jpeg_bytes();

        let error =
            create_capture_proof(input).expect_err("duplicate SOS component ids should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_start_of_scan_component_missing_from_frame() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes[26] = 0x02;
        input.image_bytes = image_bytes;

        let error = create_capture_proof(input)
            .expect_err("SOS component id must be declared by the SOF segment");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_duplicate_start_of_frame_before_scan() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        image_bytes.splice(
            21..21,
            [
                0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
            ],
        );
        input.image_bytes = image_bytes;

        let error = create_capture_proof(input)
            .expect_err("duplicate SOF before SOS must fail native capture byte policy");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_second_start_of_scan_inside_scan_data() {
        let mut input = sample_input();
        input.image_bytes = second_sos_inside_scan_jpeg_bytes();

        let error = create_capture_proof(input)
            .expect_err("second SOS marker inside scan data should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_forbidden_marker_inside_scan_data() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        let eoi_index = image_bytes.len() - 2;
        image_bytes.splice(eoi_index..eoi_index, [0xff, 0xe0, 0x00, 0x02]);
        input.image_bytes = image_bytes;

        let error =
            create_capture_proof(input).expect_err("APP marker inside scan data should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn proof_creation_rejects_early_eoi_with_trailing_bytes() {
        let mut input = sample_input();
        let mut image_bytes = sample_image_bytes();
        let eoi_index = image_bytes.len() - 2;
        image_bytes.splice(eoi_index..eoi_index, [0xff, 0xd9, 0x00]);
        input.image_bytes = image_bytes;

        let error =
            create_capture_proof(input).expect_err("embedded EOI with trailing bytes should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn verifier_rejects_noncanonical_manifest_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let noncanonical_manifest_json = proof.canonical_manifest_json.replace(
            "\"proof_level\":\"app_capture\"}",
            "\"proof_level\":\"app_capture\",\"extra\":\"field\"}",
        );
        let manifest_hash = hash_bytes(noncanonical_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &noncanonical_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_duplicate_manifest_key_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let duplicate_nonce_json = format!(
            "\"nonce\":\"{}\",\"proof_level\":\"app_capture\"}}",
            hex_encode(&proof.manifest.nonce)
        );
        let duplicate_key_manifest_json = proof
            .canonical_manifest_json
            .replace("\"proof_level\":\"app_capture\"}", &duplicate_nonce_json);
        let manifest_hash = hash_bytes(duplicate_key_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &duplicate_key_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_proof_id, None);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_zero_optional_metadata_commitment_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let zero_metadata_manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"metadata_commitment\":\"{}\"",
                hex_encode(&proof.manifest.metadata_commitment.unwrap())
            ),
            &format!("\"metadata_commitment\":\"{}\"", "0".repeat(64)),
        );
        let manifest_hash = hash_bytes(zero_metadata_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &zero_metadata_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_proof_id, None);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_zero_required_camera_commitment_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let zero_camera_manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"camera_evidence_commitment\":\"{}\"",
                hex_encode(&proof.manifest.camera_evidence_commitment.unwrap())
            ),
            &format!("\"camera_evidence_commitment\":\"{}\"", "0".repeat(64)),
        );
        let manifest_hash = hash_bytes(zero_camera_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &zero_camera_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert_eq!(result.calculated_proof_id, None);
        assert!(!result.proof_id_matches);
        assert!(!result.required_commitments_present);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_reordered_manifest_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let reordered_manifest_json = format!(
            "{{\"proof_level\":\"app_capture\",\"schema_version\":\"argus.manifest.v1\",\
             \"partner_id_hash\":\"{}\",\"use_case\":\"marketplace_listing\",\
             \"capture_session_id\":\"capture-session-001\",\"captured_at_ms\":{},\
             \"image_sha256\":\"{}\",\"metadata_commitment\":\"{}\",\
             \"camera_evidence_commitment\":\"{}\",\"device_integrity_commitment\":\"{}\",\
             \"app_identity_hash\":\"{}\",\"nonce\":\"{}\"}}",
            hex_encode(&proof.manifest.partner_id_hash),
            proof.manifest.captured_at_ms,
            hex_encode(&proof.manifest.image_sha256),
            hex_encode(&proof.manifest.metadata_commitment.unwrap()),
            hex_encode(&proof.manifest.camera_evidence_commitment.unwrap()),
            hex_encode(&proof.manifest.device_integrity_commitment.unwrap()),
            hex_encode(&proof.manifest.app_identity_hash.unwrap()),
            hex_encode(&proof.manifest.nonce)
        );
        let manifest_hash = hash_bytes(reordered_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &reordered_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_uppercase_hash_field_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let partner_id_hash = hex_encode(&proof.manifest.partner_id_hash);
        let uppercase_partner_id_hash = partner_id_hash.to_uppercase();
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!("\"partner_id_hash\":\"{}\"", partner_id_hash),
            &format!("\"partner_id_hash\":\"{}\"", uppercase_partner_id_hash),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_zero_nonce_even_when_self_consistent() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let zero_nonce = [0u8; 32];
        let manifest_json = proof.canonical_manifest_json.replace(
            &format!("\"nonce\":\"{}\"", hex_encode(&proof.manifest.nonce)),
            &format!("\"nonce\":\"{}\"", hex_encode(&zero_nonce)),
        );
        let manifest_hash = hash_bytes(manifest_json.as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &proof.manifest.image_sha256, &zero_nonce);

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_wrong_schema_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let tampered_manifest_json = proof
            .canonical_manifest_json
            .replace("argus.manifest.v1", "argus.manifest.v2");
        let manifest_hash = hash_bytes(tampered_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &tampered_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.schema_version_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_unsupported_use_case_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let tampered_manifest_json = proof
            .canonical_manifest_json
            .replace("marketplace_listing", "insurance_claim");
        let manifest_hash = hash_bytes(tampered_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &tampered_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_untrimmed_capture_session_id_even_when_hashes_match() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let tampered_manifest_json = proof.canonical_manifest_json.replace(
            "\"capture_session_id\":\"capture-session-001\"",
            "\"capture_session_id\":\" capture-session-001 \"",
        );
        let manifest_hash = hash_bytes(tampered_manifest_json.as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &proof.manifest.image_sha256,
            &proof.manifest.nonce,
        );

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &tampered_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(!result.proof_id_matches);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_device_attested_until_registry_and_relayer_support_it() {
        let mut input = sample_input();
        input.device_integrity_json = Some(level_four_device_integrity_json());
        input.proof_level = ProofLevel::DeviceAttested;
        let proof = create_capture_proof(input).expect("proof should build");

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.proof_level_supported);
        assert!(!result.required_commitments_present);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_accepts_app_capture_for_level_four_device_integrity_evidence() {
        let device_integrity_json = level_four_device_integrity_json();
        let mut input = sample_input();
        input.device_integrity_json = Some(device_integrity_json.clone());
        input.proof_level = ProofLevel::AppCapture;
        let proof =
            create_capture_proof(input).expect("level evidence should verify as app_capture");

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );

        assert_eq!(
            proof.manifest.device_integrity_commitment,
            Some(hash_bytes(device_integrity_json.as_bytes()))
        );
        assert!(result.proof_level_supported);
        assert!(result.required_commitments_present);
        assert!(result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_demo_until_registry_and_relayer_support_it() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::Demo;
        let proof = create_capture_proof(input).expect("proof should build");

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &proof.canonical_manifest_json,
            &hex_encode(&proof.manifest_hash),
            &hex_encode(&proof.proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.proof_level_supported);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_app_capture_without_device_integrity_commitment() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let missing_commitment_manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"device_integrity_commitment\":\"{}\"",
                hex_encode(&proof.manifest.device_integrity_commitment.unwrap())
            ),
            "\"device_integrity_commitment\":null",
        );
        let manifest_hash = hash_bytes(missing_commitment_manifest_json.as_bytes());
        let image_hash = hex_decode_32(
            extract_test_field(&missing_commitment_manifest_json, "image_sha256").as_str(),
        )
        .expect("image hash should decode");
        let nonce =
            hex_decode_32(extract_test_field(&missing_commitment_manifest_json, "nonce").as_str())
                .expect("nonce should decode");
        let proof_id = derive_proof_id(&manifest_hash, &image_hash, &nonce);

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &missing_commitment_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.required_commitments_present);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn verifier_rejects_device_attested_without_required_commitments() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::DeviceAttested;
        let proof = create_capture_proof(input).expect("proof should build");
        let missing_commitment_manifest_json = proof.canonical_manifest_json.replace(
            &format!(
                "\"device_integrity_commitment\":\"{}\"",
                hex_encode(&proof.manifest.device_integrity_commitment.unwrap())
            ),
            "\"device_integrity_commitment\":null",
        );
        let manifest_hash = hash_bytes(missing_commitment_manifest_json.as_bytes());
        let image_hash = hex_decode_32(
            extract_test_field(&missing_commitment_manifest_json, "image_sha256").as_str(),
        )
        .expect("image hash should decode");
        let nonce =
            hex_decode_32(extract_test_field(&missing_commitment_manifest_json, "nonce").as_str())
                .expect("nonce should decode");
        let proof_id = derive_proof_id(&manifest_hash, &image_hash, &nonce);

        let result = verify_capture_proof(
            &sample_image_bytes(),
            &missing_commitment_manifest_json,
            &hex_encode(&manifest_hash),
            &hex_encode(&proof_id),
        );

        assert!(!result.manifest_hash_matches);
        assert!(result.proof_id_matches);
        assert!(!result.required_commitments_present);
        assert!(!result.proof_material_matches());
    }

    #[test]
    fn registry_payload_omits_raw_evidence() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let payload = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect("app_capture payload should build");

        assert_eq!(payload.schema_version, 1);
        assert_eq!(payload.use_case, "marketplace_listing");
        assert_eq!(payload.proof_id.len(), 64);
        assert_eq!(payload.manifest_hash.len(), 64);
    }

    #[test]
    fn registry_payload_keeps_app_capture_for_level_four_device_integrity_evidence() {
        let device_integrity_json = level_four_device_integrity_json();
        let mut input = sample_input();
        input.device_integrity_json = Some(device_integrity_json.clone());
        input.proof_level = ProofLevel::AppCapture;
        let proof =
            create_capture_proof(input).expect("level evidence should build as app_capture");

        let payload = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect("app_capture payload should build");

        assert_eq!(proof.manifest.proof_level, ProofLevel::AppCapture);
        assert_eq!(
            proof.manifest.device_integrity_commitment,
            Some(hash_bytes(device_integrity_json.as_bytes()))
        );
        assert_eq!(payload.proof_level, "app_capture");
    }

    #[test]
    fn registry_payload_rejects_image_bytes_that_do_not_match_manifest() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut other_jpeg_bytes = sample_image_bytes();
        other_jpeg_bytes[31] ^= 1;

        let error = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &other_jpeg_bytes,
        )
        .expect_err("mismatched image bytes should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput("image_sha256 does not match image_bytes".to_string())
        );
    }

    #[test]
    fn registry_payload_rejects_non_jpeg_image_bytes_even_when_manifest_matches() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let non_jpeg_bytes = b"not camera jpeg bytes";
        let mut manifest = proof.manifest.clone();
        manifest.image_sha256 = hash_bytes(non_jpeg_bytes);
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error = build_registry_payload(&manifest, proof_id, manifest_hash, non_jpeg_bytes)
            .expect_err("non-JPEG image bytes should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_duplicate_sos_component_id_even_when_manifest_matches() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let image_bytes = duplicate_sos_component_id_jpeg_bytes();
        let mut manifest = proof.manifest.clone();
        manifest.image_sha256 = hash_bytes(&image_bytes);
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error = build_registry_payload(&manifest, proof_id, manifest_hash, &image_bytes)
            .expect_err("duplicate SOS component id should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_second_sos_inside_scan_even_when_manifest_matches() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let image_bytes = second_sos_inside_scan_jpeg_bytes();
        let mut manifest = proof.manifest.clone();
        manifest.image_sha256 = hash_bytes(&image_bytes);
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error = build_registry_payload(&manifest, proof_id, manifest_hash, &image_bytes)
            .expect_err("second SOS marker should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes must pass the native-capture JPEG-like byte policy".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_oversized_image_bytes_before_jpeg_parse() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let oversized_bytes = vec![0xff; crate::manifest::MAX_NATIVE_CAPTURE_IMAGE_BYTES + 1];

        let error = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &oversized_bytes,
        )
        .expect_err("oversized image bytes should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "image_bytes exceed native capture photo byte limit".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_accepts_image_bytes_at_native_capture_limit() {
        let exact_limit_bytes = native_capture_limit_jpeg_bytes();
        let mut input = sample_input();
        input.image_bytes = exact_limit_bytes.clone();
        let proof = create_capture_proof(input).expect("exact-limit proof should build");

        let payload = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &exact_limit_bytes,
        )
        .expect("exact-limit image bytes should build a registry payload");

        assert_eq!(payload.image_hash, hex_encode(&proof.manifest.image_sha256));
    }

    #[test]
    fn registry_payload_rejects_device_attested_until_registry_supports_it() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::DeviceAttested;
        let proof = create_capture_proof(input).expect("proof should build");

        let error = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("device_attested should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "proof_level is not supported by the registry".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_demo_until_registry_supports_it() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::Demo;
        let proof = create_capture_proof(input).expect("proof should build");

        let error = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("demo should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "proof_level is not supported by the registry".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_unsupported_use_case() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest;
        manifest.use_case = "insurance_claim".to_string();

        let error = build_registry_payload(
            &manifest,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("unsupported use case should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "use_case is not supported by the registry".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_app_capture_without_required_commitments() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");

        let mut missing_camera = proof.manifest.clone();
        missing_camera.camera_evidence_commitment = None;
        let error = build_registry_payload(
            &missing_camera,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("missing camera evidence should not build a registry payload");
        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "camera_evidence_commitment is required for app_capture registry payload"
                    .to_string()
            )
        );

        let mut missing_device = proof.manifest.clone();
        missing_device.device_integrity_commitment = None;
        let error = build_registry_payload(
            &missing_device,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("missing device integrity should not build a registry payload");
        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "device_integrity_commitment is required for app_capture registry payload"
                    .to_string()
            )
        );

        let mut missing_app_identity = proof.manifest.clone();
        missing_app_identity.app_identity_hash = None;
        let error = build_registry_payload(
            &missing_app_identity,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("missing app identity should not build a registry payload");
        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "app_identity_hash is required for app_capture registry payload".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_zero_optional_metadata_commitment() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest.clone();
        manifest.metadata_commitment = Some([0u8; 32]);
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error =
            build_registry_payload(&manifest, proof_id, manifest_hash, &sample_image_bytes())
                .expect_err("zero optional metadata commitment should not build a payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "metadata_commitment cannot be zero when present".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_zero_required_commitments() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");

        let mut zero_camera = proof.manifest.clone();
        zero_camera.camera_evidence_commitment = Some([0u8; 32]);
        let manifest_hash = hash_bytes(canonical_manifest_json(&zero_camera).as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &zero_camera.image_sha256,
            &zero_camera.nonce,
        );
        let error =
            build_registry_payload(&zero_camera, proof_id, manifest_hash, &sample_image_bytes())
                .expect_err("zero camera evidence should not build a registry payload");
        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "camera_evidence_commitment is required for app_capture registry payload"
                    .to_string()
            )
        );

        let mut zero_device = proof.manifest.clone();
        zero_device.device_integrity_commitment = Some([0u8; 32]);
        let manifest_hash = hash_bytes(canonical_manifest_json(&zero_device).as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &zero_device.image_sha256,
            &zero_device.nonce,
        );
        let error =
            build_registry_payload(&zero_device, proof_id, manifest_hash, &sample_image_bytes())
                .expect_err("zero device integrity should not build a registry payload");
        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "device_integrity_commitment is required for app_capture registry payload"
                    .to_string()
            )
        );

        let mut zero_app_identity = proof.manifest.clone();
        zero_app_identity.app_identity_hash = Some([0u8; 32]);
        let manifest_hash = hash_bytes(canonical_manifest_json(&zero_app_identity).as_bytes());
        let proof_id = derive_proof_id(
            &manifest_hash,
            &zero_app_identity.image_sha256,
            &zero_app_identity.nonce,
        );
        let error = build_registry_payload(
            &zero_app_identity,
            proof_id,
            manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("zero app identity should not build a registry payload");
        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "app_identity_hash is required for app_capture registry payload".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_oversized_capture_session_id() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest.clone();
        manifest.capture_session_id =
            "a".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES + 1);

        let error = build_registry_payload(
            &manifest,
            proof.proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("oversized capture session id should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "capture_session_id exceeds canonical manifest JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_generated_manifest_over_json_text_limit() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest.clone();
        manifest.capture_session_id =
            "a".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES - 1);
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error =
            build_registry_payload(&manifest, proof_id, manifest_hash, &sample_image_bytes())
                .expect_err("oversized canonical manifest should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "canonical_manifest_json exceeds JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_oversized_canonical_manifest_before_image_parse() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest.clone();
        manifest.capture_session_id =
            "a".repeat(crate::manifest::MAX_CANONICAL_MANIFEST_JSON_BYTES - 1);
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error =
            build_registry_payload(&manifest, proof_id, manifest_hash, b"not camera jpeg bytes")
                .expect_err("oversized canonical manifest should fail before image parsing");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "canonical_manifest_json exceeds JSON text limit".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_mismatched_manifest_hash() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut wrong_manifest_hash = proof.manifest_hash;
        wrong_manifest_hash[0] ^= 1;

        let error = build_registry_payload(
            &proof.manifest,
            proof.proof_id,
            wrong_manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("mismatched manifest hash should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "manifest_hash does not match canonical manifest".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_mismatched_proof_id() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut wrong_proof_id = proof.proof_id;
        wrong_proof_id[0] ^= 1;

        let error = build_registry_payload(
            &proof.manifest,
            wrong_proof_id,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("mismatched proof id should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "proof_id does not match canonical manifest".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_proof_id_that_omits_nonce() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let proof_id_without_nonce =
            hash_bytes(&[proof.manifest_hash, proof.manifest.image_sha256].concat());

        let error = build_registry_payload(
            &proof.manifest,
            proof_id_without_nonce,
            proof.manifest_hash,
            &sample_image_bytes(),
        )
        .expect_err("nonce-omitting proof id should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "proof_id does not match canonical manifest".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_public_manifest_with_wrong_schema() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest.clone();
        manifest.schema_version = "argus.manifest.v2".to_string();
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error =
            build_registry_payload(&manifest, proof_id, manifest_hash, &sample_image_bytes())
                .expect_err("wrong manifest schema should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "schema_version is not supported by the registry".to_string()
            )
        );
    }

    #[test]
    fn registry_payload_rejects_public_manifest_with_zero_nonce() {
        let proof = create_capture_proof(sample_input()).expect("proof should build");
        let mut manifest = proof.manifest.clone();
        manifest.nonce = [0u8; 32];
        let manifest_hash = hash_bytes(canonical_manifest_json(&manifest).as_bytes());
        let proof_id = derive_proof_id(&manifest_hash, &manifest.image_sha256, &manifest.nonce);

        let error =
            build_registry_payload(&manifest, proof_id, manifest_hash, &sample_image_bytes())
                .expect_err("zero nonce should not build a registry payload");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput("nonce cannot be zero".to_string())
        );
    }

    #[test]
    fn preserves_prehashed_app_identity_commitment() {
        let mut input = sample_input();
        let app_identity_hash = [9u8; 32];
        input.app_identity_json = Some(hex_encode(&app_identity_hash));

        let proof = create_capture_proof(input).expect("proof should build");

        assert_eq!(proof.manifest.app_identity_hash, Some(app_identity_hash));
    }

    #[test]
    fn rejects_app_capture_without_app_identity_digest() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::AppCapture;
        input.app_identity_json = Some("com.argus.fake".to_string());

        let error = create_capture_proof(input).expect_err("fake app identity should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "app_identity_json must be a non-zero 32-byte hex string for app_capture"
                    .to_string()
            )
        );
    }

    #[test]
    fn rejects_device_attested_without_app_identity_digest() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::DeviceAttested;
        input.app_identity_json = Some("0".repeat(64));

        let error = create_capture_proof(input).expect_err("zero app identity should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "app_identity_json must be a non-zero 32-byte hex string for device_attested"
                    .to_string()
            )
        );
    }

    #[test]
    fn rejects_app_capture_without_camera_evidence() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::AppCapture;
        input.camera_evidence_json = None;

        let error = create_capture_proof(input).expect_err("missing camera evidence should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "camera_evidence_json is required for app_capture".to_string()
            )
        );
    }

    #[test]
    fn rejects_app_capture_without_device_integrity() {
        let mut input = sample_input();
        input.device_integrity_json = None;

        let error = create_capture_proof(input).expect_err("missing device integrity should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "device_integrity_json is required for app_capture".to_string()
            )
        );
    }

    #[test]
    fn rejects_demo_without_camera_evidence() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::Demo;
        input.camera_evidence_json = None;

        let error = create_capture_proof(input).expect_err("missing camera evidence should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "camera_evidence_json is required for demo".to_string()
            )
        );
    }

    #[test]
    fn rejects_device_attested_without_device_integrity() {
        let mut input = sample_input();
        input.proof_level = ProofLevel::DeviceAttested;
        input.device_integrity_json = None;

        let error = create_capture_proof(input).expect_err("missing device integrity should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "device_integrity_json is required for device_attested".to_string()
            )
        );
    }

    #[test]
    fn rejects_zero_nonce() {
        let mut input = sample_input();
        input.nonce = [0u8; 32];

        let error = create_capture_proof(input).expect_err("zero nonce should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput("nonce cannot be zero".to_string())
        );
    }

    #[test]
    fn rejects_unsupported_use_case() {
        let mut input = sample_input();
        input.use_case = "insurance_claim".to_string();

        let error = create_capture_proof(input).expect_err("unsupported use case should fail");

        assert_eq!(
            error,
            super::ArgusError::InvalidInput(
                "use_case is not supported by the registry".to_string()
            )
        );
    }

    fn extract_test_field(json: &str, key: &str) -> String {
        let needle = format!("\"{}\":\"", key);
        let start = json.find(&needle).expect("field should exist") + needle.len();
        let remainder = &json[start..];
        let end = remainder.find('"').expect("field should be closed");

        remainder[..end].to_string()
    }
}
