import { X509Certificate, createHash, createPublicKey, verify } from "node:crypto";

const SUPPORTED_ANDROID_EVIDENCE_LEVELS = new Set([2, 3, 4]);
const SUPPORTED_KEYSTORE_SIGNATURE_ALGORITHMS = new Set([
  "SHA256withECDSA",
  "SHA256withRSA",
]);
const MAX_SIGNATURE_BYTES = 2048;
const ANDROID_ATTESTATION_ROOT_SHA256_ENV = "ARGUS_ANDROID_ATTESTATION_ROOT_SHA256";
const ANDROID_ATTESTATION_REVOKED_CERT_SHA256_ENV = "ARGUS_ANDROID_ATTESTATION_REVOKED_CERT_SHA256";
const ANDROID_ATTESTATION_REVOKED_SERIALS_ENV = "ARGUS_ANDROID_ATTESTATION_REVOKED_SERIALS";
const ANDROID_KEY_ATTESTATION_EXTENSION_OID = "1.3.6.1.4.1.11129.2.1.17";
const ANDROID_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION =
  "level_4_material_present_pending_relayer_root_validation";
const ANDROID_LEVEL_4_TRUSTED_ROOT_VALIDATED = "level_4_trusted_root_validated";
const ANDROID_SECURITY_LEVEL_TRUSTED_ENVIRONMENT = 1;
const ANDROID_SECURITY_LEVEL_STRONGBOX = 2;
const ANDROID_SECURITY_LEVEL_NAMES = new Map([
  [ANDROID_SECURITY_LEVEL_TRUSTED_ENVIRONMENT, "trusted_environment"],
  [ANDROID_SECURITY_LEVEL_STRONGBOX, "strongbox"],
]);

export function validateAndroidEvidenceLevel({ deviceIntegrity, manifest, request, playIntegrityDecision }) {
  const level = deviceIntegrity.androidEvidenceLevel;
  if (level === undefined) {
    return {
      acceptedLevel: undefined,
      evidenceLevel: "unspecified",
    };
  }

  if (!Number.isSafeInteger(level) || !SUPPORTED_ANDROID_EVIDENCE_LEVELS.has(level)) {
    throw new Error("androidEvidenceLevel must be 2, 3, or 4");
  }

  const fallback = validateHardwareFallback(deviceIntegrity, level);
  if (level === 2) {
    if (isProductionRegistrationRuntime()) {
      throw new Error("Production Verified Capture requires Level 3 or Level 4 Android evidence; Level 2 is demo-only");
    }
    return {
      acceptedLevel: 2,
      evidenceLevel: "level_2_native_capture",
      fallbackReason: fallback?.reason,
      verifiedCaptureEligible: false,
      playIntegrity: playIntegrityDecision,
    };
  }

  const keystoreSignature = validateKeystoreSignatureShape(deviceIntegrity.keystoreSignature);
  const acceptedPayloads = new Set([
    buildAndroidKeystoreSignedPayloadJson({
      deviceIntegrity,
      manifest,
      request,
    }),
    buildAndroidKeystoreCanonicalBindingJson({
      deviceIntegrity,
      manifest,
      request,
    }),
  ]);

  if (!acceptedPayloads.has(keystoreSignature.signedPayloadJson)) {
    throw new Error("keystoreSignature signedPayloadJson does not bind this proof bundle");
  }

  verifyKeystoreSignature(keystoreSignature);

  if (level === 4) {
    const hardwareAttestation = validateHardwareAttestation(
      deviceIntegrity.hardwareAttestation,
      keystoreSignature,
      request,
    );
    return {
      acceptedLevel: 4,
      evidenceLevel: "level_4_hardware_attestation",
      hardwareSecurityClass: hardwareAttestation.hardwareSecurityClass,
      attestationSecurityLevel: hardwareAttestation.attestationSecurityLevel,
      keymasterSecurityLevel: hardwareAttestation.keymasterSecurityLevel,
      trustedRootFingerprintSha256: hardwareAttestation.trustedRootFingerprintSha256,
      level4AttestationVerdict: acceptedLevel4AttestationVerdict(hardwareAttestation),
      playIntegrity: playIntegrityDecision,
    };
  }

  const level4AttestationVerdict = validatePendingLevel4AttestationMaterial({
    deviceIntegrity,
    keystoreSignature,
    request,
  });

  return {
    acceptedLevel: 3,
    evidenceLevel: "level_3_keystore_signature",
    fallbackReason: fallback?.reason,
    level4AttestationVerdict,
    playIntegrity: playIntegrityDecision,
  };
}

