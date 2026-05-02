package com.argus

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

internal data class ArgusEvidenceValidation(
    val cameraMetadataPresent: Boolean,
    val noGalleryImportPresent: Boolean,
    val nativeCaptureSurfacePresent: Boolean,
    val motionSnapshotPresent: Boolean,
    val appIdentityHashPresent: Boolean,
)

internal object ArgusEvidencePolicy {
    // kr: validateAppCaptureEvidence는 native camera/no-gallery/motion/app identity evidence가 같은 capturedAtMs에 묶였는지 확인합니다.
    // en: validateAppCaptureEvidence checks that native camera/no-gallery/motion/app identity evidence binds to the same capturedAtMs.
    // kr: 이 검증은 capture path와 evidence freshness 경계용이며 scene truth를 판단하지 않습니다.
    // en: This validates capture-path and evidence-freshness boundaries; it does not judge scene truth.
    fun validateAppCaptureEvidence(
        cameraEvidenceJson: String,
        deviceEvidenceJson: String,
        expectedAppIdentityHash: String,
        expectedCapturedFileBytes: Long,
        capturedAtMs: Long,
    ): ArgusEvidenceValidation {
        val cameraEvidence = parseJsonObject(cameraEvidenceJson, "cameraEvidenceJson")
        val deviceEvidence = parseJsonObject(deviceEvidenceJson, "deviceEvidenceJson")
        val result = ArgusEvidenceValidation(
            cameraMetadataPresent = jsonBoolean(cameraEvidence, "cameraMetadata"),
            noGalleryImportPresent = jsonBoolean(cameraEvidence, "noGalleryImport"),
            nativeCaptureSurfacePresent = jsonString(cameraEvidence, "captureSurface") == NATIVE_CAPTURE_SURFACE,
            motionSnapshotPresent = motionSnapshotIsValid(deviceEvidence, capturedAtMs),
            appIdentityHashPresent = jsonBoolean(deviceEvidence, "appIdentityHashPresent"),
        )
        val evidenceAppIdentityHash = normalizeOptionalHash(jsonString(deviceEvidence, "appIdentityHash"))
        if (
            !result.cameraMetadataPresent ||
            !result.noGalleryImportPresent ||
            !result.nativeCaptureSurfacePresent ||
            !capturedFileBytesMatches(cameraEvidence, expectedCapturedFileBytes) ||
            !cameraEvidenceIsFresh(cameraEvidence, capturedAtMs) ||
            !result.motionSnapshotPresent ||
            !result.appIdentityHashPresent ||
            evidenceAppIdentityHash != expectedAppIdentityHash
        ) {
            throw IllegalArgumentException(
                "app_capture proof requires native camera, no-gallery, motion, and matching app identity evidence",
            )
        }

        return result
    }

    private fun cameraEvidenceIsFresh(cameraEvidence: JSONObject, capturedAtMs: Long): Boolean {
        if (capturedAtMs <= 0L) {
            return false
        }

        val cameraCapturedAtMs = jsonLong(cameraEvidence, "capturedAtMs") ?: return false
        val collectedAtMs = jsonLong(cameraEvidence, "collectedAtMs") ?: return false
        val captureEvidenceDelayMs = jsonLong(cameraEvidence, "captureEvidenceDelayMs") ?: return false
        val calculatedDelayMs = collectedAtMs - capturedAtMs

        return cameraCapturedAtMs == capturedAtMs &&
            collectedAtMs > 0L &&
            captureEvidenceDelayMs >= 0L &&
            calculatedDelayMs >= 0L &&
            calculatedDelayMs == captureEvidenceDelayMs &&
            calculatedDelayMs <= MAX_CAMERA_EVIDENCE_DELAY_MS
    }

    private fun capturedFileBytesMatches(cameraEvidence: JSONObject, expectedCapturedFileBytes: Long): Boolean {
        // kr: capturedFileBytes는 evidence claim이 아니라 실제 native capture bytes와 묶인 값이어야 합니다.
        // en: capturedFileBytes must be bound to the actual native capture bytes, not treated as a standalone evidence claim.
        if (expectedCapturedFileBytes <= 0L) {
            return false
        }

        val capturedFileBytes = jsonLong(cameraEvidence, "capturedFileBytes") ?: return false
        return capturedFileBytes == expectedCapturedFileBytes
    }

    private fun parseJsonObject(json: String, label: String): JSONObject {
        ArgusProofTextPolicy.requireWithinLimit(
            label,
            json,
            ArgusProofTextPolicy.MAX_EVIDENCE_JSON_BYTES,
        )

        return try {
            val tokener = JSONTokener(json)
            val value = tokener.nextValue()
            if (value !is JSONObject || tokener.nextClean() != 0.toChar()) {
                throw IllegalArgumentException("$label must be a valid JSON object")
            }
            value
        } catch (error: Exception) {
            throw IllegalArgumentException("$label must be a valid JSON object")
        }
    }

    private fun jsonBoolean(json: JSONObject, key: String): Boolean {
        return json.opt(key) == true
    }

    private fun jsonString(json: JSONObject, key: String): String? {
        return json.opt(key) as? String
    }

    private fun motionSnapshotIsValid(deviceEvidence: JSONObject, capturedAtMs: Long): Boolean {
        if (capturedAtMs <= 0L) {
            return false
        }

        val motionSnapshot = deviceEvidence.optJSONObject("motionSnapshot") ?: return false
        val sampledAtMs = jsonLong(motionSnapshot, "sampledAtMs") ?: return false
        val sampleWindowMs = jsonLong(motionSnapshot, "sampleWindowMs") ?: return false

        return jsonBoolean(motionSnapshot, "available") &&
            jsonBoolean(motionSnapshot, "accelerometerAvailable") &&
            jsonBoolean(motionSnapshot, "gyroscopeAvailable") &&
            sampledAtMs > 0L &&
            sampleWindowMs > 0L &&
            sampleWindowMs <= MAX_MOTION_CAPTURE_DELTA_MS &&
            kotlin.math.abs(sampledAtMs - capturedAtMs) <= MAX_MOTION_CAPTURE_DELTA_MS &&
            jsonNumberArrayHasThreeFiniteValues(motionSnapshot.optJSONArray("accelerometer")) &&
            jsonNumberArrayHasThreeFiniteValues(motionSnapshot.optJSONArray("gyroscope"))
    }

    private fun jsonLong(json: JSONObject, key: String): Long? {
        val value = json.opt(key) as? Number ?: return null
        val text = value.toString()
        if (text.contains('.') || text.contains('e', ignoreCase = true)) {
            return null
        }

        return text.toLongOrNull()
    }

    private fun jsonNumberArrayHasThreeFiniteValues(value: JSONArray?): Boolean {
        if (value == null || value.length() != 3) {
            return false
        }

        for (index in 0 until value.length()) {
            val number = value.opt(index) as? Number ?: return false
            val doubleValue = number.toDouble()
            if (!doubleValue.isFinite()) {
                return false
            }
        }

        return true
    }

    private fun normalizeOptionalHash(value: String?): String? {
        val trimmed = value?.trim() ?: return null
        if (!Regex("^[0-9a-fA-F]{64}$").matches(trimmed) || Regex("^0{64}$").matches(trimmed)) {
            return null
        }

        return trimmed.lowercase()
    }

    private const val MAX_CAMERA_EVIDENCE_DELAY_MS = 5_000L
    private const val MAX_MOTION_CAPTURE_DELTA_MS = 2_000L
    private const val NATIVE_CAPTURE_SURFACE = "native_android_camera"
}
