use crate::hashing::{hash_bytes, hash_image, hex_decode_32};
use crate::ArgusError;

pub const ARGUS_MANIFEST_SCHEMA_VERSION: &str = "argus.manifest.v1";
pub const ARGUS_USE_CASE_MARKETPLACE_LISTING: &str = "marketplace_listing";
pub const MAX_CANONICAL_MANIFEST_JSON_BYTES: usize = 4 * 1024;
pub const MAX_METADATA_JSON_BYTES: usize = 64 * 1024;
pub const MAX_EVIDENCE_JSON_BYTES: usize = 16 * 1024;
pub const MAX_NATIVE_CAPTURE_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProofLevel {
    // kr: Android Level 3/4 evidence는 새 on-chain proof level이 아니라 app_capture의 device_integrity_json으로 commit됩니다.
    // en: Android Level 3/4 evidence is committed through app_capture device_integrity_json, not a new on-chain proof level.
    // kr: certificate chain과 trusted attestation root fingerprint 검증은 Rust 밖의 relayer/verifier policy입니다.
    // en: Certificate-chain and trusted attestation-root fingerprint checks are relayer/verifier policy outside Rust.
    AppCapture,
    // kr: device_attested는 예약된 manifest label일 뿐이며 현재 production registry/verifier에서는 fail-closed 됩니다.
    // en: device_attested is only a reserved manifest label; current production registry/verifier paths fail closed on it.
    DeviceAttested,
    Demo,
}