export function summarizeAndroidAttestationRootDiagnostics(deviceIntegrity) {
  const hardwareAttestation =
    deviceIntegrity?.hardwareAttestation &&
    typeof deviceIntegrity.hardwareAttestation === "object" &&
    !Array.isArray(deviceIntegrity.hardwareAttestation)
      ? deviceIntegrity.hardwareAttestation
      : undefined;
  const certificateChainPem = Array.isArray(hardwareAttestation?.certificateChainPem)
    ? hardwareAttestation.certificateChainPem
    : [];
  const diagnostics = {
    attestationCertificateChainPemCount: certificateChainPem.length,
    configuredAttestationRootFingerprintCount: undefined,
    configuredAttestationRootFingerprintError: undefined,
    submittedAttestationRootFingerprintSha256: undefined,
    submittedAttestationRootFingerprintError: undefined,
  };

  try {
    diagnostics.configuredAttestationRootFingerprintCount =
      configuredAndroidAttestationRootFingerprints().size;
  } catch (error) {
    diagnostics.configuredAttestationRootFingerprintError =
      error instanceof Error ? error.message : "Android attestation trust root config is invalid";
  }

  const submittedRootPem = certificateChainPem[certificateChainPem.length - 1];
  if (isNonEmptyString(submittedRootPem)) {
    try {
      diagnostics.submittedAttestationRootFingerprintSha256 = sha256Hex(
        new X509Certificate(normalizePemBlock(submittedRootPem)).raw,
      );
    } catch {
      diagnostics.submittedAttestationRootFingerprintError =
        "submitted Android attestation root certificate is not verifier-compatible";
    }
  }

  return diagnostics;
}

export function buildAndroidKeystoreSignedPayloadJson({ deviceIntegrity, manifest, request }) {
  // kr: signature 자체는 deviceIntegrityJson 안에 들어가므로, self-reference를 피하기 위해 unsigned device evidence hash를 서명합니다.
  // en: The signature lives inside deviceIntegrityJson, so sign the unsigned device-evidence hash to avoid a self-reference.
  return stableStringify({
    androidEvidenceLevel: deviceIntegrity.androidEvidenceLevel,
    appIdentityHash: request.appIdentityHash,
    cameraEvidenceCommitment: manifest.camera_evidence_commitment,
    captureSessionId: request.captureSessionId,
    capturedAtMs: manifest.captured_at_ms,
    hardwareAttestationHash: deviceIntegrity.hardwareAttestation
      ? sha256Hex(stableStringify(deviceIntegrity.hardwareAttestation))
      : null,
    imageHash: request.imageHash,
    metadataCommitment: manifest.metadata_commitment,
    nonce: request.sessionNonce,
    partnerIdHash: request.partnerIdHash,
    proofLevel: request.proofLevel,
    schemaVersion: manifest.schema_version,
    unsignedDeviceIntegrityHash: unsignedDeviceIntegrityHash(deviceIntegrity),
    useCase: request.useCase,
  });
}

function buildAndroidKeystoreCanonicalBindingJson({ deviceIntegrity, manifest, request }) {
  // kr: Android native module은 self-reference를 피하기 위해 deviceIntegrityJson 대신 manifest/evidence commitment와 session tuple을 직접 서명합니다.
  // en: The Android native module avoids self-reference by signing manifest/evidence commitments and the session tuple directly.
  const playIntegrityBinding = isNonEmptyString(deviceIntegrity?.playIntegrity?.tokenSha256)
    ? `"playIntegrityTokenHash":${JSON.stringify(deviceIntegrity.playIntegrity.tokenSha256)},`
    : "";
  return [
    "{",
    "\"schema\":\"argus.keystore.binding.v1\",",
    `"partnerId":${JSON.stringify(request.partnerId)},`,
    `"useCase":${JSON.stringify(request.useCase)},`,
    `"metadataCommitment":${JSON.stringify(manifest.metadata_commitment)},`,
    `"cameraEvidenceCommitment":${JSON.stringify(manifest.camera_evidence_commitment)},`,
    `"appIdentityHash":${JSON.stringify(request.appIdentityHash)},`,
    `"captureSessionId":${JSON.stringify(request.captureSessionId)},`,
    `"sessionNonce":${JSON.stringify(request.sessionNonce)},`,
    `"capturedAtMs":${manifest.captured_at_ms},`,
    playIntegrityBinding,
    `"imageHash":${JSON.stringify(request.imageHash)}`,
    "}",
  ].join("");
}

