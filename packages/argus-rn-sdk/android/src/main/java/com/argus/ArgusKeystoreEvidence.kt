package com.argus

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.security.KeyFactory
import java.util.Base64

internal object ArgusKeystoreEvidence {
    data class ProofBindingInput(
        val partnerId: String,
        val useCase: String,
        val metadataJson: String,
        val cameraEvidenceJson: String,
        val appIdentityHash: String,
        val captureSessionId: String,
        val sessionNonce: String,
        val capturedAtMs: Long,
        val imageBytes: ByteArray,
        val playIntegrityTokenHash: String? = null,
    )

    data class KeystoreValidation(
        val claimedSigned: Boolean,
        val signaturePresent: Boolean,
        val attestationMaterialPresent: Boolean,
        val attestationPresent: Boolean,
        val level: Int,
        val securityLevel: String,
        val publicKeyPem: String,
        val attestationCertificateChainPem: List<String>,
    )

    // kr: collectKeystoreEvidence는 proof binding data를 Android Keystore key로 서명하고 attestation material을 보존합니다. trusted root 검증 전에는 Level 4로 확정하지 않습니다.
    // en: collectKeystoreEvidence signs proof binding data with Android Keystore and preserves attestation material. It does not finalize Level 4 before trusted-root validation.
    fun collectKeystoreEvidence(context: Context, input: ProofBindingInput): Map<String, Any> {
        val bindingData = canonicalProofBindingData(input)
        return tryCreateKeystoreEvidence(bindingData, input.sessionNonce, preferStrongBox = true)
            ?: tryCreateKeystoreEvidence(bindingData, input.sessionNonce, preferStrongBox = false)
            ?: levelTwoFallback("android_keystore_signature_unavailable")
    }

    // kr: device evidence 자체는 서명 입력에서 제외합니다. 그래야 keystoreSignature가 자기 자신을 서명하는 순환을 만들지 않습니다.
    // en: Device evidence itself is excluded from the signed input so keystoreSignature does not create a self-referential cycle.
    fun canonicalProofBindingData(input: ProofBindingInput): String {
        val imageHash = ArgusImageBytesPolicy.sha256Hex(input.imageBytes)
        return "{" +
            "\"schema\":\"argus.keystore.binding.v1\"," +
            "\"partnerId\":\"${escapeJson(input.partnerId.trim())}\"," +
            "\"useCase\":\"${escapeJson(input.useCase.trim())}\"," +
            "\"metadataCommitment\":\"${sha256Hex(input.metadataJson.toByteArray())}\"," +
            "\"cameraEvidenceCommitment\":\"${sha256Hex(input.cameraEvidenceJson.toByteArray())}\"," +
            "\"appIdentityHash\":\"${escapeJson(input.appIdentityHash.lowercase())}\"," +
            "\"captureSessionId\":\"${escapeJson(input.captureSessionId.trim())}\"," +
            "\"sessionNonce\":\"${escapeJson(input.sessionNonce.lowercase())}\"," +
            "\"capturedAtMs\":${input.capturedAtMs}," +
            (input.playIntegrityTokenHash?.let {
                "\"playIntegrityTokenHash\":\"${escapeJson(it.lowercase())}\","
            } ?: "") +
            "\"imageHash\":\"$imageHash\"" +
            "}"
    }

    fun sha256HexForBinding(value: String): String {
        return sha256Hex(value.toByteArray())
    }