impl ProofLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProofLevel::AppCapture => "app_capture",
            ProofLevel::DeviceAttested => "device_attested",
            ProofLevel::Demo => "demo",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestInput {
    pub partner_id: String,
    pub use_case: String,
    pub capture_session_id: String,
    pub captured_at_ms: i64,
    pub image_bytes: Vec<u8>,
    pub metadata_json: Option<String>,
    pub camera_evidence_json: Option<String>,
    pub device_integrity_json: Option<String>,
    pub app_identity_json: Option<String>,
    pub nonce: [u8; 32],
    pub proof_level: ProofLevel,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureManifest {
    pub schema_version: String,
    pub partner_id_hash: [u8; 32],
    pub use_case: String,
    pub capture_session_id: String,
    pub captured_at_ms: i64,
    pub image_sha256: [u8; 32],
    pub metadata_commitment: Option<[u8; 32]>,
    pub camera_evidence_commitment: Option<[u8; 32]>,
    pub device_integrity_commitment: Option<[u8; 32]>,
    pub app_identity_hash: Option<[u8; 32]>,
    pub nonce: [u8; 32],
    pub proof_level: ProofLevel,
}

// kr: build_manifest는 Android/Kotlin에서 받은 촬영 입력을 안정적인 Argus manifest로 변환합니다.
// en: build_manifest converts capture input from Android/Kotlin into a stable Argus manifest.
pub fn build_manifest(input: ManifestInput) -> Result<CaptureManifest, ArgusError> {
    validate_manifest_input(&input)?;

    Ok(CaptureManifest {
        schema_version: ARGUS_MANIFEST_SCHEMA_VERSION.to_string(),
        partner_id_hash: hash_bytes(input.partner_id.trim().as_bytes()),
        use_case: input.use_case.trim().to_string(),
        capture_session_id: input.capture_session_id.trim().to_string(),
        captured_at_ms: input.captured_at_ms,
        image_sha256: hash_image(&input.image_bytes),
        metadata_commitment: commit_optional_text(input.metadata_json),
        camera_evidence_commitment: commit_optional_text(input.camera_evidence_json),
        device_integrity_commitment: commit_optional_text(input.device_integrity_json),
        app_identity_hash: commit_app_identity(input.app_identity_json),
        nonce: input.nonce,
        proof_level: input.proof_level,
    })
}

// kr: validate_manifest_input은 proof에 필요한 최소 입력이 비어 있으면 즉시 실패하게 합니다.
// en: validate_manifest_input fails early when the minimum proof inputs are missing.
fn validate_manifest_input(input: &ManifestInput) -> Result<(), ArgusError> {
    if input.partner_id.trim().is_empty() {
        return Err(ArgusError::InvalidInput(
            "partner_id is required".to_string(),
        ));
    }

    let use_case = input.use_case.trim();
    if use_case.is_empty() {
        return Err(ArgusError::InvalidInput("use_case is required".to_string()));
    }

    if use_case != ARGUS_USE_CASE_MARKETPLACE_LISTING {
        return Err(ArgusError::InvalidInput(
            "use_case is not supported by the registry".to_string(),
        ));
    }

    if input.capture_session_id.trim().is_empty() {
        return Err(ArgusError::InvalidInput(
            "capture_session_id is required".to_string(),
        ));
    }

    if input.capture_session_id.as_bytes().len() > MAX_CANONICAL_MANIFEST_JSON_BYTES {
        return Err(ArgusError::InvalidInput(
            "capture_session_id exceeds canonical manifest JSON text limit".to_string(),
        ));
    }

    if input.captured_at_ms <= 0 {
        return Err(ArgusError::InvalidInput(
            "captured_at_ms must be positive".to_string(),
        ));
    }

    if input.nonce == [0u8; 32] {
        return Err(ArgusError::InvalidInput("nonce cannot be zero".to_string()));
    }

    validate_optional_text_limit(
        &input.metadata_json,
        MAX_METADATA_JSON_BYTES,
        "metadata_json exceeds JSON text limit",
    )?;
    validate_optional_text_limit(
        &input.camera_evidence_json,
        MAX_EVIDENCE_JSON_BYTES,
        "camera_evidence_json exceeds JSON text limit",
    )?;
    validate_optional_text_limit(
        &input.device_integrity_json,
        MAX_EVIDENCE_JSON_BYTES,
        "device_integrity_json exceeds JSON text limit",
    )?;
    validate_proof_level_inputs(input)?;

    if input.image_bytes.is_empty() {
        return Err(ArgusError::InvalidInput(
            "image_bytes cannot be empty".to_string(),
        ));
    }

    if input.image_bytes.len() > MAX_NATIVE_CAPTURE_IMAGE_BYTES {
        return Err(ArgusError::InvalidInput(
            "image_bytes exceed native capture photo byte limit".to_string(),
        ));
    }

    if !is_jpeg_image(&input.image_bytes) {
        return Err(ArgusError::InvalidInput(
            "image_bytes must pass the native-capture JPEG-like byte policy".to_string(),
        ));
    }

    Ok(())
}

fn validate_optional_text_limit(
    value: &Option<String>,
    max_bytes: usize,
    message: &str,
) -> Result<(), ArgusError> {
    if value
        .as_ref()
        .is_some_and(|text| text.as_bytes().len() > max_bytes)
    {
        return Err(ArgusError::InvalidInput(message.to_string()));
    }

    Ok(())
}

fn validate_proof_level_inputs(input: &ManifestInput) -> Result<(), ArgusError> {
    match input.proof_level {
        ProofLevel::Demo => {
            require_text(
                &input.camera_evidence_json,
                "camera_evidence_json is required for demo",
            )?;
            require_app_identity_hash(
                &input.app_identity_json,
                "app_identity_json must be a non-zero 32-byte hex string for demo",
            )
        }
        ProofLevel::AppCapture => {
            require_text(
                &input.camera_evidence_json,
                "camera_evidence_json is required for app_capture",
            )?;
            require_text(
                &input.device_integrity_json,
                "device_integrity_json is required for app_capture",
            )?;
            require_app_identity_hash(
                &input.app_identity_json,
                "app_identity_json must be a non-zero 32-byte hex string for app_capture",
            )
        }
        ProofLevel::DeviceAttested => {
            require_text(
                &input.camera_evidence_json,
                "camera_evidence_json is required for device_attested",
            )?;
            require_text(
                &input.device_integrity_json,
                "device_integrity_json is required for device_attested",
            )?;
            require_app_identity_hash(
                &input.app_identity_json,
                "app_identity_json must be a non-zero 32-byte hex string for device_attested",
            )
        }
    }
}

fn require_text(value: &Option<String>, message: &str) -> Result<(), ArgusError> {
    if value.as_ref().is_some_and(|text| !text.trim().is_empty()) {
        return Ok(());
    }

    Err(ArgusError::InvalidInput(message.to_string()))
}

fn require_app_identity_hash(value: &Option<String>, message: &str) -> Result<(), ArgusError> {
    if value
        .as_ref()
        .and_then(|text| hex_decode_32(text.trim()))
        .is_some_and(|hash| hash != [0u8; 32])
    {
        return Ok(());
    }

    Err(ArgusError::InvalidInput(message.to_string()))
}

// kr: is_jpeg_image는 완전한 JPEG decoder가 아니라 native capture bytes용 구조적 byte-policy gate입니다.
// en: is_jpeg_image is not a full JPEG decoder; it is a structural byte-policy gate for native capture bytes.
pub(crate) fn is_jpeg_image(bytes: &[u8]) -> bool {
    if bytes.len() > MAX_NATIVE_CAPTURE_IMAGE_BYTES
        || bytes.len() < 12
        || bytes[0] != 0xff
        || bytes[1] != 0xd8
        || bytes[bytes.len() - 2] != 0xff
        || bytes[bytes.len() - 1] != 0xd9
    {
        return false;
    }

    let mut index = 2;
    let mut saw_start_of_frame = false;
    let mut frame_component_ids = [0u8; 4];
    let mut frame_component_count = 0usize;
    let eoi_index = bytes.len() - 2;

    while index < eoi_index {
        if bytes[index] != 0xff {
            return false;
        }

        while index < eoi_index && bytes[index] == 0xff {
            index += 1;
        }

        if index >= eoi_index {
            return false;
        }

        let marker = bytes[index];
        index += 1;

        if marker == 0x00 || marker == 0xd9 {
            return false;
        }

        if marker == 0x01 {
            continue;
        }

        if index + 2 > eoi_index {
            return false;
        }

        let segment_length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if segment_length < 2 {
            return false;
        }

        let segment_end = index + segment_length;
        if segment_end > eoi_index {
            return false;
        }

        if is_jpeg_start_of_frame_marker(marker) {
            // kr: SOF는 SOS component id allowlist를 정하므로 두 번째 SOF는 fail-closed 합니다.
            // en: SOF defines the SOS component-id allowlist, so a second SOF fails closed.
            if saw_start_of_frame {
                return false;
            }
            let Some(frame_components) = start_of_frame_components(bytes, index, segment_length)
            else {
                return false;
            };
            frame_component_ids = frame_components.0;
            frame_component_count = frame_components.1;
            saw_start_of_frame = true;
        }

        if marker == 0xda {
            // kr: SOS가 SOF에 선언되지 않은 component id를 가리키면 JPEG처럼 보여도 fail-closed 합니다.
            // en: If SOS references a component id not declared by SOF, fail closed even if the bytes look JPEG-like.
            if !start_of_scan_references_frame_components(
                bytes,
                index,
                segment_length,
                &frame_component_ids,
                frame_component_count,
            ) {
                return false;
            }
            return saw_start_of_frame && scan_data_runs_to_final_eoi(bytes, segment_end);
        }

        index = segment_end;
    }

    false
}

fn is_jpeg_start_of_frame_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
    )
}