function validateKeystoreSignatureShape(keystoreSignature) {
  if (!keystoreSignature || typeof keystoreSignature !== "object" || Array.isArray(keystoreSignature)) {
    throw new Error("Level 3 Android evidence requires a keystoreSignature object");
  }

  const { algorithm, publicKeyPem, signatureBase64, signedPayloadJson } = keystoreSignature;
  if (!SUPPORTED_KEYSTORE_SIGNATURE_ALGORITHMS.has(algorithm)) {
    throw new Error("keystoreSignature algorithm is not supported");
  }

  if (!isNonEmptyString(publicKeyPem) || !isNonEmptyString(signedPayloadJson)) {
    throw new Error("keystoreSignature must include publicKeyPem and signedPayloadJson");
  }

  const signature = decodeCanonicalBase64("keystoreSignature.signatureBase64", signatureBase64);
  if (signature.byteLength === 0 || signature.byteLength > MAX_SIGNATURE_BYTES) {
    throw new Error("keystoreSignature signatureBase64 is not within policy");
  }

  try {
    createPublicKey(publicKeyPem);
  } catch {
    throw new Error("keystoreSignature publicKeyPem must be a valid public key");
  }

  return { algorithm, publicKeyPem, signature, signedPayloadJson };
}

function verifyKeystoreSignature({ publicKeyPem, signature, signedPayloadJson }) {
  if (!verify("sha256", Buffer.from(signedPayloadJson, "utf8"), publicKeyPem, signature)) {
    throw new Error("keystoreSignature does not verify signedPayloadJson");
  }
}

function validateHardwareAttestation(hardwareAttestation, keystoreSignature, request) {
  if (!hardwareAttestation || typeof hardwareAttestation !== "object" || Array.isArray(hardwareAttestation)) {
    throw new Error("Level 4 Android evidence requires hardware attestation material");
  }

  if (
    !hasRelayerVerifiableHardwareAttestationMaterial(hardwareAttestation) ||
    hardwareAttestation.attestationChallengeHex !== request.sessionNonce ||
    hardwareAttestation.publicKeyPem !== keystoreSignature.publicKeyPem ||
    !Array.isArray(hardwareAttestation.certificateChainPem) ||
    hardwareAttestation.certificateChainPem.length === 0 ||
    hardwareAttestation.certificateChainPem.some((entry) => !isNonEmptyString(entry))
  ) {
    throw new Error("Level 4 Android evidence requires hardware-backed attestation material");
  }

  return validateHardwareAttestationCertificateChain(
    hardwareAttestation.certificateChainPem,
    keystoreSignature.publicKeyPem,
    request.sessionNonce,
  );
}

function hasRelayerVerifiableHardwareAttestationMaterial(hardwareAttestation) {
  const locallySupported =
    hardwareAttestation.supported === true &&
    hardwareAttestation.hardwareBacked === true;
  const pendingRelayerRootValidation =
    hardwareAttestation.supported === false &&
    hardwareAttestation.hardwareBacked === true &&
    hardwareAttestation.rootValidated === false &&
    hardwareAttestation.fallbackLevel === 3 &&
    hardwareAttestation.reason === "attestation_root_validation_required";

  return locallySupported || pendingRelayerRootValidation;
}

function validatePendingLevel4AttestationMaterial({ deviceIntegrity, keystoreSignature, request }) {
  if (!hasPendingLevel4AttestationMaterial(deviceIntegrity)) {
    return undefined;
  }

  try {
    const hardwareAttestation = validateHardwareAttestation(
      deviceIntegrity.hardwareAttestation,
      keystoreSignature,
      request,
    );
    return acceptedLevel4AttestationVerdict(hardwareAttestation);
  } catch (error) {
    const trustRootConfig = androidAttestationTrustRootConfigStatus();
    return {
      accepted: false,
      acceptedLevel: 3,
      attempted: true,
      attestationStatus: ANDROID_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION,
      evidenceLevel: "level_3_keystore_signature",
      failureReason: error instanceof Error ? error.message : "Level 4 Android attestation validation failed",
      trustedAttestationRootConfigured: trustRootConfig.configured,
      trustedAttestationRootConfiguredError: trustRootConfig.error,
      trustedAttestationRootValidated: false,
    };
  }
}