    fun validateDeviceEvidence(deviceEvidenceJson: String, bindingData: String): KeystoreValidation {
        val evidence = JSONObject(deviceEvidenceJson)
        // kr: JSON 안의 claimed level은 Android 입력일 뿐입니다. 여기서는 signature를 Level 3로 확인하고, Level 4 material은 root 검증 전까지 보존만 합니다.
        // en: The claimed level inside JSON is still Android input. This confirms signatures as Level 3 and only preserves Level 4 material until root validation.
        val keystoreSignature = evidence.optJSONObject("keystoreSignature")
            ?: return KeystoreValidation(
                claimedSigned = false,
                signaturePresent = false,
                attestationMaterialPresent = false,
                attestationPresent = false,
                level = 2,
                securityLevel = "none",
                publicKeyPem = "",
                attestationCertificateChainPem = emptyList(),
            )

        if (keystoreSignature.optBoolean("available") != true) {
            return KeystoreValidation(
                claimedSigned = false,
                signaturePresent = false,
                attestationMaterialPresent = false,
                attestationPresent = false,
                level = 2,
                securityLevel = keystoreSignature.optString("securityLevel", "none"),
                publicKeyPem = keystoreSignature.optString("publicKeyPem", ""),
                attestationCertificateChainPem = emptyList(),
            )
        }

        val signaturePresent = verifyKeystoreSignature(keystoreSignature, bindingData)
        val attestation = keystoreSignature.optJSONObject("attestation")
        val publicKeyPem = keystoreSignature.optString("publicKeyPem", "")
        val attestationMaterialPresent = signaturePresent &&
            hasVerifierCompatibleAttestation(
                attestation = attestation,
                publicKeyPem = publicKeyPem,
                bindingData = bindingData,
            )
        // kr: attestationMaterialPresent는 relayer가 검증할 chain/challenge가 있다는 뜻이고, attestationPresent는 trusted root 검증 전까지 false로 둡니다.
        // en: attestationMaterialPresent means the relayer has chain/challenge material to verify; attestationPresent stays false until trusted-root validation.
        val attestationPresent = false
        val resolvedLevel = when {
            signaturePresent -> 3
            else -> 2
        }
        val resolvedSecurityLevel = when {
            attestationMaterialPresent -> "keystore_signature_attestation_material_root_unverified"
            signaturePresent -> "keystore_signature"
            else -> "none"
        }

        return KeystoreValidation(
            claimedSigned = true,
            signaturePresent = signaturePresent,
            attestationMaterialPresent = attestationMaterialPresent,
            attestationPresent = attestationPresent,
            level = resolvedLevel,
            securityLevel = resolvedSecurityLevel,
            publicKeyPem = publicKeyPem,
            attestationCertificateChainPem = jsonStringArray(attestation?.optJSONArray("certificateChainPem")),
        )
    }

