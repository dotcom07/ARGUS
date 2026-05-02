package com.argus

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ArgusEvidenceCollector(private val context: Context) {

    // kr: collectCameraEvidence는 native capture flow에서 확인한 camera evidence 요약을 만듭니다.
    // en: collectCameraEvidence builds a camera evidence summary from the native capture flow.
    // kr: raw cache path는 evidence에 넣지 않고, 검증된 bytes 길이와 capture timing만 proof에 묶습니다.
    // en: Raw cache paths stay out of evidence; only validated byte length and capture timing are bound into the proof.
    // kr: capturedFileBytes는 File.length()를 다시 믿지 말고 검증된 imageBytes.size를 전달해야 합니다.
    // en: capturedFileBytes must come from the validated imageBytes.size, not from trusting File.length() again.
    fun collectCameraEvidence(
        capturedAtMs: Long,
        capturedFileBytes: Long,
    ): Map<String, Any> {
        val collectedAtMs = System.currentTimeMillis()

        return mapOf(
            "cameraMetadata" to true,
            "lensFacing" to "back",
            "noGalleryImport" to true,
            "captureSurface" to "native_android_camera",
            "capturedFileBytes" to capturedFileBytes,
            "capturedAtMs" to capturedAtMs,
            "collectedAtMs" to collectedAtMs,
            "captureEvidenceDelayMs" to (collectedAtMs - capturedAtMs).coerceAtLeast(0L),
            "capturePathHashOnly" to true,
        )
    }

    // kr: collectDeviceEvidence는 motion/app identity와 Keystore signature/attestation 결과를 proof에 묶습니다.
    // en: collectDeviceEvidence binds motion/app identity plus Keystore signature/attestation results into the proof.
    // kr: Keystore evidence는 앱 private key가 proof 입력을 서명한 것이며 camera sensor가 scene bytes를 서명했다는 뜻은 아닙니다.
    // en: Keystore evidence means an app-private key signed proof inputs; it does not mean a camera sensor signed scene bytes.
    fun collectDeviceEvidence(
        motionSnapshot: Map<String, Any> = collectMotionSnapshot(),
        keystoreEvidence: Map<String, Any> = levelTwoKeystoreFallback("keystore_evidence_not_requested"),
        appIdentityHash: String = collectAppIdentityHash(),
    ): Map<String, Any> {
        // kr: native helper가 local-only signature를 만들 수 있어도, relayer/verifier가 검증할 payload/public key shape가 아니면 Level 2로 낮춥니다.
        // en: Even if the native helper made a local-only signature, downgrade to Level 2 unless it has the payload/public-key shape the relayer/verifier can check.
        val level3VerifierEvidence = isVerifierCompatibleLevel3Evidence(keystoreEvidence)
        val level4MaterialEvidence = level3VerifierEvidence && hasVerifierCompatibleLevel4Material(keystoreEvidence)
        val resolvedLevel = when {
            level3VerifierEvidence -> 3
            else -> 2
        }
        val attestation = keystoreEvidence["attestation"] as? Map<*, *>
        // kr: Keystore helper는 attestation material을 attestation 아래에 싣습니다. trusted root 검증은 relayer가 ARGUS_ANDROID_ATTESTATION_ROOT_SHA256로 수행합니다.
        // en: The Keystore helper carries attestation material under attestation. The relayer validates the trusted root with ARGUS_ANDROID_ATTESTATION_ROOT_SHA256.
        val hardwareAttestationInput = (keystoreEvidence["hardwareAttestation"] as? Map<*, *>) ?: attestation
        val attestationChainBase64 = if (level4MaterialEvidence) {
            val attestationChain = (attestation?.get("certificateChainBase64") as? List<*>)?.filterIsInstance<String>().orEmpty()
            val hardwareChain = (hardwareAttestationInput?.get("certificateChainBase64") as? List<*>)?.filterIsInstance<String>().orEmpty()
            attestationChain.ifEmpty { hardwareChain }
        } else {
            emptyList()
        }
        val attestationChainPem = if (level4MaterialEvidence) {
            val hardwareChain = (hardwareAttestationInput?.get("certificateChainPem") as? List<*>)?.filterIsInstance<String>().orEmpty()
            val attestationChain = (attestation?.get("certificateChainPem") as? List<*>)?.filterIsInstance<String>().orEmpty()
            hardwareChain.ifEmpty { attestationChain }
        } else {
            emptyList()
        }
        val publicKeyPem = if (level3VerifierEvidence) keystoreEvidence["publicKeyPem"] as? String ?: "" else ""
        val attestationChallengeHex =
            (hardwareAttestationInput?.get("attestationChallengeHex") as? String)?.takeIf { it.trim().isNotEmpty() }
                ?: (attestation?.get("attestationChallengeHex") as? String)?.takeIf { it.trim().isNotEmpty() }
                ?: ""
        // kr: supported=false는 Android가 Level 4를 승인하지 않는다는 뜻입니다. chain/challenge는 relayer 검증을 위해 그대로 보존합니다.
        // en: supported=false means Android is not approving Level 4. The chain/challenge material is still preserved for relayer validation.
        val hardwareAttestation = if (level4MaterialEvidence) {
            mapOf(
                "supported" to false,
                "hardwareBacked" to true,
                "rootValidated" to false,
                "fallbackLevel" to 3,
                "reason" to "attestation_root_validation_required",
                "attestationChallengeHex" to attestationChallengeHex,
                "publicKeyPem" to publicKeyPem,
                "certificateChainBase64" to attestationChainBase64,
                "certificateChainPem" to attestationChainPem,
            )
        } else {
            mapOf(
                "supported" to false,
                "fallbackLevel" to resolvedLevel,
                "reason" to hardwareFallbackReason(),
            )
        }
        val keystoreSignatureEvidence: Any = if (level3VerifierEvidence) keystoreEvidence else false

        return mapOf(
            "androidEvidenceLevel" to resolvedLevel,
            "attestationCertificateChainBase64" to attestationChainBase64,
            "attestationCertificateChainPem" to attestationChainPem,
            "attestationStatus" to if (level4MaterialEvidence) {
                "level_4_material_present_pending_relayer_root_validation"
            } else {
                attestationStatus(resolvedLevel)
            },
            "evidenceLevel" to evidenceLevel(resolvedLevel),
            "hardwareAttestation" to hardwareAttestation,
            "level3KeystoreSignature" to level3VerifierEvidence,
            "level4AttestationMaterial" to level4MaterialEvidence,
            "level4HardwareAttestation" to false,
            "keystorePublicKeyPem" to publicKeyPem,
            "keystorePublicKeySpkiBase64" to if (level3VerifierEvidence) {
                keystoreEvidence["publicKeySpkiBase64"] ?: ""
            } else {
                ""
            },
            "keystoreSignature" to keystoreSignatureEvidence,
            "motionSnapshot" to motionSnapshot,
            "appPackageName" to context.packageName,
            "appIdentityHash" to appIdentityHash,
            "appIdentityHashPresent" to (appIdentityHash != "unavailable"),
            "androidSdk" to Build.VERSION.SDK_INT,
        )
    }

    // kr: collectAppIdentityHash는 relayer 세션과 proof manifest가 같은 앱 서명 digest를 쓰게 합니다.
    // en: collectAppIdentityHash lets the relayer session and proof manifest use the same app signing digest.
    fun collectAppIdentityHash(): String {
        return collectSigningCertificateDigest()
    }

    // kr: collectSigningCertificateDigest는 partner app signing certificate의 SHA-256 digest를 수집합니다.
    // en: collectSigningCertificateDigest collects the SHA-256 digest of the partner app signing certificate.
    private fun collectSigningCertificateDigest(): String {
        return try {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES,
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
            }

            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners?.toList()
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures?.toList()
            } ?: return "unavailable"

            val digests = signatures
                .map { signature -> sha256Hex(signature.toByteArray()) }
                .sorted()

            if (digests.isEmpty()) {
                return "unavailable"
            }

            if (digests.size == 1) {
                return digests.first()
            }

            sha256Hex(digests.joinToString(":").toByteArray())
        } catch (error: Exception) {
            "unavailable"
        }
    }

    // kr: collectMotionSnapshot은 셔터 근처의 accelerometer/gyroscope 샘플을 짧게 수집합니다.
    // en: collectMotionSnapshot briefly collects accelerometer/gyroscope samples near shutter time.
    fun collectMotionSnapshot(): Map<String, Any> {
        val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            ?: return mapOf("available" to false)
        val latch = CountDownLatch(2)
        val values = mutableMapOf<String, List<Float>>()
        val handlerThread = HandlerThread("ArgusMotionEvidence")

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val key = when (event.sensor.type) {
                    Sensor.TYPE_ACCELEROMETER -> "accelerometer"
                    Sensor.TYPE_GYROSCOPE -> "gyroscope"
                    else -> return
                }

                synchronized(values) {
                    if (!values.containsKey(key)) {
                        values[key] = event.values.take(3)
                        latch.countDown()
                    }
                }
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }

        val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyroscope = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)

        handlerThread.start()
        val handler = Handler(handlerThread.looper)
        try {
            if (accelerometer != null) {
                sensorManager.registerListener(listener, accelerometer, SensorManager.SENSOR_DELAY_NORMAL, handler)
            }
            if (gyroscope != null) {
                sensorManager.registerListener(listener, gyroscope, SensorManager.SENSOR_DELAY_NORMAL, handler)
            }

            latch.await(MOTION_SAMPLE_WINDOW_MS, TimeUnit.MILLISECONDS)
        } finally {
            sensorManager.unregisterListener(listener)
            handlerThread.quitSafely()
        }

        val accelerometerValues = synchronized(values) {
            values["accelerometer"] ?: emptyList<Float>()
        }
        val gyroscopeValues = synchronized(values) {
            values["gyroscope"] ?: emptyList<Float>()
        }
        val hasAccelerometer = accelerometerValues.isNotEmpty()
        val hasGyroscope = gyroscopeValues.isNotEmpty()

        return mapOf(
            "available" to (hasAccelerometer && hasGyroscope),
            "accelerometerAvailable" to hasAccelerometer,
            "gyroscopeAvailable" to hasGyroscope,
            "accelerometer" to accelerometerValues,
            "gyroscope" to gyroscopeValues,
            "sampledAtMs" to System.currentTimeMillis(),
            "sampleWindowMs" to MOTION_SAMPLE_WINDOW_MS,
        )
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { byte -> "%02x".format(byte) }
    }

    companion object {
        private const val MOTION_SAMPLE_WINDOW_MS = 180L

        private fun levelTwoKeystoreFallback(reason: String): Map<String, Any> {
            return mapOf(
                "available" to false,
                "level" to 2,
                "securityLevel" to "none",
                "fallbackReason" to reason,
            )
        }

        internal fun isVerifierCompatibleLevel3Evidence(keystoreEvidence: Map<String, Any>): Boolean {
            return keystoreEvidence["available"] == true &&
                (keystoreEvidence["level"] as? Int ?: 0) >= 3 &&
                keystoreEvidence["algorithm"] == "SHA256withECDSA" &&
                keystoreEvidence["bindingFormat"] == "argus.keystore.binding.v1" &&
                isNonBlankString(keystoreEvidence["bindingSha256"]) &&
                isNonBlankString(keystoreEvidence["publicKeyPem"]) &&
                isNonBlankString(keystoreEvidence["publicKeySpkiBase64"]) &&
                isNonBlankString(keystoreEvidence["signatureBase64"]) &&
                isNonBlankString(keystoreEvidence["signedPayloadJson"])
        }

        internal fun hasVerifierCompatibleLevel4Material(keystoreEvidence: Map<String, Any>): Boolean {
            val hardwareAttestation = (keystoreEvidence["hardwareAttestation"] as? Map<*, *>)
                ?: (keystoreEvidence["attestation"] as? Map<*, *>)
                ?: return false
            return (keystoreEvidence["level4AttestationMaterial"] == true || hardwareAttestation["available"] == true) &&
                hardwareAttestation["hardwareBacked"] == true &&
                hardwareAttestation["publicKeyPem"] == keystoreEvidence["publicKeyPem"] &&
                isNonBlankString(hardwareAttestation["attestationChallengeHex"]) &&
                ((hardwareAttestation["certificateChainPem"] as? List<*>)?.any { isNonBlankString(it) } == true)
        }

        private fun evidenceLevel(keystoreLevel: Int): String {
            return when {
                keystoreLevel >= 3 -> "level_3_keystore_signature"
                else -> "level_2_native_capture"
            }
        }

        private fun attestationStatus(keystoreLevel: Int): String {
            return when {
                keystoreLevel >= 3 -> "level_4_unsupported_fell_back_to_level_3"
                else -> "level_4_unsupported_fell_back_to_level_2"
            }
        }

        private fun hardwareFallbackReason(): String {
            return "android_key_attestation_unavailable"
        }

        private fun isNonBlankString(value: Any?): Boolean {
            return value is String && value.trim().isNotEmpty()
        }
    }
}