function hasPendingLevel4AttestationMaterial(deviceIntegrity) {
  const hardwareAttestation = deviceIntegrity.hardwareAttestation;
  return Boolean(
    deviceIntegrity.level4AttestationMaterial === true ||
      deviceIntegrity.keystoreAttestationMaterial === true ||
      deviceIntegrity.attestationStatus === ANDROID_LEVEL_4_MATERIAL_PENDING_RELAY_VALIDATION ||
      (hardwareAttestation &&
        typeof hardwareAttestation === "object" &&
        !Array.isArray(hardwareAttestation) &&
        hasRelayerVerifiableHardwareAttestationMaterial(hardwareAttestation)),
  );
}

function acceptedLevel4AttestationVerdict(hardwareAttestation) {
  return {
    accepted: true,
    acceptedLevel: 4,
    attempted: true,
    attestationSecurityLevel: hardwareAttestation.attestationSecurityLevel,
    attestationStatus: ANDROID_LEVEL_4_TRUSTED_ROOT_VALIDATED,
    evidenceLevel: "level_4_hardware_attestation",
    hardwareSecurityClass: hardwareAttestation.hardwareSecurityClass,
    keymasterSecurityLevel: hardwareAttestation.keymasterSecurityLevel,
    trustedAttestationRootConfigured: true,
    trustedAttestationRootFingerprintSha256: hardwareAttestation.trustedRootFingerprintSha256,
    trustedAttestationRootValidated: true,
  };
}

function androidAttestationTrustRootConfigStatus() {
  try {
    return {
      configured: configuredAndroidAttestationRootFingerprints().size > 0,
    };
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : "Android attestation trust root config is invalid",
    };
  }
}

function validateHardwareAttestationCertificateChain(certificateChainPem, publicKeyPem, expectedChallengeHex) {
  let certificates;
  try {
    certificates = certificateChainPem.map((entry) => new X509Certificate(normalizePemBlock(entry)));
  } catch {
    throw new Error("Level 4 Android evidence requires verifier-compatible certificate-chain material");
  }

  const leafCertificate = certificates[0];
  const rootCertificate = certificates[certificates.length - 1];
  // kr: submitted chain은 Android/app 입력이므로, leaf key가 Level 3 signature 검증 키와 같고 configured root까지 검증될 때만 Level 4로 봅니다.
  // en: The submitted chain is Android/app input; treat it as Level 4 only when the leaf key matches Level 3 and the chain reaches a configured root.
  if (publicKeyToSpkiPem(leafCertificate.publicKey) !== publicKeyToSpkiPem(publicKeyPem)) {
    throw new Error("Level 4 Android attestation public key does not match keystoreSignature publicKeyPem");
  }

  validateCertificateChainSignatures(certificates);

  validateAndroidAttestationRevocation(certificates);

  const trustedRootFingerprints = configuredAndroidAttestationRootFingerprints();
  if (trustedRootFingerprints.size === 0) {
    throw new Error("Level 4 Android evidence requires configured Android attestation trust root");
  }
  if (!trustedRootFingerprints.has(sha256Hex(rootCertificate.raw))) {
    throw new Error("Level 4 Android attestation root is not trusted");
  }

  // Android guidance says the first extension nearest the root is authoritative; it may not be the leaf.
  const attestationCertificate = findFirstAndroidAttestationCertificateFromRoot(certificates);
  const attestationExtension = validateAndroidKeyAttestationExtension(
    attestationCertificate.raw,
    expectedChallengeHex,
  );
  return {
    ...attestationExtension,
    trustedRootFingerprintSha256: sha256Hex(rootCertificate.raw),
  };
}

