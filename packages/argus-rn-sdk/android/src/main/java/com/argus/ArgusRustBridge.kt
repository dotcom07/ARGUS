package com.argus

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.security.MessageDigest
import java.time.Instant

class ArgusRustBridge {

    // kr: createProof는 Rust core의 canonical proof 규칙과 같은 Android proof bundle을 만듭니다.
    // en: createProof builds an Android proof bundle that follows the Rust core canonical proof rules.
    fun createProof(
        partnerId: String,
        useCase: String,
        metadataJson: String,
        cameraEvidenceJson: String,
        deviceEvidenceJson: String,
        appIdentityHash: String,
        captureSessionId: String?,
        sessionNonce: String?,
        capturedAtMs: Long,
        imageBytes: ByteArray,
        playIntegrityTokenHash: String? = null,
    ): WritableMap {
        val safePartnerId = partnerId.trim().takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("partnerId is required for app_capture")
        val safeUseCase = useCase.trim().takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("useCase is required for app_capture")
        if (safeUseCase != SUPPORTED_USE_CASE) {
            throw IllegalArgumentException("useCase is not supported by the registry")
        }
        ArgusProofTextPolicy.requireWithinLimit(
            "metadataJson",
            metadataJson,
            ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES,
        )
        ArgusProofTextPolicy.requireWithinLimit(
            "cameraEvidenceJson",
            cameraEvidenceJson,
            ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES,
        )
        ArgusProofTextPolicy.requireWithinLimit(
            "deviceEvidenceJson",
            deviceEvidenceJson,
            ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES,
        )

        val safeCapturedAtMs = capturedAtMs.takeIf { it > 0L }
            ?: throw IllegalArgumentException("capturedAtMs must be positive")
        val safeCaptureSessionId = captureSessionId?.trim()?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("captureSessionId is required for app_capture")
        ArgusProofTextPolicy.requireWithinLimit(
            "captureSessionId",
            safeCaptureSessionId,
            ArgusProofTextPolicy.MAX_CANONICAL_MANIFEST_JSON_BYTES,
        )
        if (imageBytes.isEmpty()) {
            throw IllegalArgumentException("imageBytes cannot be empty")
        }
        if (imageBytes.size > ArgusImageBytesPolicy.MAX_NATIVE_CAPTURE_IMAGE_BYTES) {
            throw IllegalArgumentException("imageBytes exceed native capture photo byte limit")
        }
        if (!ArgusImageBytesPolicy.isJpegImage(imageBytes)) {
            throw IllegalArgumentException("imageBytes must pass the native-capture JPEG-like byte policy")
        }

        val imageHash = sha256Hex(imageBytes)
        val partnerIdHash = sha256Hex(safePartnerId.toByteArray())
        val nonce = normalizeNonce(sessionNonce)
        val safeAppIdentityHash = normalizeAppIdentityHash(appIdentityHash)
        val keystoreBindingData = ArgusKeystoreEvidence.canonicalProofBindingData(
            ArgusKeystoreEvidence.ProofBindingInput(
                partnerId = safePartnerId,
                useCase = safeUseCase,
                metadataJson = metadataJson,
                cameraEvidenceJson = cameraEvidenceJson,
                appIdentityHash = safeAppIdentityHash,
                captureSessionId = safeCaptureSessionId,
                sessionNonce = nonce,
                capturedAtMs = safeCapturedAtMs,
                imageBytes = imageBytes,
                playIntegrityTokenHash = playIntegrityTokenHash,
            ),
        )
        val keystoreValidation = ArgusKeystoreEvidence.validateDeviceEvidence(
            deviceEvidenceJson = deviceEvidenceJson,
            bindingData = keystoreBindingData,
        )
        if (keystoreValidation.claimedSigned && !keystoreValidation.signaturePresent) {
            throw IllegalArgumentException("keystoreSignature must verify canonical proof binding data")
        }
        val evidence = ArgusEvidencePolicy.validateAppCaptureEvidence(
            cameraEvidenceJson = cameraEvidenceJson,
            deviceEvidenceJson = deviceEvidenceJson,
            expectedAppIdentityHash = safeAppIdentityHash,
            expectedCapturedFileBytes = imageBytes.size.toLong(),
            capturedAtMs = safeCapturedAtMs,
        )

        val canonicalManifestJson = buildCanonicalManifestJson(
            partnerIdHash = partnerIdHash,
            useCase = safeUseCase,
            captureSessionId = safeCaptureSessionId,
            capturedAtMs = safeCapturedAtMs,
            imageHash = imageHash,
            metadataCommitment = sha256Hex(metadataJson.toByteArray()),
            cameraEvidenceCommitment = sha256Hex(cameraEvidenceJson.toByteArray()),
            deviceIntegrityCommitment = sha256Hex(deviceEvidenceJson.toByteArray()),
            appIdentityHash = safeAppIdentityHash,
            nonce = nonce,
        )
        ArgusProofTextPolicy.requireWithinLimit(
            "canonicalManifestJson",
            canonicalManifestJson,
            ArgusProofTextPolicy.MAX_CANONICAL_MANIFEST_JSON_BYTES,
        )
        val manifestHash = sha256Hex(canonicalManifestJson.toByteArray())
        val proofId = deriveProofId(manifestHash, imageHash, nonce)

        val evidenceSummary = Arguments.createMap()
        evidenceSummary.putBoolean("cameraMetadata", evidence.cameraMetadataPresent)
        evidenceSummary.putBoolean("noGalleryImport", evidence.noGalleryImportPresent)
        evidenceSummary.putBoolean("captureSurface", evidence.nativeCaptureSurfacePresent)
        evidenceSummary.putBoolean("motionSnapshot", evidence.motionSnapshotPresent)
        evidenceSummary.putBoolean("appIdentityHash", evidence.appIdentityHashPresent)
        // kr: keystoreAttestationMaterial은 verifier가 볼 chain/challenge가 있다는 뜻이고, keystoreAttestation은 trusted root 검증 뒤에만 true가 될 수 있습니다.
        // en: keystoreAttestationMaterial means chain/challenge material is present; keystoreAttestation can only become true after trusted-root validation.
        evidenceSummary.putBoolean("keystoreSignature", keystoreValidation.signaturePresent)
        evidenceSummary.putBoolean("keystoreAttestation", keystoreValidation.attestationPresent)
        evidenceSummary.putBoolean("keystoreAttestationMaterial", keystoreValidation.attestationMaterialPresent)
        evidenceSummary.putInt("keystoreLevel", keystoreValidation.level)
        evidenceSummary.putInt("androidEvidenceLevel", keystoreValidation.level)
        evidenceSummary.putString("keystoreSecurityLevel", keystoreValidation.securityLevel)
        evidenceSummary.putString("evidenceLevel", evidenceLevel(keystoreValidation))
        evidenceSummary.putBoolean("level3KeystoreSignature", keystoreValidation.signaturePresent)
        evidenceSummary.putBoolean("level4HardwareAttestation", keystoreValidation.attestationPresent)
        evidenceSummary.putString("attestationStatus", attestationStatus(keystoreValidation))
        evidenceSummary.putString("keystorePublicKeyPem", keystoreValidation.publicKeyPem)
        evidenceSummary.putArray(
            "attestationCertificateChainPem",
            stringArray(keystoreValidation.attestationCertificateChainPem),
        )

        val proof = Arguments.createMap()
        proof.putString("proofId", proofId)
        proof.putString("manifestHash", manifestHash)
        proof.putString("imageHash", imageHash)
        proof.putString("partnerIdHash", partnerIdHash)
        proof.putString("canonicalManifestJson", canonicalManifestJson)
        proof.putString("metadataJson", metadataJson)
        proof.putString("cameraEvidenceJson", cameraEvidenceJson)
        proof.putString("deviceIntegrityJson", deviceEvidenceJson)
        proof.putString("photoBytesBase64", Base64.encodeToString(imageBytes, Base64.NO_WRAP))
        proof.putString("captureSessionId", safeCaptureSessionId)
        proof.putString("nonce", nonce)
        proof.putString("appIdentityHash", safeAppIdentityHash)
        proof.putString("proofLevel", "app_capture")
        proof.putString("capturedAt", Instant.ofEpochMilli(safeCapturedAtMs).toString())
        proof.putString("partnerId", safePartnerId)
        proof.putString("useCase", safeUseCase)
        proof.putString("verificationUrl", "https://verify.argus.dev/proof/$proofId")
        // kr: registry proofLevel은 app_capture로 유지합니다. Level 4 material은 device evidence에 보존하지만 trusted root 검증 전에는 Level 4로 확정하지 않습니다.
        // en: Keep the registry proofLevel as app_capture. Preserve Level 4 material in device evidence, but do not finalize Level 4 before trusted-root validation.
        proof.putString("integrityLevel", "app_capture")
        proof.putMap("deviceEvidenceSummary", evidenceSummary)
        return proof
    }