    private fun tryCreateKeystoreEvidence(
        bindingData: String,
        sessionNonce: String,
        preferStrongBox: Boolean,
    ): Map<String, Any>? {
        return try {
            val requestedSecurityLevel = if (preferStrongBox) "strongbox" else "tee_or_keystore"
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            val alias = "argus_proof_${if (preferStrongBox) "strongbox" else "keystore"}_${sha256Hex(bindingData.toByteArray()).take(32)}"
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }

            val generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                ANDROID_KEYSTORE,
            )
            val builder = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec(EC_CURVE))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(hexToBytes(sessionNonce))

            if (preferStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                builder.setIsStrongBoxBacked(true)
            }

            generator.initialize(builder.build())
            generator.generateKeyPair()

            val privateKey = keyStore.getKey(alias, null) as? PrivateKey ?: return null
            val certificateChain = keyStore.getCertificateChain(alias)?.toList().orEmpty()
            val publicKeyBytes = certificateChain.firstOrNull()?.publicKey?.encoded
                ?: keyStore.getCertificate(alias)?.publicKey?.encoded
                ?: return null
            val publicKeyPem = pemBlock("PUBLIC KEY", publicKeyBytes)
            val signatureBase64 = Base64.getEncoder().encodeToString(signBinding(privateKey, bindingData))
            val certificateChainBase64 = certificateChain.map { certificate ->
                Base64.getEncoder().encodeToString(certificate.encoded)
            }
            val certificateChainPem = certificateChain.map { certificate ->
                pemBlock("CERTIFICATE", certificate.encoded)
            }
            val certificateChainSha256 = certificateChain.map { certificate ->
                sha256Hex(certificate.encoded)
            }
            val hasAttestationChain = certificateChainBase64.size > 1
            val fallbackReason = if (hasAttestationChain) {
                "level4_root_validation_required"
            } else {
                "level4_unavailable"
            }

            mapOf(
                "available" to true,
                "level" to 3,
                "algorithm" to "SHA256withECDSA",
                "bindingFormat" to "argus.keystore.binding.v1",
                "bindingSha256" to sha256Hex(bindingData.toByteArray()),
                "publicKeyAlgorithm" to "EC",
                "publicKeyPem" to publicKeyPem,
                "publicKeySpkiBase64" to Base64.getEncoder().encodeToString(publicKeyBytes),
                "signatureBase64" to signatureBase64,
                "signedPayloadJson" to bindingData,
                "requestedSecurityLevel" to requestedSecurityLevel,
                "securityLevel" to if (hasAttestationChain) {
                    "keystore_signature_attestation_material_root_unverified"
                } else "keystore_signature",
                "level4AttestationMaterial" to hasAttestationChain,
                "fallbackReason" to fallbackReason,
                "attestation" to mapOf(
                    "requested" to true,
                    "available" to hasAttestationChain,
                    "rootValidated" to false,
                    "attestationChallengeHex" to sessionNonce,
                    "challengeSha256" to sha256Hex(hexToBytes(sessionNonce)),
                    "certificateChainBase64" to certificateChainBase64,
                    "certificateChainPem" to certificateChainPem,
                    "certificateChainSha256" to certificateChainSha256,
                    "hardwareBacked" to hasAttestationChain,
                    "publicKeyPem" to publicKeyPem,
                    "requestedSecurityLevel" to requestedSecurityLevel,
                    "securityLevel" to if (hasAttestationChain) "hardware_chain_material_root_unverified" else "unverified",
                    "fallbackReason" to fallbackReason,
                ),
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun verifyKeystoreSignature(keystoreSignature: JSONObject, bindingData: String): Boolean {
        val publicKeyPem = keystoreSignature.optString("publicKeyPem")
        val signedPayloadJson = keystoreSignature.optString("signedPayloadJson")
        if (
            keystoreSignature.optString("algorithm") != "SHA256withECDSA" ||
            keystoreSignature.optString("bindingFormat") != "argus.keystore.binding.v1" ||
            keystoreSignature.optString("bindingSha256") != sha256Hex(bindingData.toByteArray()) ||
            signedPayloadJson != bindingData ||
            publicKeyPem.isBlank()
        ) {
            return false
        }

        return try {
            val publicKeyBytes = Base64.getDecoder().decode(keystoreSignature.optString("publicKeySpkiBase64"))
            // kr: publicKeyPem/signedPayloadJson은 relayer가 다시 검증하는 material이라 Android에서 먼저 같은 값인지 확인합니다.
            // en: publicKeyPem/signedPayloadJson are re-verified by the relayer, so Android checks they describe the same binding material first.
            if (!publicKeyPemMatchesSpki(publicKeyPem, publicKeyBytes)) {
                return false
            }
            val signatureBytes = Base64.getDecoder().decode(keystoreSignature.optString("signatureBase64"))
            val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(publicKeyBytes))
            val verifier = Signature.getInstance("SHA256withECDSA")
            verifier.initVerify(publicKey)
            verifier.update(bindingData.toByteArray())
            verifier.verify(signatureBytes)
        } catch (_: Exception) {
            false
        }
    }

    private fun publicKeyPemMatchesSpki(publicKeyPem: String, publicKeyBytes: ByteArray): Boolean {
        val pemBody = publicKeyPem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .filterNot { it.isWhitespace() }
        if (pemBody.isBlank()) {
            return false
        }

        return MessageDigest.isEqual(Base64.getDecoder().decode(pemBody), publicKeyBytes)
    }

    private fun hasVerifierCompatibleAttestation(
        attestation: JSONObject?,
        publicKeyPem: String,
        bindingData: String,
    ): Boolean {
        if (attestation == null || attestation.optBoolean("available") != true) {
            return false
        }

        // kr: Android는 trusted root fingerprint를 검증하지 않습니다. 여기서는 relayer가 검증할 PEM chain, 현재 proof nonce, public key material만 보존 가능한지 확인합니다.
        // en: Android does not validate the trusted root fingerprint. Here it only checks that the PEM chain, current proof nonce, and public key material are preservable for the relayer.
        val sessionNonce = bindingSessionNonce(bindingData) ?: return false
        val challengeHex = attestation.optString("attestationChallengeHex").lowercase()
        if (challengeHex != sessionNonce) {
            return false
        }
        if (attestation.optBoolean("hardwareBacked") != true) {
            return false
        }
        if (attestation.optString("publicKeyPem") != publicKeyPem) {
            return false
        }

        val certificateChainPem = jsonStringArray(attestation.optJSONArray("certificateChainPem"))
        return certificateChainPem.isNotEmpty()
    }

    private fun bindingSessionNonce(bindingData: String): String? {
        return try {
            JSONObject(bindingData).optString("sessionNonce").lowercase().takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    private fun levelTwoFallback(reason: String): Map<String, Any> {
        return mapOf(
            "available" to false,
            "level" to 2,
            "securityLevel" to "none",
            "fallbackReason" to reason,
            "attestation" to mapOf(
                "requested" to true,
                "available" to false,
                "attestationChallengeHex" to "",
                "challengeSha256" to "",
                "certificateChainBase64" to emptyList<String>(),
                "certificateChainPem" to emptyList<String>(),
                "certificateChainSha256" to emptyList<String>(),
                "hardwareBacked" to false,
                "publicKeyPem" to "",
                "securityLevel" to "none",
                "fallbackReason" to reason,
            ),
        )
    }

    private fun signBinding(privateKey: PrivateKey, bindingData: String): ByteArray {
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(bindingData.toByteArray())
        return signer.sign()
    }

    private fun jsonStringArray(value: org.json.JSONArray?): List<String> {
        if (value == null) {
            return emptyList()
        }

        return (0 until value.length()).mapNotNull { index -> value.optString(index).takeIf { it.isNotBlank() } }
    }

    private fun pemBlock(label: String, bytes: ByteArray): String {
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(bytes)
        return "-----BEGIN $label-----\n$body\n-----END $label-----"
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { byte -> "%02x".format(byte) }
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

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val EC_CURVE = "secp256r1"
}