function findFirstAndroidAttestationCertificateFromRoot(certificates) {
  let selected = null;
  for (let index = certificates.length - 1; index >= 0; index -= 1) {
    const extension = findX509Extension(
      certificates[index].raw,
      ANDROID_KEY_ATTESTATION_EXTENSION_OID,
    );
    if (extension) {
      selected = certificates[index];
      break;
    }
  }

  if (!selected) {
    throw new Error("Level 4 Android evidence requires Android key attestation certificate extension");
  }

  return selected;
}

function validateAndroidAttestationRevocation(certificates) {
  const revokedFingerprints = configuredRevokedCertificateFingerprints();
  const revokedSerials = configuredRevokedCertificateSerials();
  for (const certificate of certificates) {
    const fingerprint = sha256Hex(certificate.raw);
    const serial = certificate.serialNumber.toLowerCase().replace(/^0+/, "") || "0";
    if (revokedFingerprints.has(fingerprint) || revokedSerials.has(serial)) {
      throw new Error("Android attestation certificate is revoked by relayer policy");
    }
  }
}

function validateCertificateChainSignatures(certificates) {
  try {
    for (let index = 0; index < certificates.length - 1; index += 1) {
      if (!certificates[index].verify(certificates[index + 1].publicKey)) {
        throw new Error("chain signature mismatch");
      }
    }
    const rootCertificate = certificates[certificates.length - 1];
    if (!rootCertificate.verify(rootCertificate.publicKey)) {
      throw new Error("root signature mismatch");
    }
  } catch {
    throw new Error("Level 4 Android attestation certificate chain does not verify");
  }
}

function configuredAndroidAttestationRootFingerprints() {
  const rawValue = process.env[ANDROID_ATTESTATION_ROOT_SHA256_ENV] ?? "";
  const fingerprints = rawValue
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (fingerprints.some((fingerprint) => !/^[0-9a-f]{64}$/.test(fingerprint))) {
    throw new Error(`${ANDROID_ATTESTATION_ROOT_SHA256_ENV} must contain SHA-256 hex fingerprints`);
  }

  return new Set(fingerprints);
}

function configuredRevokedCertificateFingerprints() {
  return configuredHexSet(
    ANDROID_ATTESTATION_REVOKED_CERT_SHA256_ENV,
    "SHA-256 certificate fingerprints",
  );
}

function configuredRevokedCertificateSerials() {
  const rawValue = process.env[ANDROID_ATTESTATION_REVOKED_SERIALS_ENV] ?? "";
  const serials = rawValue
    .split(/[,:\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^0+/, ""))
    .filter(Boolean);
  if (serials.some((serial) => !/^[0-9a-f]+$/.test(serial))) {
    throw new Error(`${ANDROID_ATTESTATION_REVOKED_SERIALS_ENV} must contain hexadecimal certificate serials`);
  }
  return new Set(serials);
}

function configuredHexSet(environmentName, description) {
  const rawValue = process.env[environmentName] ?? "";
  const values = rawValue
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (values.some((value) => !/^[0-9a-f]{64}$/.test(value))) {
    throw new Error(`${environmentName} must contain ${description}`);
  }
  return new Set(values);
}

function validateAndroidKeyAttestationExtension(certificateDer, expectedChallengeHex) {
  // kr: Level 4는 "trusted root가 서명한 cert"만으로 충분하지 않습니다. Android Key Attestation extension 안의 challenge와 hardware security level까지 묶습니다.
  // en: Level 4 is not just a cert signed by a trusted root; bind the Android Key Attestation extension challenge and hardware security level too.
  const extensionValue = findX509Extension(
    certificateDer,
    ANDROID_KEY_ATTESTATION_EXTENSION_OID,
  );
  if (!extensionValue) {
    throw new Error("Level 4 Android evidence requires Android key attestation certificate extension");
  }

  let fields;
  try {
    const keyDescription = readSingleDerElement(extensionValue);
    if (keyDescription.tag !== 0x30) {
      throw new Error("not a sequence");
    }
    fields = readDerChildren(keyDescription.value);
  } catch {
    throw new Error("Level 4 Android key attestation extension is not verifier-compatible");
  }

  if (fields.length < 8) {
    throw new Error("Level 4 Android key attestation extension is incomplete");
  }

  const attestationSecurityLevel = readDerSmallInteger(fields[1], 0x0a);
  const keymasterSecurityLevel = readDerSmallInteger(fields[3], 0x0a);
  const attestationChallenge = fields[4];
  if (attestationChallenge.tag !== 0x04) {
    throw new Error("Level 4 Android key attestation challenge is missing");
  }

  if (attestationChallenge.value.toString("hex") !== expectedChallengeHex) {
    throw new Error("Level 4 Android key attestation challenge does not match session nonce");
  }

  if (
    !isHardwareAndroidSecurityLevel(attestationSecurityLevel) ||
    !isHardwareAndroidSecurityLevel(keymasterSecurityLevel)
  ) {
    throw new Error("Level 4 Android evidence requires hardware-backed Android key attestation security level");
  }

  return {
    attestationSecurityLevel: androidSecurityLevelName(attestationSecurityLevel),
    keymasterSecurityLevel: androidSecurityLevelName(keymasterSecurityLevel),
    hardwareSecurityClass: hardwareSecurityClass(
      attestationSecurityLevel,
      keymasterSecurityLevel,
    ),
  };
}