    // kr: buildCanonicalManifestJson은 Rust canonical manifest와 같은 key 순서를 사용합니다.
    // en: buildCanonicalManifestJson uses the same key order as the Rust canonical manifest.
    private fun buildCanonicalManifestJson(
        partnerIdHash: String,
        useCase: String,
        captureSessionId: String,
        capturedAtMs: Long,
        imageHash: String,
        metadataCommitment: String,
        cameraEvidenceCommitment: String,
        deviceIntegrityCommitment: String,
        appIdentityHash: String,
        nonce: String,
    ): String {
        return "{" +
            "\"schema_version\":\"argus.manifest.v1\"," +
            "\"partner_id_hash\":\"$partnerIdHash\"," +
            "\"use_case\":\"${escapeJson(useCase)}\"," +
            "\"capture_session_id\":\"${escapeJson(captureSessionId)}\"," +
            "\"captured_at_ms\":$capturedAtMs," +
            "\"image_sha256\":\"$imageHash\"," +
            "\"metadata_commitment\":\"$metadataCommitment\"," +
            "\"camera_evidence_commitment\":\"$cameraEvidenceCommitment\"," +
            "\"device_integrity_commitment\":\"$deviceIntegrityCommitment\"," +
            "\"app_identity_hash\":\"$appIdentityHash\"," +
            "\"nonce\":\"$nonce\"," +
            "\"proof_level\":\"app_capture\"" +
            "}"
    }

