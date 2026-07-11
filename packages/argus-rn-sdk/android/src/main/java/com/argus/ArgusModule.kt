package com.argus

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.lang.reflect.Array
import java.io.File
import java.math.BigDecimal

class ArgusModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var pendingPromise: Promise? = null
    private var pendingRequest: NativeCaptureRequest? = null

    private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        // kr: onActivityResult는 native camera activity가 촬영한 파일 경로를 받아 proof 생성을 마무리합니다.
        // en: onActivityResult receives the native camera file path and finishes proof creation.
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?,
        ) {
            if (requestCode != ARGUS_CAPTURE_REQUEST_CODE) {
                return
            }

            val promise = pendingPromise ?: return
            val request = pendingRequest
            pendingPromise = null
            pendingRequest = null

            if (resultCode != Activity.RESULT_OK || request == null) {
                promise.reject("ARGUS_CAPTURE_CANCELLED", "Verified capture was cancelled")
                return
            }

            val resultData = data
            if (resultData == null) {
                promise.reject("ARGUS_CAPTURE_MISSING_FILE", "Native camera did not return a capture path")
                return
            }

            val capturePath = resultData.getStringExtra(ArgusCameraActivity.EXTRA_CAPTURE_PATH)
            if (capturePath.isNullOrBlank()) {
                promise.reject("ARGUS_CAPTURE_MISSING_FILE", "Native camera did not return a capture path")
                return
            }

            var captureFileForCleanup: File? = null
            try {
                val evidenceCollector = ArgusEvidenceCollector(reactContext)
                val captureFile = File(capturePath)
                val capturedAtMs = resultData.getLongExtra(ArgusCameraActivity.EXTRA_CAPTURED_AT_MS, 0L)
                if (capturedAtMs <= 0L) {
                    promise.reject("ARGUS_CAPTURE_TIMESTAMP_MISSING", "Native camera did not return a capture timestamp")
                    return
                }

                // kr: result path는 Intent extra이므로 file metadata를 믿기 전에 canonical cache/name/mtime/size 정책을 먼저 적용합니다.
                // en: The result path comes from an Intent extra, so apply canonical cache/name/mtime/size policy before trusting file metadata.
                val allowedCaptureFile =
                    ArgusCaptureFilePolicy.allowedCaptureFile(captureFile, reactContext.cacheDir, capturedAtMs)
                if (allowedCaptureFile == null) {
                    promise.reject("ARGUS_CAPTURE_FILE_UNTRUSTED", "Native camera returned an untrusted capture file")
                    return
                }
                captureFileForCleanup = allowedCaptureFile

                val imageBytes = ArgusCaptureFilePolicy.readBytesWithinNativeCaptureLimit(
                    allowedCaptureFile,
                    reactContext.cacheDir,
                    capturedAtMs,
                )
                if (imageBytes == null) {
                    promise.reject("ARGUS_CAPTURE_FILE_UNTRUSTED", "Native camera returned an untrusted capture file")
                    return
                }

                // kr: CameraActivity가 저장 직후 기록한 byte binding과 비교해 result path 교체를 막습니다.
                // en: Compare against the byte binding recorded just after save to block result-path replacement.
                val expectedCaptureFileBytes =
                    resultData.getLongExtra(ArgusCameraActivity.EXTRA_CAPTURE_FILE_BYTES, 0L)
                val expectedCaptureBytesSha256 =
                    resultData.getStringExtra(ArgusCameraActivity.EXTRA_CAPTURE_BYTES_SHA256)
                if (
                    !ArgusImageBytesPolicy.matchesNativeCaptureBinding(
                        imageBytes,
                        expectedCaptureFileBytes,
                        expectedCaptureBytesSha256,
                    )
                ) {
                    promise.reject("ARGUS_CAPTURE_BYTES_CHANGED", "Native camera capture bytes changed before proof creation")
                    return
                }

                val motionSnapshotFromCapture = motionSnapshotFromCaptureResult(resultData)
                // kr: Camera evidence timing은 검증된 bytes 직후에 찍어 app identity 조회 시간이 freshness delay에 섞이지 않게 합니다.
                // en: Record camera evidence timing right after validated bytes so app-identity lookup time does not inflate freshness delay.
                val cameraEvidence =
                    evidenceCollector.collectCameraEvidence(
                        capturedAtMs,
                        imageBytes.size.toLong(),
                    )
                val appIdentityHash = normalizeHashHex(evidenceCollector.collectAppIdentityHash())

                if (appIdentityHash == null) {
                    promise.reject("ARGUS_APP_IDENTITY_UNAVAILABLE", "Android app signing digest is unavailable")
                    return
                }

                if (!request.appIdentityHash.isNullOrBlank() && request.appIdentityHash != appIdentityHash) {
                    promise.reject("ARGUS_APP_IDENTITY_MISMATCH", "Relayer session app identity does not match this app")
                    return
                }

                val sessionNonce = normalizeHashHex(request.sessionNonce)
                if (sessionNonce == null) {
                    promise.reject("ARGUS_CAPTURE_SESSION_REQUIRED", "app_capture requires a non-zero 32-byte sessionNonce")
                    return
                }

                val playIntegrityToken = request.playIntegrityToken?.trim()?.takeIf { it.isNotEmpty() }
                val playIntegrityTokenHash = playIntegrityToken?.let {
                    ArgusKeystoreEvidence.sha256HexForBinding(it)
                }

                val cameraEvidenceJson = canonicalJson(cameraEvidence)
                // kr: Keystore 서명은 검증된 native bytes와 evidence commitment를 앱 private key로 묶습니다.
                // en: The Keystore signature binds validated native bytes and evidence commitments with an app-private key.
                // kr: collector는 relayer/verifier가 확인할 public key/payload 형식이 있을 때만 Level 3/4로 올리고, 아니면 Level 2 fallback을 명시합니다.
                // en: The collector promotes to Level 3/4 only with relayer/verifier-checkable public-key/payload material; otherwise it records an explicit Level 2 fallback.
                val keystoreEvidence = ArgusKeystoreEvidence.collectKeystoreEvidence(
                    reactContext,
                    ArgusKeystoreEvidence.ProofBindingInput(
                        partnerId = request.partnerId,
                        useCase = request.useCase,
                        metadataJson = request.metadataJson,
                        cameraEvidenceJson = cameraEvidenceJson,
                        appIdentityHash = appIdentityHash,
                        captureSessionId = request.captureSessionId ?: "",
                        sessionNonce = sessionNonce,
                        capturedAtMs = capturedAtMs,
                        imageBytes = imageBytes,
                        playIntegrityTokenHash = playIntegrityTokenHash,
                    ),
                )
                val deviceEvidence = evidenceCollector.collectDeviceEvidence(
                    motionSnapshot = motionSnapshotFromCapture,
                    keystoreEvidence = keystoreEvidence,
                    appIdentityHash = appIdentityHash,
                    playIntegrityToken = playIntegrityToken,
                )
                val deviceEvidenceJson = canonicalJson(deviceEvidence)

                val rustBridge = ArgusRustBridge()
                val proof = rustBridge.createProof(
                    partnerId = request.partnerId,
                    useCase = request.useCase,
                    metadataJson = request.metadataJson,
                    cameraEvidenceJson = cameraEvidenceJson,
                    deviceEvidenceJson = deviceEvidenceJson,
                    appIdentityHash = appIdentityHash,
                    captureSessionId = request.captureSessionId,
                    sessionNonce = sessionNonce,
                    capturedAtMs = capturedAtMs,
                    imageBytes = imageBytes,
                    playIntegrityTokenHash = playIntegrityTokenHash,
                )

                promise.resolve(proof)
            } catch (error: Exception) {
                promise.reject("ARGUS_PROOF_FAILED", error.message, error)
            } finally {
                captureFileForCleanup?.let { file ->
                    ArgusCaptureFilePolicy.deleteCreatedCaptureFile(file, reactContext.cacheDir)
                }
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName(): String {
        return "Argus"
    }

    // kr: createCaptureProof는 React Native SDK에서 호출되어 gallery picker 없이 native verified capture를 시작합니다.
    // en: createCaptureProof is called by the React Native SDK to start native verified capture without a gallery picker.
    // kr: relayer nonce와 app identity hash가 없으면 production app_capture로 올리지 않고 실패합니다.
    // en: Without a relayer nonce and app identity hash, this fails instead of minting a production app_capture proof.
    @ReactMethod
    fun createCaptureProof(options: ReadableMap, promise: Promise) {
        try {
            if (pendingPromise != null) {
                promise.reject("ARGUS_CAPTURE_BUSY", "Another Argus capture is already running")
                return
            }

            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.reject("ARGUS_NO_ACTIVITY", "Argus requires an active Android Activity")
                return
            }

            val partnerId = options.getString("partnerId") ?: ""
            val useCase = options.getString("useCase") ?: ""
            val metadata = options.getMap("metadata")
            val captureSessionId = optionalString(options, "captureSessionId")
            val sessionNonce = optionalString(options, "sessionNonce")
            val appIdentityHash = normalizeHashHex(optionalString(options, "appIdentityHash"))
            val playIntegrityToken = optionalString(options, "playIntegrityToken")?.trim()?.takeIf { it.isNotEmpty() }

            if (partnerId.isBlank() || useCase.isBlank()) {
                promise.reject("ARGUS_INVALID_OPTIONS", "partnerId and useCase are required")
                return
            }

            if (useCase.trim() != SUPPORTED_USE_CASE) {
                promise.reject("ARGUS_UNSUPPORTED_USE_CASE", "useCase is not supported by the registry")
                return
            }

            if (captureSessionId.isNullOrBlank() || sessionNonce.isNullOrBlank() || appIdentityHash == null) {
                promise.reject(
                    "ARGUS_CAPTURE_SESSION_REQUIRED",
                    "app_capture requires a relayer captureSessionId, sessionNonce, and 32-byte appIdentityHash",
                )
                return
            }

            val metadataJson = canonicalJson(metadata?.toHashMap() ?: emptyMap<String, Any?>())
            ArgusProofTextPolicy.requireWithinLimit(
                "metadataJson",
                metadataJson,
                ArgusProofTextPolicy.MAX_METADATA_JSON_BYTES,
            )
            playIntegrityToken?.let {
                ArgusProofTextPolicy.requireWithinLimit(
                    "playIntegrityToken",
                    it,
                    24 * 1024,
                )
            }

            pendingPromise = promise
            pendingRequest = NativeCaptureRequest(
                partnerId = partnerId.trim(),
                useCase = useCase.trim(),
                metadataJson = metadataJson,
                captureSessionId = captureSessionId.trim(),
                sessionNonce = sessionNonce.trim(),
                appIdentityHash = appIdentityHash.trim(),
                playIntegrityToken = playIntegrityToken,
            )

            val intent = Intent(activity, ArgusCameraActivity::class.java).apply {
                putExtra(ArgusCameraActivity.EXTRA_PARTNER_ID, partnerId)
                putExtra(ArgusCameraActivity.EXTRA_USE_CASE, useCase)
            }
            activity.startActivityForResult(intent, ARGUS_CAPTURE_REQUEST_CODE)
        } catch (error: Exception) {
            pendingPromise = null
            pendingRequest = null
            promise.reject("ARGUS_CAPTURE_FAILED", error.message, error)
        }
    }

    private fun optionalString(options: ReadableMap, key: String): String? {
        return if (options.hasKey(key)) options.getString(key) else null
    }

    private fun normalizeHashHex(value: String?): String? {
        val trimmed = value?.trim() ?: return null
        if (!Regex("^[0-9a-fA-F]{64}$").matches(trimmed) || Regex("^0{64}$").matches(trimmed)) {
            return null
        }

        return trimmed.lowercase()
    }

    private fun motionSnapshotFromCaptureResult(data: Intent): Map<String, Any> {
        return mapOf(
            "available" to data.getBooleanExtra(ArgusCameraActivity.EXTRA_MOTION_AVAILABLE, false),
            "accelerometerAvailable" to data.getBooleanExtra(
                ArgusCameraActivity.EXTRA_ACCELEROMETER_AVAILABLE,
                false,
            ),
            "gyroscopeAvailable" to data.getBooleanExtra(
                ArgusCameraActivity.EXTRA_GYROSCOPE_AVAILABLE,
                false,
            ),
            "accelerometer" to (data.getFloatArrayExtra(ArgusCameraActivity.EXTRA_ACCELEROMETER)?.toList()
                ?: emptyList<Float>()),
            "gyroscope" to (data.getFloatArrayExtra(ArgusCameraActivity.EXTRA_GYROSCOPE)?.toList()
                ?: emptyList<Float>()),
            "sampledAtMs" to data.getLongExtra(ArgusCameraActivity.EXTRA_MOTION_SAMPLED_AT_MS, 0L),
            "sampleWindowMs" to data.getLongExtra(ArgusCameraActivity.EXTRA_MOTION_SAMPLE_WINDOW_MS, 0L),
        )
    }

    private fun canonicalJson(value: Any?): String {
        return when (value) {
            null -> "null"
            is String -> quoteJson(value)
            is Boolean -> value.toString()
            is Number -> canonicalNumber(value)
            is Map<*, *> -> value.entries
                .sortedBy { it.key.toString() }
                .joinToString(separator = ",", prefix = "{", postfix = "}") { entry ->
                    "${quoteJson(entry.key.toString())}:${canonicalJson(entry.value)}"
                }
            is Iterable<*> -> value.joinToString(separator = ",", prefix = "[", postfix = "]") { item ->
                canonicalJson(item)
            }
            else -> {
                if (value.javaClass.isArray) {
                    (0 until Array.getLength(value)).joinToString(separator = ",", prefix = "[", postfix = "]") { index ->
                        canonicalJson(Array.get(value, index))
                    }
                } else {
                    quoteJson(value.toString())
                }
            }
        }
    }

    private fun canonicalNumber(value: Number): String {
        return when (value) {
            is Double -> canonicalFloatingNumber(value, value.toString())
            is Float -> canonicalFloatingNumber(value.toDouble(), value.toString())
            else -> value.toString()
        }
    }

    private fun canonicalFloatingNumber(value: Double, decimalText: String): String {
        if (!value.isFinite()) {
            throw IllegalArgumentException("canonical JSON numbers must be finite")
        }

        if (value == 0.0) {
            return "0"
        }

        val decimal = BigDecimal(decimalText).stripTrailingZeros()
        val absolute = decimal.abs()
        if (absolute >= JS_DECIMAL_MIN && absolute < JS_EXPONENTIAL_MIN) {
            return decimal.toPlainString()
        }

        return canonicalExponentialNumber(decimal)
    }

    private fun canonicalExponentialNumber(value: BigDecimal): String {
        val decimal = value.stripTrailingZeros()
        val digits = decimal.unscaledValue().abs().toString()
        val exponent = digits.length - decimal.scale() - 1
        val sign = if (decimal.signum() < 0) "-" else ""
        val exponentSign = if (exponent >= 0) "+" else ""
        val mantissa = if (digits.length == 1) {
            digits
        } else {
            "${digits.first()}.${digits.drop(1)}"
        }

        return "$sign$mantissa" + "e$exponentSign$exponent"
    }

    private fun quoteJson(value: String): String {
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

        return "\"$escaped\""
    }

    // kr: getAppIdentityHash는 JS SDK가 relayer nonce 세션을 열기 전에 앱 서명 digest를 가져오게 합니다.
    // en: getAppIdentityHash lets the JS SDK fetch the app signing digest before opening a relayer nonce session.
    @ReactMethod
    fun getAppIdentityHash(promise: Promise) {
        try {
            val appIdentityHash = ArgusEvidenceCollector(reactContext).collectAppIdentityHash()
            if (appIdentityHash.isBlank() || appIdentityHash == "unavailable") {
                promise.reject("ARGUS_APP_IDENTITY_UNAVAILABLE", "Android app signing digest is unavailable")
                return
            }

            promise.resolve(appIdentityHash)
        } catch (error: Exception) {
            promise.reject("ARGUS_APP_IDENTITY_FAILED", error.message, error)
        }
    }

    private data class NativeCaptureRequest(
        val partnerId: String,
        val useCase: String,
        val metadataJson: String,
        val captureSessionId: String?,
        val sessionNonce: String?,
        val appIdentityHash: String?,
        val playIntegrityToken: String?,
    )

    companion object {
        private const val ARGUS_CAPTURE_REQUEST_CODE = 9107
        private const val SUPPORTED_USE_CASE = "marketplace_listing"
        private val JS_DECIMAL_MIN = BigDecimal("0.000001")
        private val JS_EXPONENTIAL_MIN = BigDecimal("1000000000000000000000")
    }
}