fn start_of_frame_components(
    bytes: &[u8],
    length_index: usize,
    segment_length: usize,
) -> Option<([u8; 4], usize)> {
    if segment_length < 11 || length_index + segment_length > bytes.len() {
        return None;
    }

    let height = u16::from_be_bytes([bytes[length_index + 3], bytes[length_index + 4]]);
    let width = u16::from_be_bytes([bytes[length_index + 5], bytes[length_index + 6]]);
    let component_count = bytes[length_index + 7] as usize;

    if height == 0
        || width == 0
        || component_count == 0
        || component_count > 4
        || segment_length != 8 + component_count * 3
    {
        return None;
    }

    let mut component_ids = [0u8; 4];
    for component_index in 0..component_count {
        let id_offset = length_index + 8 + component_index * 3;
        let component_id = bytes[id_offset];
        if component_ids[..component_index].contains(&component_id) {
            return None;
        }
        component_ids[component_index] = component_id;
    }

    Some((component_ids, component_count))
}

fn start_of_scan_references_frame_components(
    bytes: &[u8],
    length_index: usize,
    segment_length: usize,
    frame_component_ids: &[u8; 4],
    frame_component_count: usize,
) -> bool {
    if segment_length < 8 || length_index + segment_length > bytes.len() {
        return false;
    }

    let component_count = bytes[length_index + 2] as usize;

    if component_count == 0
        || component_count > 4
        || component_count > frame_component_count
        || segment_length != 6 + component_count * 2
    {
        return false;
    }

    let mut scan_component_ids = [0u8; 4];
    for component_index in 0..component_count {
        let id_offset = length_index + 3 + component_index * 2;
        let component_id = bytes[id_offset];
        if scan_component_ids[..component_index].contains(&component_id) {
            return false;
        }
        if !frame_component_ids[..frame_component_count].contains(&component_id) {
            return false;
        }
        scan_component_ids[component_index] = component_id;
    }

    true
}