function findX509Extension(certificateDer, targetOid) {
  const certificate = readSingleDerElement(Buffer.from(certificateDer));
  if (certificate.tag !== 0x30) {
    throw new Error("certificate is not a sequence");
  }

  const certificateFields = readDerChildren(certificate.value);
  const tbsCertificate = certificateFields[0];
  if (!tbsCertificate || tbsCertificate.tag !== 0x30) {
    throw new Error("certificate tbsCertificate is missing");
  }

  const tbsFields = readDerChildren(tbsCertificate.value);
  const extensionsWrapper = tbsFields.find((field) => field.tag === 0xa3);
  if (!extensionsWrapper) {
    return null;
  }

  const extensions = readSingleDerElement(extensionsWrapper.value);
  if (extensions.tag !== 0x30) {
    throw new Error("certificate extensions are not a sequence");
  }

  let matchedExtensionValue = null;
  for (const extension of readDerChildren(extensions.value)) {
    if (extension.tag !== 0x30) {
      throw new Error("certificate extension is not a sequence");
    }
    const fields = readDerChildren(extension.value);
    if (fields.length !== 2 && fields.length !== 3) {
      throw new Error("certificate extension shape is invalid");
    }

    const oid = fields[0];
    if (!oid || oid.tag !== 0x06) {
      throw new Error("certificate extension OID is missing");
    }

    const hasCriticalFlag = fields.length === 3;
    if (hasCriticalFlag && !isDerCriticalTrue(fields[1])) {
      throw new Error("certificate extension critical flag is invalid");
    }

    const extnValue = hasCriticalFlag ? fields[2] : fields[1];
    if (!extnValue || extnValue.tag !== 0x04) {
      throw new Error("certificate extension value is missing");
    }

    if (decodeDerObjectIdentifier(oid.value) === targetOid) {
      if (matchedExtensionValue) {
        throw new Error("certificate contains duplicate Android key attestation extension");
      }
      matchedExtensionValue = extnValue.value;
    }
  }

  return matchedExtensionValue;
}

function readSingleDerElement(buffer) {
  const element = readDerElement(buffer, 0);
  if (element.nextOffset !== buffer.length) {
    throw new Error("DER element has trailing data");
  }
  return element;
}

function readDerChildren(buffer) {
  const children = [];
  let offset = 0;
  while (offset < buffer.length) {
    const child = readDerElement(buffer, offset);
    children.push(child);
    offset = child.nextOffset;
  }
  return children;
}

function readDerElement(buffer, offset) {
  if (offset + 2 > buffer.length) {
    throw new Error("DER element is truncated");
  }

  const tag = buffer[offset];
  const lengthByte = buffer[offset + 1];
  let length = lengthByte;
  let valueStart = offset + 2;
  if ((lengthByte & 0x80) !== 0) {
    const lengthBytes = lengthByte & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || valueStart + lengthBytes > buffer.length) {
      throw new Error("DER length is invalid");
    }
    if (buffer[valueStart] === 0x00) {
      throw new Error("DER length is non-minimal");
    }
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = (length * 256) + buffer[valueStart + index];
    }
    if (length < 0x80) {
      throw new Error("DER length is non-minimal");
    }
    valueStart += lengthBytes;
  }

  const valueEnd = valueStart + length;
  if (valueEnd > buffer.length) {
    throw new Error("DER value is truncated");
  }

  return {
    tag,
    value: buffer.subarray(valueStart, valueEnd),
    nextOffset: valueEnd,
  };
}