    // kr: deriveProofId는 Rust core의 derive_proof_id와 같은 byte 연결 규칙을 사용합니다.
    // en: deriveProofId uses the same byte-concatenation rule as Rust core derive_proof_id.
    private fun deriveProofId(manifestHash: String, imageHash: String, nonce: String): String {
        val prefix = "argus-proof-v1".toByteArray()
        val bytes = prefix + hexToBytes(manifestHash) + hexToBytes(imageHash) + hexToBytes(nonce)
        return sha256Hex(bytes)
    }

    private fun normalizeNonce(value: String?): String {
        if (value.isNullOrBlank()) {
            throw IllegalArgumentException("sessionNonce is required for app_capture")
        }

        val trimmed = value.trim()
        if (!isHex32(trimmed)) {
            throw IllegalArgumentException("sessionNonce must be a non-zero 32-byte hex string")
        }

        return trimmed.lowercase()
    }

    private fun evidenceLevel(keystoreValidation: ArgusKeystoreEvidence.KeystoreValidation): String {
        return when {
            keystoreValidation.attestationPresent -> "level_4_hardware_attestation"
            keystoreValidation.signaturePresent -> "level_3_keystore_signature"
            else -> EVIDENCE_LEVEL_NATIVE_CAPTURE
        }
    }

    private fun attestationStatus(keystoreValidation: ArgusKeystoreEvidence.KeystoreValidation): String {
        return when {
            keystoreValidation.attestationPresent -> "level_4_attestation_present"
            keystoreValidation.attestationMaterialPresent -> "level_4_material_present_pending_relayer_root_validation"
            keystoreValidation.signaturePresent -> "level_4_unsupported_fell_back_to_level_3"
            else -> ATTESTATION_FALLBACK_STATUS
        }
    }

    private fun stringArray(values: List<String>): WritableArray {
        val array = Arguments.createArray()
        values.forEach { value -> array.pushString(value) }
        return array
    }

    private fun normalizeAppIdentityHash(value: String): String {
        val trimmed = value.trim()
        if (!isHex32(trimmed)) {
            throw IllegalArgumentException("appIdentityHash must be a non-zero 32-byte hex string")
        }

        return trimmed.lowercase()
    }

    private fun isHex32(value: String): Boolean {
        return Regex("^[0-9a-fA-F]{64}$").matches(value) && !Regex("^0{64}$").matches(value)
    }

    private fun hexToBytes(hex: String): ByteArray {
        val output = ByteArray(hex.length / 2)
        for (index in output.indices) {
            output[index] = hex.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
        return output
    }

    private fun escapeJson(value: String): String {
        val escaped = StringBuilder()
        for (character in value) {
            when (character) {
                '"' -> escaped.append("\\\"")
                '\\' -> escaped.append("\\\\")
                '\b' -> escaped.append("\\b")
                '\u000c' -> escaped.append("\\f")
                '\n' -> escaped.append("\\n")
                '\r' -> escaped.append("\\r")
                '\t' -> escaped.append("\\t")
                in '\u0000'..'\u001f' -> escaped.append("\\u")
                    .append(character.code.toString(16).padStart(4, '0'))
                else -> escaped.append(character)
            }
        }

        return escaped.toString()
    }

    // kr: sha256Hex는 Kotlin과 Rust proof 모델을 같은 SHA-256 commitment로 맞춥니다.
    // en: sha256Hex keeps Kotlin and Rust proof models aligned on SHA-256 commitments.
    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }

    companion object {
        private const val SUPPORTED_USE_CASE = "marketplace_listing"
        private const val EVIDENCE_LEVEL_NATIVE_CAPTURE = "level_2_native_capture"
        private const val ATTESTATION_FALLBACK_STATUS = "level_4_unsupported_fell_back_to_level_2"
    }
}