fn scan_data_runs_to_final_eoi(bytes: &[u8], mut index: usize) -> bool {
    let eoi_index = bytes.len() - 2;
    if index >= eoi_index {
        return false;
    }

    // kr: Scan data 안에서는 FF 00(escaped FF byte)와 restart marker만 데이터 흐름으로 허용합니다.
    // en: Inside scan data, only FF 00 (escaped FF byte) and restart markers remain part of the data stream.
    // kr: 그 외 marker는 최종 EOI 하나만 허용해 두 번째 SOS/APP marker 같은 구조 변경을 fail-closed 합니다.
    // en: Any other marker must be the final EOI, which fails closed on a second SOS, APP marker, or similar structure change.
    let mut saw_scan_data = false;
    while index < eoi_index {
        if bytes[index] != 0xff {
            saw_scan_data = true;
            index += 1;
            continue;
        }

        index += 1;
        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }

        if index >= bytes.len() {
            return false;
        }

        let marker = bytes[index];
        if marker == 0x00 {
            saw_scan_data = true;
            index += 1;
            continue;
        }

        if (0xd0..=0xd7).contains(&marker) {
            index += 1;
            continue;
        }

        return marker == 0xd9 && index == bytes.len() - 1 && saw_scan_data;
    }

    saw_scan_data
}

// kr: commit_optional_text는 metadata/evidence 내용을 원문으로 저장하지 않고 hash commitment만 만듭니다.
// en: commit_optional_text creates only a hash commitment instead of storing raw metadata/evidence.
fn commit_optional_text(value: Option<String>) -> Option<[u8; 32]> {
    let text = value?;
    if text.trim().is_empty() {
        return None;
    }

    Some(hash_bytes(text.as_bytes()))
}

// kr: Android는 앱 서명 인증서 digest를 이미 SHA-256 hash로 넘기므로 임의 문자열을 hash하지 않습니다.
// en: Android passes the signing-certificate digest as a SHA-256 hash, so arbitrary text is not re-hashed here.
fn commit_app_identity(value: Option<String>) -> Option<[u8; 32]> {
    let text = value?;
    let trimmed = text.trim();

    hex_decode_32(trimmed).filter(|hash| *hash != [0u8; 32])
}