function readDerSmallInteger(element, expectedTag) {
  if (!element || element.tag !== expectedTag || element.value.length === 0 || element.value.length > 4) {
    throw new Error("DER integer/enumerated value is invalid");
  }
  if ((element.value[0] & 0x80) !== 0) {
    throw new Error("DER integer/enumerated value must be non-negative");
  }
  if (element.value.length > 1 && element.value[0] === 0x00 && (element.value[1] & 0x80) === 0) {
    throw new Error("DER integer/enumerated value is non-minimal");
  }

  return element.value.reduce((value, byte) => (value << 8) | byte, 0);
}

function decodeDerObjectIdentifier(value) {
  if (value.length === 0) {
    throw new Error("DER object identifier is empty");
  }

  const firstByte = value[0];
  const firstIdentifier = firstByte < 40 ? 0 : firstByte < 80 ? 1 : 2;
  const secondIdentifier = firstIdentifier < 2 ? firstByte - (firstIdentifier * 40) : firstByte - 80;
  const identifiers = [firstIdentifier, secondIdentifier];
  let current = 0;
  let hasTrailingContinuation = false;
  for (const byte of value.subarray(1)) {
    current = (current * 128) + (byte & 0x7f);
    if (current > Number.MAX_SAFE_INTEGER) {
      throw new Error("DER object identifier arc is too large");
    }
    hasTrailingContinuation = (byte & 0x80) !== 0;
    if (!hasTrailingContinuation) {
      identifiers.push(current);
      current = 0;
    }
  }
  if (hasTrailingContinuation) {
    throw new Error("DER object identifier is truncated");
  }

  return identifiers.join(".");
}

function isDerCriticalTrue(element) {
  return (
    element?.tag === 0x01 &&
    element.value.length === 1 &&
    element.value[0] === 0xff
  );
}

function isHardwareAndroidSecurityLevel(value) {
  return (
    value === ANDROID_SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
    value === ANDROID_SECURITY_LEVEL_STRONGBOX
  );
}

function androidSecurityLevelName(value) {
  return ANDROID_SECURITY_LEVEL_NAMES.get(value) ?? "unknown";
}

function hardwareSecurityClass(attestationSecurityLevel, keymasterSecurityLevel) {
  if (
    attestationSecurityLevel === ANDROID_SECURITY_LEVEL_STRONGBOX &&
    keymasterSecurityLevel === ANDROID_SECURITY_LEVEL_STRONGBOX
  ) {
    return "strongbox";
  }

  return "trusted_environment";
}

function validateHardwareFallback(deviceIntegrity, level) {
  const { hardwareAttestation } = deviceIntegrity;
  if (!hardwareAttestation || typeof hardwareAttestation !== "object" || Array.isArray(hardwareAttestation)) {
    return null;
  }

  if (hardwareAttestation.supported !== false) {
    return null;
  }

  if (level === 4) {
    throw new Error("Level 4 Android evidence cannot use hardware attestation fallback");
  }

  if (hardwareAttestation.fallbackLevel !== level || !isNonEmptyString(hardwareAttestation.reason)) {
    throw new Error("hardware attestation fallback must explicitly match androidEvidenceLevel");
  }

  return {
    fallbackLevel: hardwareAttestation.fallbackLevel,
    reason: hardwareAttestation.reason,
  };
}

function unsignedDeviceIntegrityHash(deviceIntegrity) {
  const { hardwareAttestation, keystoreSignature, ...unsignedDeviceIntegrity } = deviceIntegrity;
  return sha256Hex(stableStringify(unsignedDeviceIntegrity));
}

function decodeCanonicalBase64(field, value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${field} must be canonical base64`);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`${field} must be canonical base64`);
  }

  return decoded;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function publicKeyToSpkiPem(value) {
  const keyObject = typeof value === "string" ? createPublicKey(value) : value;
  return keyObject.export({ format: "pem", type: "spki" }).toString();
}

function normalizePemBlock(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isProductionRuntime() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function isProductionRegistrationRuntime() {
  return isProductionRuntime() && process.env.ARGUS_RELAYER_MODE === "solana";
}

export const __androidEvidencePolicyTestHooks = Object.freeze({
  findX509Extension,
});
