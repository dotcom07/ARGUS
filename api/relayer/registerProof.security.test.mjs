#!/usr/bin/env node
import assert from "node:assert/strict";
import { X509Certificate, createHash, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import {
  __androidEvidencePolicyTestHooks,
  buildAndroidKeystoreSignedPayloadJson,
  validateAndroidEvidenceLevel,
} from "./androidEvidencePolicy.mjs";
import { openRelayerCaptureSession } from "./openCaptureSession.mjs";
import {
  MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH,
  MAX_NATIVE_CAPTURE_PHOTO_BYTES,
} from "./photoBytesPolicy.mjs";
import { registerProof } from "./registerProof.mjs";
import {
  MAX_CANONICAL_MANIFEST_JSON_BYTES,
  MAX_CAPTURE_SESSION_ID_BYTES,
  MAX_EVIDENCE_JSON_BYTES,
  MAX_VERIFIER_BASE_URL_BYTES,
} from "./requestTextPolicy.mjs";
import { authorizeCaptureSession, clearCaptureSessions, openCaptureSession } from "./sessionStore.mjs";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, value);
  },
};

const { createDemoCaptureProof } = await import("../../packages/argus-rn-sdk/src/demoProof.mjs");

const demoProof = await createDemoCaptureProof({
  partnerId: "recommerce-demo",
  useCase: "marketplace_listing",
  metadata: {
    condition: "used-excellent",
    listingId: "argus-listing-security",
    title: "Security review listing",
  },
});
const proof = promoteToAppCaptureProof(demoProof);
const LEVEL4_ATTESTED_PRIVATE_KEY_PEM = [
  "-----BEGIN EC " + "PRIVATE " + "KEY-----",
  "MHcCAQEEIL2fBwEF4e78vpRBY7plkiAqhanQy1tlXcL+8YvOn4QZoAoGCCqGSM49",
  "AwEHoUQDQgAEzFRUpqRjHXD7/BRkRhdoHHW3VyZyiwhoj4FmVG3W7vgnOnCFH7Kw",
  "RwmCtlUelyh1tNbNDL6/F+0ggTEKskeTDQ==",
  "-----END EC " + "PRIVATE " + "KEY-----",
].join("\n");
const LEVEL4_ATTESTATION_CHALLENGE_HEX =
  "65b2ea7ca3507081b4a4090fca6079492b26ffa6728240bdbe1a59fef2c01313";
const LEVEL4_ATTESTATION_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIB7TCCAZOgAwIBAgIUYXVIAwyXt2PtWknQvC8ruRxxAdMwCgYIKoZIzj0EAwIw
KDEmMCQGA1UEAwwdQXJndXMgTGV2ZWw0IFRlc3QgQXR0ZXN0YXRpb24wHhcNMjYw
NTAyMDQxNDU4WhcNMzYwNDI5MDQxNDU4WjAoMSYwJAYDVQQDDB1Bcmd1cyBMZXZl
bDQgVGVzdCBBdHRlc3RhdGlvbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMxU
VKakYx1w+/wUZEYXaBx1t1cmcosIaI+BZlRt1u74JzpwhR+ysEcJgrZVHpcodbTW
zQy+vxftIIExCrJHkw2jgZowgZcwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQU
IubIXBO1JhVJaO0jz/36IQjRYd8wHwYDVR0jBBgwFoAUIubIXBO1JhVJaO0jz/36
IQjRYd8wRAYKKwYBBAHWeQIBEQQ2MDQCAQQKAQECAQQKAQEEIGWy6nyjUHCBtKQJ
D8pgeUkrJv+mcoJAvb4aWf7ywBMTBAAwADAAMAoGCCqGSM49BAMCA0gAMEUCIQCj
fmOgsp3SgH/i9OKqybMWja7xoAKuq9rtsBRhLaKeCAIgdGN6N8sioYeTydMY+2ed
AueuKAp3yP9xVK3suDGjgK8=
-----END CERTIFICATE-----`;
const LEVEL4_NO_ANDROID_EXTENSION_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIBpDCCAUugAwIBAgIUfGr/3xGbx1LqRCwPCP7P+9yBuD4wCgYIKoZIzj0EAwIw
KDEmMCQGA1UEAwwdQXJndXMgTGV2ZWw0IFRlc3QgQXR0ZXN0YXRpb24wHhcNMjYw
NTAyMDM1MzA1WhcNMzYwNDI5MDM1MzA1WjAoMSYwJAYDVQQDDB1Bcmd1cyBMZXZl
bDQgVGVzdCBBdHRlc3RhdGlvbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMxU
VKakYx1w+/wUZEYXaBx1t1cmcosIaI+BZlRt1u74JzpwhR+ysEcJgrZVHpcodbTW
zQy+vxftIIExCrJHkw2jUzBRMB0GA1UdDgQWBBQi5shcE7UmFUlo7SPP/fohCNFh
3zAfBgNVHSMEGDAWgBQi5shcE7UmFUlo7SPP/fohCNFh3zAPBgNVHRMBAf8EBTAD
AQH/MAoGCCqGSM49BAMCA0cAMEQCIB3W+X1AWLDYzYeUZfxpywWyLHFH5pX1cx4B
MoPnPJn9AiA5SJnW8UAakK3TrO0/YpLuKXRj+rp2s6DU0o0rtzn6tQ==
-----END CERTIFICATE-----`;
const PLACEHOLDER_CERTIFICATE_PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const ANDROID_KEY_ATTESTATION_EXTENSION_OID = "1.3.6.1.4.1.11129.2.1.17";
const ANDROID_KEY_ATTESTATION_EXTENSION_OID_DER = Buffer.from("2b06010401d679020111", "hex");
process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = certificateSha256(
  LEVEL4_ATTESTATION_CERTIFICATE_PEM,
);

rejectsDuplicateAndroidKeyAttestationExtensionOid();
rejectsExplicitFalseExtensionCriticalFlag();
await acceptsValidRegistration();
await acceptsAuthorizedCaptureSessionOpen();
await acceptsEnvConfiguredPartnerPolicyWithUppercaseAppIdentity();
await rejectsDuplicatePartnerAllowlistEntryBeforeConsumingSession();
await rejectsDuplicatePartnerUseCaseBeforeConsumingSession();
await rejectsDuplicatePartnerAppIdentityBeforeConsumingSession();
await rejectsInactivePartnerAllowlistEntryBeforeOpeningSession();
await rejectsInactivePartnerAllowlistEntryBeforeConsumingSession();
await acceptsCurrentDemoRegistryAndRelayerConfig();
await acceptsKotlinCanonicalEvidenceNumbers();
await acceptsKotlinCanonicalControlEscapes();
await acceptsFiniteAndroidSensorNumberLexemes();
await acceptsVerifierAllowlistedBasePath();
await acceptsVerifierAllowlistedEncodedSeparatorBasePath();
await rejectsUnauthorizedCaptureSessionPartner();
await rejectsUnauthorizedCaptureSessionAppIdentity();
await rejectsRegistrationPartnerAllowlistBypass();
await rejectsSolanaModeDefaultPartnerPolicy();
await rejectsProductionDefaultPartnerPolicy();
await rejectsCaseVariantProductionDefaultPartnerPolicy();
await rejectsProductionWithoutSolanaModeBeforeConsumingSession();
await rejectsCaseVariantProductionWithoutSolanaModeBeforeConsumingSession();
await rejectsUnsupportedRelayerModeBeforeDemoFallback();
await rejectsUnsupportedRelayerModeDefaultCaptureSessionPolicy();
await rejectsHashOnlyRequest();
await rejectsUnknownSessionNonce();
await rejectsReusedSessionNonce();
await rejectsDuplicateSessionAuthorizationReset();
await rejectsOversizedCaptureSessionAuthorization();
await rejectsNonFiniteSessionExpiry();
await rejectsInvalidSessionTtl();
await rejectsExpiredSessionNonce();
await rejectsSessionPartnerMismatch();
await rejectsSessionUseCaseMismatch();
await rejectsSessionAppIdentityMismatch();
await rejectsManifestHashMismatch();
await rejectsImageHashMismatch();
await rejectsProofIdMismatch();
await rejectsProofIdThatOmitsNonce();
await rejectsUppercaseProofIdBeforeConsumingSession();
await rejectsManifestNonceMismatch();
await rejectsDuplicateKeyManifestJson();
await rejectsNonFiniteManifestNumber();
await rejectsFutureCaptureTimestamp();
await rejectsNonCanonicalManifestWithExtraClaim();
await rejectsNonCanonicalEvidenceJson();
await acceptsFiniteSensorNumberTrailingZeros();
await rejectsCameraEvidenceDecimalCapturedAtMs();
await rejectsCameraEvidenceDecimalCollectedAtMs();
await rejectsCameraEvidenceDecimalCapturedFileBytes();
await rejectsMotionEvidenceDecimalWindow();
await rejectsMotionEvidenceDecimalSampledAt();
await rejectsNonFiniteEvidenceJson();
await rejectsEvidenceJsonWithUncommittedPadding();
await rejectsOversizedCanonicalManifestJsonBeforeConsumingSession();
await rejectsOversizedMetadataJsonBeforeConsumingSession();
await rejectsOversizedCameraEvidenceJsonBeforeConsumingSession();
await rejectsOversizedDeviceIntegrityJsonBeforeConsumingSession();
await rejectsOversizedCaptureSessionIdBeforeConsumingSession();
await rejectsOversizedVerifierBaseUrlBeforeConsumingSession();
await rejectsPartnerHashMismatch();
await rejectsManifestPartnerIdMismatch();
await rejectsManifestUseCaseMismatch();
await rejectsUntrustedVerifierBaseUrl();
await rejectsVerifierBaseUrlWithQueryBypass();
await rejectsVerifierBaseUrlWithFragmentBeforeConsumingSession();
await rejectsVerifierBaseUrlWithPathBypass();
await rejectsVerifierBaseUrlWithEncodedPathTraversal();
await rejectsVerifierBaseUrlWithEncodedSeparatorTraversal();
await rejectsVerifierBaseUrlWithBackslashTraversal();
await rejectsVerifierBaseUrlWithSchemeBackslashTraversal();
await rejectsVerifierBaseUrlWithoutAuthorityBeforeConsumingSession();
await rejectsProductionLoopbackVerifierBaseUrl();
await rejectsCaseVariantProductionLoopbackVerifierBaseUrl();
await rejectsProductionHttpsLoopbackVerifierBaseUrlEvenWhenAllowlisted();
await rejectsProductionHttps127RangeVerifierBaseUrlEvenWhenAllowlisted();
await rejectsProductionIpv4MappedLoopbackVerifierBaseUrlEvenWhenAllowlisted();
await rejectsProductionLoopbackVerifierAllowlistEntryBeforeConsumingSession();
await rejectsDuplicateVerifierAllowlistEntryBeforeConsumingSession();
await rejectsInvalidEnvVerifierAllowlistEntry();
await rejectsUnsupportedSchemaVersion();
await rejectsDemoProofLevel();
await rejectsDemoCameraStubForAppCapture();
await rejectsMissingCameraEvidence();
await rejectsAppCaptureWithoutMotionEvidence();
await rejectsAppCaptureWithoutCameraMetadata();
await rejectsAppCaptureWithoutCapturedFileBytes();
await rejectsAppCaptureWithoutPhotoBytes();
await rejectsAppCaptureWithMismatchedPhotoBytes();
await consumesSessionAfterPhotoBytesValidationFailure();
await rejectsAppCaptureWithMismatchedCapturedFileBytes();
await acceptsLevel2HardwareFallbackEvidence();
await acceptsLevel3KeystoreEvidence();
await acceptsLevel3NativeCanonicalKeystoreEvidence();
await acceptsLevel3WithPendingLevel4MaterialAfterRelayerRootValidation();
await acceptsLevel3WithPendingLevel4MaterialWithoutTrustedRootAsLevel3();
await acceptsLevel3HardwareFallbackEvidence();
await rejectsLevel3KeystoreSignatureMismatch();
await acceptsLevel4HardwareAttestationEvidence();
await rejectsLevel4WithoutTrustedRoot();
await rejectsLevel4UntrustedRoot();
await rejectsLevel4PlaceholderCertificateChain();
await rejectsLevel4CertificateWithoutAndroidKeyAttestationExtension();
await rejectsLevel4ChallengeSessionMismatch();
await rejectsLevel4HardwareFallbackPromotion();
await rejectsAppCaptureWithNonCanonicalPhotoBytes();
await rejectsAppCaptureWithOversizedPhotoBytesBeforeConsumingSession();
await rejectsAppCaptureWithNonJpegPhotoBytes();
await rejectsAppCaptureWithMalformedJpegSegment();
await rejectsAppCaptureWithMismatchedJpegComponents();
await rejectsAppCaptureWithScanComponentMissingFromFrame();
await rejectsAppCaptureWithRedefinedFrameComponents();
await rejectsAppCaptureWithMotionPresenceFlagOnly();
await rejectsAppCaptureWithStaleCameraEvidence();
await rejectsAppCaptureWithStaleMotionSnapshot();
await rejectsAppCaptureWithWideMotionWindow();
await rejectsDeviceAttestedOverclaim();
await consumesSessionAfterSolanaWrapperValidationFailure();
await consumesSessionAfterSolanaWrapperVerifierBaseUrlTraversal();
await rejectsOversizedVerifierBaseUrlBeforeConsumingSessionInSolanaWrapper();
await rejectsVerifierBaseUrlWithoutAuthorityBeforeConsumingSessionInSolanaWrapper();
await doesNotConsumeSessionWhenSolanaWrapperCannotSubmit();

console.log("Relayer security boundary checks passed");

async function acceptsValidRegistration() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const result = await registerProof(buildRequest(proof));

  assert.equal(result.proofId, proof.proofId);
  assert.equal(result.proofRecord.status, "superseded");
  assert.equal(result.proofRecord.relayerAuthorized, false);
  assert.equal(result.relayer, "ArgusLocalDemoRelayer111111111111111111111111");
  assert.equal(result.proofRecord.relayer, result.relayer);
  assert.equal(result.feePayer, result.relayer);
  assert.equal(result.sponsoredGas, false);
}

async function acceptsAuthorizedCaptureSessionOpen() {
  clearCaptureSessions();

  const session = openRelayerCaptureSession({
    appIdentityHash: proof.appIdentityHash,
    partnerId: proof.partnerId,
    useCase: proof.useCase,
  });

  assert.match(session.captureSessionId, /^argus-session-/);
  assert.match(session.nonce, /^[0-9a-f]{64}$/);
}

async function acceptsEnvConfiguredPartnerPolicyWithUppercaseAppIdentity() {
  clearCaptureSessions();
  const partnerProof = rewriteProof(proof, { partnerId: "env-configured-partner" });

  await withPartnerAllowlist(
    [
      {
        appIdentityHashes: [partnerProof.appIdentityHash.toUpperCase()],
        partnerId: partnerProof.partnerId,
        useCases: [partnerProof.useCase],
      },
    ],
    async () => {
      const session = openRelayerCaptureSession({
        appIdentityHash: partnerProof.appIdentityHash.toUpperCase(),
        partnerId: partnerProof.partnerId,
        useCase: partnerProof.useCase,
      });
      const sessionProof = rewriteProof(partnerProof, {
        captureSessionId: session.captureSessionId,
        nonce: session.nonce,
      });

      const result = await registerProof({
        ...buildRequest(sessionProof),
        appIdentityHash: sessionProof.appIdentityHash.toUpperCase(),
      });

      assert.equal(result.proofId, sessionProof.proofId);
      assert.equal(result.proofRecord.relayerAuthorized, false);
    },
  );
}

async function rejectsDuplicatePartnerAllowlistEntryBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withPartnerAllowlist(
    [
      {
        appIdentityHashes: [proof.appIdentityHash],
        partnerId: proof.partnerId,
        useCases: [proof.useCase],
      },
      {
        appIdentityHashes: ["5".repeat(64)],
        partnerId: proof.partnerId,
        useCases: [proof.useCase],
      },
    ],
    async () => {
      await assert.rejects(
        () => registerProof(buildRequest(proof)),
        /partnerId appears more than once in ARGUS_PARTNER_APP_ALLOWLIST/,
      );
    },
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsDuplicatePartnerUseCaseBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withPartnerAllowlist(
    [
      {
        appIdentityHashes: [proof.appIdentityHash],
        partnerId: proof.partnerId,
        useCases: [proof.useCase, proof.useCase],
      },
    ],
    async () => {
      await assert.rejects(
        () => registerProof(buildRequest(proof)),
        /useCases must not contain duplicate entries/,
      );
    },
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsDuplicatePartnerAppIdentityBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withPartnerAllowlist(
    [
      {
        appIdentityHashes: [proof.appIdentityHash, proof.appIdentityHash.toUpperCase()],
        partnerId: proof.partnerId,
        useCases: [proof.useCase],
      },
    ],
    async () => {
      await assert.rejects(
        () => registerProof(buildRequest(proof)),
        /appIdentityHashes must not contain duplicate entries/,
      );
    },
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsInactivePartnerAllowlistEntryBeforeOpeningSession() {
  clearCaptureSessions();

  await withPartnerAllowlist(
    [
      {
        appIdentityHashes: [proof.appIdentityHash],
        partnerId: proof.partnerId,
        status: "disabled",
        useCases: [proof.useCase],
      },
    ],
    async () => {
      assert.throws(
        () =>
          openRelayerCaptureSession({
            appIdentityHash: proof.appIdentityHash,
            partnerId: proof.partnerId,
            useCase: proof.useCase,
          }),
        /partner allowlist status must be active/,
      );
    },
  );
}

async function rejectsInactivePartnerAllowlistEntryBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withPartnerAllowlist(
    [
      {
        appIdentityHashes: [proof.appIdentityHash],
        partnerId: proof.partnerId,
        status: "revoked",
        useCases: [proof.useCase],
      },
    ],
    async () => {
      await assert.rejects(
        () => registerProof(buildRequest(proof)),
        /partner allowlist status must be active/,
      );
    },
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function acceptsCurrentDemoRegistryAndRelayerConfig() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withDemoRegistryConfig(
    {
      registryProgramId: "DevnetArgusRegistry111111111111111111111111",
      relayer: "DevnetArgusRelayer1111111111111111111111111",
    },
    async () => {
      const result = await registerProof(buildRequest(proof));

      assert.equal(result.registryAddress, "DevnetArgusRegistry111111111111111111111111");
      assert.equal(result.registryProgramId, "DevnetArgusRegistry111111111111111111111111");
      assert.equal(result.proofRecord.registryProgramId, result.registryProgramId);
      assert.equal(result.relayer, "DevnetArgusRelayer1111111111111111111111111");
      assert.equal(result.proofRecord.relayer, result.relayer);
      assert.equal(result.feePayer, result.relayer);
      assert.equal(result.proofRecord.status, "superseded");
      assert.equal(result.proofRecord.relayerAuthorized, false);
      assert.equal(result.sponsoredGas, false);
    },
  );
}

async function acceptsKotlinCanonicalEvidenceNumbers() {
  clearCaptureSessions();
  const kotlinProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildKotlinNumberDeviceIntegrityJson(proof),
  });
  authorizeProofSession(kotlinProof);

  const result = await registerProof(buildRequest(kotlinProof));

  assert.equal(result.proofId, kotlinProof.proofId);
  assert.equal(result.proofRecord.status, "superseded");
}

async function acceptsKotlinCanonicalControlEscapes() {
  clearCaptureSessions();
  const kotlinProof = rewriteProofEvidence(proof, {
    metadataJson: "{\"description\":\"line\\b\\f\\n\\r\\tend\"}",
  });
  authorizeProofSession(kotlinProof);

  const result = await registerProof(buildRequest(kotlinProof));

  assert.equal(result.proofId, kotlinProof.proofId);
  assert.equal(result.proofRecord.status, "superseded");
}

async function acceptsFiniteAndroidSensorNumberLexemes() {
  clearCaptureSessions();
  const androidProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildRawFloatToStringDeviceIntegrityJson(proof),
  });
  authorizeProofSession(androidProof);

  const result = await registerProof(buildRequest(androidProof));

  assert.equal(result.proofId, androidProof.proofId);
  assert.equal(result.proofRecord.status, "superseded");
}

async function acceptsVerifierAllowlistedBasePath() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(["https://verify.argus.dev/brand/"], async () => {
    const result = await registerProof({
      ...buildRequest(proof),
      verifierBaseUrl: "https://verify.argus.dev/brand",
    });

    assert.equal(result.verificationUrl, `https://verify.argus.dev/brand/proof/${proof.proofId}`);
  });
}

async function acceptsVerifierAllowlistedEncodedSeparatorBasePath() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(["https://verify.argus.dev/brand%2fregion/"], async () => {
    const result = await registerProof({
      ...buildRequest(proof),
      verifierBaseUrl: "https://verify.argus.dev/brand%2fregion",
    });

    assert.equal(result.verificationUrl, `https://verify.argus.dev/brand%2fregion/proof/${proof.proofId}`);
  });
}

async function rejectsUnauthorizedCaptureSessionPartner() {
  clearCaptureSessions();

  assert.throws(
    () =>
      openRelayerCaptureSession({
        appIdentityHash: proof.appIdentityHash,
        partnerId: "attacker-partner",
        useCase: proof.useCase,
      }),
    /partnerId is not authorized by this relayer/,
  );
}

async function rejectsUnauthorizedCaptureSessionAppIdentity() {
  clearCaptureSessions();

  assert.throws(
    () =>
      openRelayerCaptureSession({
        appIdentityHash: "5".repeat(64),
        partnerId: proof.partnerId,
        useCase: proof.useCase,
      }),
    /appIdentityHash is not authorized for partnerId/,
  );
}

async function rejectsRegistrationPartnerAllowlistBypass() {
  clearCaptureSessions();
  authorizeProofSession(proof, { partnerId: "attacker-partner" });

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        partnerId: "attacker-partner",
        partnerIdHash: sha256Hex("attacker-partner"),
      }),
    /partnerId is not authorized by this relayer/,
  );
}

async function rejectsSolanaModeDefaultPartnerPolicy() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withSolanaModeWithoutPartnerPolicy(async () => {
    await assert.rejects(
      () => registerProof(buildRequest(proof)),
      /ARGUS_PARTNER_APP_ALLOWLIST is required outside the demo relayer/,
    );
  });
}

async function rejectsProductionDefaultPartnerPolicy() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntimeWithoutPartnerPolicy(async () => {
    await assert.rejects(
      () => registerProof(buildRequest(proof)),
      /ARGUS_PARTNER_APP_ALLOWLIST is required outside the demo relayer/,
    );
  });
}

async function rejectsCaseVariantProductionDefaultPartnerPolicy() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntimeWithoutPartnerPolicy(async () => {
    await assert.rejects(
      () => registerProof(buildRequest(proof)),
      /ARGUS_PARTNER_APP_ALLOWLIST is required outside the demo relayer/,
    );
  }, "Production ");
}

async function rejectsProductionWithoutSolanaModeBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntimeWithoutSolanaMode(async () => {
    await withPartnerAllowlist(
      [
        {
          appIdentityHashes: [proof.appIdentityHash],
          partnerId: proof.partnerId,
          useCases: [proof.useCase],
        },
      ],
      async () => {
        await assert.rejects(
          () => registerProof(buildRequest(proof)),
          /ARGUS_RELAYER_MODE=solana is required for production registration/,
        );
      },
    );
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsCaseVariantProductionWithoutSolanaModeBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntimeWithoutSolanaMode(async () => {
    await withPartnerAllowlist(
      [
        {
          appIdentityHashes: [proof.appIdentityHash],
          partnerId: proof.partnerId,
          useCases: [proof.useCase],
        },
      ],
      async () => {
        await assert.rejects(
          () => registerProof(buildRequest(proof)),
          /ARGUS_RELAYER_MODE=solana is required for production registration/,
        );
      },
    );
  }, "Production ");

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsUnsupportedRelayerModeBeforeDemoFallback() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withUnsupportedRelayerMode(async () => {
    await withPartnerAllowlist(
      [
        {
          appIdentityHashes: [proof.appIdentityHash],
          partnerId: proof.partnerId,
          useCases: [proof.useCase],
        },
      ],
      async () => {
        await assert.rejects(
          () => registerProof(buildRequest(proof)),
          /ARGUS_RELAYER_MODE must be either demo or solana/,
        );
      },
    );
  });

  await withDemoRelayerMode(async () => {
    const result = await registerProof(buildRequest(proof));
    assert.equal(result.proofId, proof.proofId);
  });
}

async function rejectsUnsupportedRelayerModeDefaultCaptureSessionPolicy() {
  clearCaptureSessions();

  await withUnsupportedRelayerMode(async () => {
    assert.throws(
      () =>
        openRelayerCaptureSession({
          appIdentityHash: proof.appIdentityHash,
          partnerId: proof.partnerId,
          useCase: proof.useCase,
        }),
      /ARGUS_PARTNER_APP_ALLOWLIST is required outside the demo relayer/,
    );
  });
}

async function rejectsHashOnlyRequest() {
  await assert.rejects(
    () =>
      registerProof({
        proofId: proof.proofId,
        manifestHash: proof.manifestHash,
        imageHash: proof.imageHash,
      }),
    /partnerId is required/,
  );
}

async function rejectsUnknownSessionNonce() {
  clearCaptureSessions();

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session was not opened by the relayer/,
  );
}

async function rejectsReusedSessionNonce() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await registerProof(buildRequest(proof));

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session was already consumed/,
  );
}

async function rejectsDuplicateSessionAuthorizationReset() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  assert.throws(
    () => authorizeProofSession(proof),
    /capture session already exists/,
  );
}

async function rejectsOversizedCaptureSessionAuthorization() {
  clearCaptureSessions();

  assert.throws(
    () =>
      authorizeCaptureSession({
        appIdentityHash: proof.appIdentityHash,
        captureSessionId: oversizedCaptureSessionId(),
        nonce: proof.nonce,
        partnerId: proof.partnerId,
        useCase: proof.useCase,
      }),
    /captureSessionId exceeds relayer JSON text limit/,
  );
}

async function rejectsNonFiniteSessionExpiry() {
  clearCaptureSessions();

  assert.throws(
    () => authorizeProofSession(proof, { expiresAtMs: Number.POSITIVE_INFINITY }),
    /expiresAtMs must be a positive safe integer/,
  );

  assert.throws(
    () => authorizeProofSession(proof, { expiresAtMs: Number.NaN }),
    /expiresAtMs must be a positive safe integer/,
  );
}

async function rejectsInvalidSessionTtl() {
  clearCaptureSessions();

  assert.throws(
    () =>
      openCaptureSession({
        appIdentityHash: proof.appIdentityHash,
        nowMs: Date.now(),
        partnerId: proof.partnerId,
        ttlMs: Number.POSITIVE_INFINITY,
        useCase: proof.useCase,
      }),
    /ttlMs must be a positive safe integer/,
  );
}

async function rejectsExpiredSessionNonce() {
  clearCaptureSessions();
  authorizeProofSession(proof, { expiresAtMs: Date.now() - 1 });

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session expired/,
  );
}

async function rejectsSessionPartnerMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof, { partnerId: "attacker-partner" });

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session partnerId does not match/,
  );
}

async function rejectsSessionUseCaseMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof, { useCase: "insurance_claim" });

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session useCase does not match/,
  );
}

async function rejectsSessionAppIdentityMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof, { appIdentityHash: "5".repeat(64) });

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session app identity does not match/,
  );
}

async function rejectsManifestHashMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), manifestHash: "1".repeat(64) }),
    /manifestHash does not match canonicalManifestJson/,
  );
}

async function rejectsImageHashMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), imageHash: "2".repeat(64) }),
    /manifest image_sha256 does not match request/,
  );
}

async function rejectsProofIdMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), proofId: "3".repeat(64) }),
    /proofId does not match canonicalManifestJson/,
  );
}

async function rejectsProofIdThatOmitsNonce() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        proofId: deriveProofIdWithoutNonce(proof.manifestHash, proof.imageHash),
      }),
    /proofId does not match canonicalManifestJson/,
  );
}

async function rejectsUppercaseProofIdBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), proofId: "A".repeat(64) }),
    /proofId must be a canonical lowercase non-zero 32-byte hex string/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsManifestNonceMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const manifest = {
    ...proof.manifest,
    nonce: "6".repeat(64),
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, manifest.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /manifest nonce does not match sessionNonce/,
  );
}

async function rejectsDuplicateKeyManifestJson() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const canonicalManifestJson = proof.canonicalManifestJson.replace(
    `"proof_level":"app_capture"`,
    `"proof_level":"demo","proof_level":"app_capture"`,
  );
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /canonicalManifestJson is not a canonical Argus manifest/,
  );
}

async function rejectsNonFiniteManifestNumber() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const canonicalManifestJson = proof.canonicalManifestJson.replace(
    `"captured_at_ms":${proof.manifest.captured_at_ms}`,
    `"captured_at_ms":1e999`,
  );
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /canonicalManifestJson is not a canonical Argus manifest/,
  );
}

async function rejectsFutureCaptureTimestamp() {
  clearCaptureSessions();
  const futureProof = rewriteProofCaptureTimestamp(proof, Date.now() + 60_000);
  authorizeProofSession(futureProof);

  await assert.rejects(
    () => registerProof(buildRequest(futureProof)),
    /manifest captured_at_ms cannot be after relayer receipt time/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(futureProof)),
    /capture session was already consumed/,
  );
}

async function rejectsNonCanonicalManifestWithExtraClaim() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const manifest = {
    ...proof.manifest,
    physical_scene_truth: true,
  };
  const canonicalManifestJson = JSON.stringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /canonicalManifestJson is not a canonical Argus manifest/,
  );
}

async function rejectsNonCanonicalEvidenceJson() {
  clearCaptureSessions();
  const cameraEvidenceJson = [
    "{",
    `"captureSurface":"android-native-camera-stub",`,
    `"captureSurface":"native_android_camera",`,
    `"cameraMetadata":true,`,
    `"capturedAtMs":${proof.manifest.captured_at_ms},`,
    `"noGalleryImport":true`,
    "}",
  ].join("");
  const ambiguousProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  authorizeProofSession(ambiguousProof);

  await assert.rejects(
    () => registerProof(buildRequest(ambiguousProof)),
    /cameraEvidenceJson must be canonical JSON/,
  );
}

async function acceptsFiniteSensorNumberTrailingZeros() {
  clearCaptureSessions();
  const deviceIntegrityJson = buildKotlinNumberDeviceIntegrityJson(proof).replace("9.81", "9.810");
  const androidProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  authorizeProofSession(androidProof);

  const result = await registerProof(buildRequest(androidProof));

  assert.equal(result.proofId, androidProof.proofId);
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsCameraEvidenceDecimalCapturedAtMs() {
  clearCaptureSessions();
  const cameraEvidenceJson = proof.cameraEvidenceJson.replace(
    `"capturedAtMs":${proof.manifest.captured_at_ms}`,
    `"capturedAtMs":${proof.manifest.captured_at_ms}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /cameraEvidenceJson capturedAtMs must be encoded as a canonical integer/,
  );
}

async function rejectsCameraEvidenceDecimalCollectedAtMs() {
  clearCaptureSessions();
  const collectedAtMs = proof.manifest.captured_at_ms + 250;
  const cameraEvidenceJson = proof.cameraEvidenceJson.replace(
    `"collectedAtMs":${collectedAtMs}`,
    `"collectedAtMs":${collectedAtMs}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /cameraEvidenceJson collectedAtMs must be encoded as a canonical integer/,
  );
}

async function rejectsCameraEvidenceDecimalCapturedFileBytes() {
  clearCaptureSessions();
  const capturedFileBytes = decodedByteLength(proof.photoBytesBase64);
  const cameraEvidenceJson = proof.cameraEvidenceJson.replace(
    `"capturedFileBytes":${capturedFileBytes}`,
    `"capturedFileBytes":${capturedFileBytes}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { cameraEvidenceJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /cameraEvidenceJson capturedFileBytes must be encoded as a canonical integer/,
  );
}

async function rejectsMotionEvidenceDecimalWindow() {
  clearCaptureSessions();
  const deviceIntegrityJson = proof.deviceIntegrityJson.replace(
    `"sampleWindowMs":180`,
    `"sampleWindowMs":180.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /deviceIntegrityJson motionSnapshot.sampleWindowMs must be encoded as a canonical integer/,
  );
}

async function rejectsMotionEvidenceDecimalSampledAt() {
  clearCaptureSessions();
  const deviceIntegrityJson = proof.deviceIntegrityJson.replace(
    `"sampledAtMs":${proof.manifest.captured_at_ms}`,
    `"sampledAtMs":${proof.manifest.captured_at_ms}.0`,
  );
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /deviceIntegrityJson motionSnapshot.sampledAtMs must be encoded as a canonical integer/,
  );
}

async function rejectsNonFiniteEvidenceJson() {
  clearCaptureSessions();

  const deviceIntegrityJson = proof.deviceIntegrityJson.replace("0.01", "1e999");
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /deviceIntegrityJson must be canonical JSON/,
  );
}

async function rejectsEvidenceJsonWithUncommittedPadding() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        cameraEvidenceJson: `\n${proof.cameraEvidenceJson}\n`,
      }),
    /cameraEvidenceJson does not match manifest commitment/,
  );
}

async function rejectsOversizedCanonicalManifestJsonBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson: oversizedCanonicalManifestJson(),
      }),
    /canonicalManifestJson exceeds relayer JSON text limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsOversizedMetadataJsonBeforeConsumingSession() {
  clearCaptureSessions();
  const oversizedProof = rewriteProofEvidence(proof, {
    metadataJson: oversizedMetadataJson(),
  });
  authorizeProofSession(oversizedProof);

  await assert.rejects(
    () => registerProof(buildRequest(oversizedProof)),
    /metadataJson exceeds relayer JSON text limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsOversizedCameraEvidenceJsonBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        cameraEvidenceJson: oversizedEvidenceJson(),
      }),
    /cameraEvidenceJson exceeds relayer JSON text limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsOversizedDeviceIntegrityJsonBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        deviceIntegrityJson: oversizedEvidenceJson(),
      }),
    /deviceIntegrityJson exceeds relayer JSON text limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsOversizedCaptureSessionIdBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        captureSessionId: oversizedCaptureSessionId(),
      }),
    /captureSessionId exceeds relayer JSON text limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsOversizedVerifierBaseUrlBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: oversizedVerifierBaseUrl(),
      }),
    /verifierBaseUrl exceeds relayer JSON text limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsPartnerHashMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), partnerIdHash: "4".repeat(64) }),
    /partnerIdHash does not match partnerId/,
  );
}

async function rejectsManifestPartnerIdMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const manifest = {
    ...proof.manifest,
    partner_id_hash: "7".repeat(64),
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /manifest partner_id_hash does not match request/,
  );
}

async function rejectsManifestUseCaseMismatch() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const manifest = {
    ...proof.manifest,
    use_case: "insurance_claim",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
      }),
    /manifest use_case does not match request/,
  );
}

async function rejectsUntrustedVerifierBaseUrl() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: "https://verify.argus.dev.evil.example",
      }),
    /verifierBaseUrl is not authorized by this relayer/,
  );
}

async function rejectsVerifierBaseUrlWithQueryBypass() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: `https://verify.argus.dev/proof/${proof.proofId}?next=https://evil.example`,
      }),
    /verifierBaseUrl must not include credentials, query, or fragment/,
  );
}

async function rejectsVerifierBaseUrlWithFragmentBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: `https://verify.argus.dev#proof/${proof.proofId}`,
      }),
    /verifierBaseUrl must not include credentials, query, or fragment/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsVerifierBaseUrlWithPathBypass() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: "https://verify.argus.dev/continue",
      }),
    /verifierBaseUrl is not authorized by this relayer/,
  );
}

async function rejectsVerifierBaseUrlWithEncodedPathTraversal() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: "https://verify.argus.dev/brand/%2e%2e",
      }),
    /verifierBaseUrl must not contain path traversal segments/,
  );
}

async function rejectsVerifierBaseUrlWithEncodedSeparatorTraversal() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(["https://verify.argus.dev/brand%2f.."], async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          verifierBaseUrl: "https://verify.argus.dev/brand%2f..",
        }),
      /verifierBaseUrl must not contain path traversal segments/,
    );
  });
}

async function rejectsVerifierBaseUrlWithBackslashTraversal() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(["https://verify.argus.dev/evil"], async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          verifierBaseUrl: "https://verify.argus.dev\\..\\evil",
        }),
      /verifierBaseUrl must not contain path traversal segments/,
    );
  });
}

async function rejectsVerifierBaseUrlWithSchemeBackslashTraversal() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(["https://verify.argus.dev/evil"], async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          verifierBaseUrl: "https:\\verify.argus.dev\\..\\evil",
        }),
      /verifierBaseUrl must not contain path traversal segments/,
    );
  });
}

async function rejectsVerifierBaseUrlWithoutAuthorityBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        verifierBaseUrl: "https:verify.argus.dev",
      }),
    /verifierBaseUrl must include an explicit URL authority/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsProductionLoopbackVerifierBaseUrl() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntime(async () => {
    await withPartnerAllowlist(
      [
        {
          appIdentityHashes: [proof.appIdentityHash],
          partnerId: proof.partnerId,
          useCases: [proof.useCase],
        },
      ],
      async () => {
        await assert.rejects(
          () =>
            registerProof({
              ...buildRequest(proof),
              verifierBaseUrl: "http://localhost:3000",
            }),
          /loopback verifierBaseUrl is only allowed outside production/,
        );
      },
    );
  });
}

async function rejectsCaseVariantProductionLoopbackVerifierBaseUrl() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntime(async () => {
    await withPartnerAllowlist(
      [
        {
          appIdentityHashes: [proof.appIdentityHash],
          partnerId: proof.partnerId,
          useCases: [proof.useCase],
        },
      ],
      async () => {
        await assert.rejects(
          () =>
            registerProof({
              ...buildRequest(proof),
              verifierBaseUrl: "http://localhost:3000",
            }),
          /loopback verifierBaseUrl is only allowed outside production/,
        );
      },
    );
  }, "Production ");
}

async function rejectsProductionHttpsLoopbackVerifierBaseUrlEvenWhenAllowlisted() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntime(async () => {
    await withVerifierAllowlist(["https://localhost:3443"], async () => {
      await withSolanaModeWithoutRpc(async () => {
        await assert.rejects(
          () =>
            registerProof({
              ...buildRequest(proof),
              verifierBaseUrl: "https://localhost:3443",
            }),
          /loopback verifierBaseUrl is only allowed outside production/,
        );
      });
    });
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsProductionHttps127RangeVerifierBaseUrlEvenWhenAllowlisted() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntime(async () => {
    await withVerifierAllowlist(["https://127.0.0.2:3443"], async () => {
      await withSolanaModeWithoutRpc(async () => {
        await assert.rejects(
          () =>
            registerProof({
              ...buildRequest(proof),
              verifierBaseUrl: "https://127.0.0.2:3443",
            }),
          /loopback verifierBaseUrl is only allowed outside production/,
        );
      });
    });
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsProductionIpv4MappedLoopbackVerifierBaseUrlEvenWhenAllowlisted() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntime(async () => {
    await withVerifierAllowlist(["https://[::ffff:127.0.0.1]:3443"], async () => {
      await withSolanaModeWithoutRpc(async () => {
        await assert.rejects(
          () =>
            registerProof({
              ...buildRequest(proof),
              verifierBaseUrl: "https://[::ffff:127.0.0.1]:3443",
            }),
          /loopback verifierBaseUrl is only allowed outside production/,
        );
      });
    });
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsProductionLoopbackVerifierAllowlistEntryBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withProductionRuntime(async () => {
    await withVerifierAllowlist(
      ["https://verify.argus.dev", "https://127.0.0.2:3443"],
      async () => {
        await withSolanaModeWithoutRpc(async () => {
          await assert.rejects(
            () => registerProof(buildRequest(proof)),
            /loopback verifierBaseUrl is only allowed outside production/,
          );
        });
      },
    );
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsDuplicateVerifierAllowlistEntryBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(
    ["https://verify.argus.dev", "https://verify.argus.dev/"],
    async () => {
      await assert.rejects(
        () => registerProof(buildRequest(proof)),
        /ARGUS_VERIFIER_BASE_URL_ALLOWLIST must not contain duplicate entries/,
      );
    },
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofId, proof.proofId);
}

async function rejectsInvalidEnvVerifierAllowlistEntry() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withVerifierAllowlist(["https://verify.argus.dev?next=https://evil.example"], async () => {
    await assert.rejects(
      () => registerProof(buildRequest(proof)),
      /verifierBaseUrl must not include credentials, query, or fragment/,
    );
  });
}

async function rejectsUnsupportedSchemaVersion() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), schemaVersion: 0 }),
    /schemaVersion is not supported by this relayer/,
  );
}

async function rejectsDemoProofLevel() {
  clearCaptureSessions();
  authorizeProofSession(demoProof);

  await assert.rejects(
    () => registerProof(buildRequest(demoProof)),
    /proofLevel is not supported by this relayer/,
  );
}

async function rejectsDemoCameraStubForAppCapture() {
  clearCaptureSessions();
  const stubProof = promoteToAppCaptureProof(demoProof, { allowDemoCameraStub: true });
  authorizeProofSession(stubProof);

  await assert.rejects(
    () => registerProof(buildRequest(stubProof)),
    /app_capture requires the Argus native Android camera surface/,
  );
}

async function rejectsMissingCameraEvidence() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), cameraEvidenceJson: "" }),
    /cameraEvidenceJson is required/,
  );
}

async function rejectsAppCaptureWithoutMotionEvidence() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const deviceIntegrityJson = JSON.stringify({
    appIdentityHash: proof.appIdentityHash,
    appIdentityHashPresent: true,
  });
  const manifest = {
    ...proof.manifest,
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
    proof_level: "app_capture",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        deviceIntegrityJson,
        manifestHash,
        proofId,
        proofLevel: "app_capture",
      }),
    /app_capture requires committed motion evidence/,
  );
}

async function rejectsAppCaptureWithoutCameraMetadata() {
  clearCaptureSessions();
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.captureSurface = "native_android_camera";
  delete cameraEvidence.cameraMetadata;
  const weakProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /app_capture requires committed camera metadata/,
  );
}

async function rejectsAppCaptureWithoutCapturedFileBytes() {
  clearCaptureSessions();
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  delete cameraEvidence.capturedFileBytes;
  const weakProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /cameraEvidenceJson must commit positive capturedFileBytes/,
  );
}

async function rejectsAppCaptureWithoutPhotoBytes() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () => registerProof({ ...buildRequest(proof), photoBytesBase64: "" }),
    /photoBytesBase64 is required/,
  );
}

async function rejectsAppCaptureWithMismatchedPhotoBytes() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        photoBytesBase64: sameLengthDifferentBase64(proof.photoBytesBase64),
      }),
    /photoBytesBase64 does not match imageHash/,
  );
}

async function consumesSessionAfterPhotoBytesValidationFailure() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        photoBytesBase64: sameLengthDifferentBase64(proof.photoBytesBase64),
      }),
    /photoBytesBase64 does not match imageHash/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session was already consumed/,
  );
}

async function rejectsAppCaptureWithMismatchedCapturedFileBytes() {
  clearCaptureSessions();
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.capturedFileBytes += 1;
  const weakProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /cameraEvidenceJson capturedFileBytes does not match photoBytesBase64/,
  );
}

async function acceptsLevel2HardwareFallbackEvidence() {
  clearCaptureSessions();
  const fallbackProof = rewriteProofAndroidEvidenceLevel2Fallback(proof);
  authorizeProofSession(fallbackProof);

  const result = await registerProof(buildRequest(fallbackProof));

  assert.equal(result.proofId, fallbackProof.proofId);
  assert.equal(result.proofRecord.proofLevel, "app_capture");
}

async function acceptsLevel3KeystoreEvidence() {
  clearCaptureSessions();
  const level3Proof = rewriteProofAndroidEvidence(proof, { level: 3 });
  authorizeProofSession(level3Proof);

  const result = await registerProof(buildRequest(level3Proof));

  assert.equal(result.proofId, level3Proof.proofId);
  assert.equal(result.proofRecord.proofLevel, "app_capture");
}

async function acceptsLevel3NativeCanonicalKeystoreEvidence() {
  clearCaptureSessions();
  const level3Proof = rewriteProofAndroidNativeCanonicalEvidence(proof);
  authorizeProofSession(level3Proof);

  const result = await registerProof(buildRequest(level3Proof));

  assert.equal(result.proofId, level3Proof.proofId);
  assert.equal(result.proofRecord.proofLevel, "app_capture");
}

async function acceptsLevel3WithPendingLevel4MaterialAfterRelayerRootValidation() {
  clearCaptureSessions();
  const level3Proof = rewriteProofAndroidEvidence(proof, {
    hardwareAttestation: "level4",
    level: 3,
  });
  authorizeProofSession(level3Proof);

  const result = await registerProof(buildRequest(level3Proof));
  const decision = validateAndroidEvidenceLevel({
    deviceIntegrity: JSON.parse(level3Proof.deviceIntegrityJson),
    manifest: level3Proof.manifest,
    request: buildRequest(level3Proof),
  });

  assert.equal(result.proofId, level3Proof.proofId);
  assert.equal(result.proofRecord.proofLevel, "app_capture");
  assert.equal(decision.acceptedLevel, 3);
  assert.equal(decision.evidenceLevel, "level_3_keystore_signature");
  assert.equal(decision.level4AttestationVerdict.acceptedLevel, 4);
  assert.equal(decision.level4AttestationVerdict.trustedAttestationRootValidated, true);
  assert.equal(result.deviceEvidenceSummary.evidenceLevel, "level_4_hardware_attestation");
  assert.equal(result.deviceEvidenceSummary.level4HardwareAttestation, true);
  assert.equal(result.deviceEvidenceSummary.relayerAcceptedAndroidEvidenceLevel, 4);
  assert.equal(result.deviceEvidenceSummary.trustedAttestationRootValidated, true);
  assert.equal(
    result.deviceEvidenceSummary.trustedAttestationRootFingerprintSha256,
    certificateSha256(LEVEL4_ATTESTATION_CERTIFICATE_PEM),
  );
}

async function acceptsLevel3WithPendingLevel4MaterialWithoutTrustedRootAsLevel3() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  delete process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  try {
    const level3Proof = rewriteProofAndroidEvidence(proof, {
      hardwareAttestation: "level4",
      level: 3,
    });
    authorizeProofSession(level3Proof);

    const result = await registerProof(buildRequest(level3Proof));

    assert.equal(result.proofId, level3Proof.proofId);
    assert.equal(result.proofRecord.proofLevel, "app_capture");
    assert.equal(result.deviceEvidenceSummary.evidenceLevel, "level_3_keystore_signature");
    assert.equal(result.deviceEvidenceSummary.level4HardwareAttestation, false);
    assert.equal(result.deviceEvidenceSummary.relayerAcceptedAndroidEvidenceLevel, 3);
    assert.equal(result.deviceEvidenceSummary.trustedAttestationRootConfigured, false);
    assert.equal(result.deviceEvidenceSummary.trustedAttestationRootValidated, false);
    assert.match(
      result.deviceEvidenceSummary.trustedAttestationRootValidationError,
      /configured Android attestation trust root/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function acceptsLevel3HardwareFallbackEvidence() {
  clearCaptureSessions();
  const level3Proof = rewriteProofAndroidEvidence(proof, {
    hardwareAttestation: hardwareUnsupportedFallback(3),
    level: 3,
  });
  authorizeProofSession(level3Proof);

  const result = await registerProof(buildRequest(level3Proof));
  const decision = validateAndroidEvidenceLevel({
    deviceIntegrity: JSON.parse(level3Proof.deviceIntegrityJson),
    manifest: level3Proof.manifest,
    request: buildRequest(level3Proof),
  });

  assert.equal(result.proofId, level3Proof.proofId);
  assert.equal(result.proofRecord.proofLevel, "app_capture");
  assert.equal(decision.acceptedLevel, 3);
  assert.equal(decision.evidenceLevel, "level_3_keystore_signature");
  assert.equal(decision.fallbackReason, "android_key_attestation_unavailable");
}

async function rejectsLevel3KeystoreSignatureMismatch() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    level: 3,
    tamperSignature: true,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /keystoreSignature does not verify signedPayloadJson/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /capture session was already consumed/,
  );
}

async function acceptsLevel4HardwareAttestationEvidence() {
  clearCaptureSessions();
  const level4Proof = rewriteProofAndroidEvidence(proof, {
    hardwareAttestation: "level4",
    level: 4,
  });
  authorizeProofSession(level4Proof);

  const result = await registerProof(buildRequest(level4Proof));
  const decision = validateAndroidEvidenceLevel({
    deviceIntegrity: JSON.parse(level4Proof.deviceIntegrityJson),
    manifest: level4Proof.manifest,
    request: buildRequest(level4Proof),
  });

  assert.equal(result.proofId, level4Proof.proofId);
  assert.equal(result.proofRecord.proofLevel, "app_capture");
  assert.equal(decision.acceptedLevel, 4);
  assert.equal(decision.evidenceLevel, "level_4_hardware_attestation");
  assert.equal(decision.hardwareSecurityClass, "trusted_environment");
  assert.equal(
    decision.trustedRootFingerprintSha256,
    certificateSha256(LEVEL4_ATTESTATION_CERTIFICATE_PEM),
  );
}

async function rejectsLevel4WithoutTrustedRoot() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  delete process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  try {
    const weakProof = rewriteProofAndroidEvidence(proof, {
      hardwareAttestation: "level4",
      level: 4,
    });
    authorizeProofSession(weakProof);

    await assert.rejects(
      () => registerProof(buildRequest(weakProof)),
      /Level 4 Android evidence requires configured Android attestation trust root/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function rejectsLevel4UntrustedRoot() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = "b".repeat(64);
  try {
    const weakProof = rewriteProofAndroidEvidence(proof, {
      hardwareAttestation: "level4",
      level: 4,
    });
    authorizeProofSession(weakProof);

    await assert.rejects(
      () => registerProof(buildRequest(weakProof)),
      /Level 4 Android attestation root is not trusted/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function rejectsLevel4PlaceholderCertificateChain() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    certificateChainPem: [PLACEHOLDER_CERTIFICATE_PEM],
    hardwareAttestation: "level4",
    level: 4,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /Level 4 Android evidence requires verifier-compatible certificate-chain material/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /capture session was already consumed/,
  );
}

async function rejectsLevel4CertificateWithoutAndroidKeyAttestationExtension() {
  clearCaptureSessions();
  const previousTrustedRoots = process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256;
  process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = certificateSha256(
    LEVEL4_NO_ANDROID_EXTENSION_CERTIFICATE_PEM,
  );
  try {
    const weakProof = rewriteProofAndroidEvidence(proof, {
      certificateChainPem: [LEVEL4_NO_ANDROID_EXTENSION_CERTIFICATE_PEM],
      hardwareAttestation: "level4",
      level: 4,
    });
    authorizeProofSession(weakProof);

    await assert.rejects(
      () => registerProof(buildRequest(weakProof)),
      /Level 4 Android evidence requires Android key attestation certificate extension/,
    );
  } finally {
    process.env.ARGUS_ANDROID_ATTESTATION_ROOT_SHA256 = previousTrustedRoots;
  }
}

async function rejectsLevel4ChallengeSessionMismatch() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    attestationChallengeHex: "f".repeat(64),
    hardwareAttestation: "level4",
    level: 4,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /Level 4 Android evidence requires hardware-backed attestation material/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /capture session was already consumed/,
  );
}

async function rejectsLevel4HardwareFallbackPromotion() {
  clearCaptureSessions();
  const weakProof = rewriteProofAndroidEvidence(proof, {
    hardwareAttestation: hardwareUnsupportedFallback(3),
    level: 4,
  });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /Level 4 Android evidence cannot use hardware attestation fallback/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /capture session was already consumed/,
  );
}

function rejectsDuplicateAndroidKeyAttestationExtensionOid() {
  const certificateDer = syntheticCertificateWithExtensions([
    syntheticX509Extension(ANDROID_KEY_ATTESTATION_EXTENSION_OID_DER),
    syntheticX509Extension(ANDROID_KEY_ATTESTATION_EXTENSION_OID_DER),
  ]);

  assert.throws(
    () =>
      __androidEvidencePolicyTestHooks.findX509Extension(
        certificateDer,
        ANDROID_KEY_ATTESTATION_EXTENSION_OID,
      ),
    /certificate contains duplicate Android key attestation extension/,
  );
}

function rejectsExplicitFalseExtensionCriticalFlag() {
  const certificateDer = syntheticCertificateWithExtensions([
    syntheticX509Extension(ANDROID_KEY_ATTESTATION_EXTENSION_OID_DER, {
      criticalFlagValue: Buffer.from([0x00]),
    }),
  ]);

  assert.throws(
    () =>
      __androidEvidencePolicyTestHooks.findX509Extension(
        certificateDer,
        ANDROID_KEY_ATTESTATION_EXTENSION_OID,
      ),
    /certificate extension critical flag is invalid/,
  );
}

async function rejectsAppCaptureWithNonCanonicalPhotoBytes() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        photoBytesBase64: `${proof.photoBytesBase64}\n`,
      }),
    /photoBytesBase64 must be canonical base64/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsAppCaptureWithOversizedPhotoBytesBeforeConsumingSession() {
  clearCaptureSessions();
  authorizeProofSession(proof);
  const photoBytesBase64 = jpegBytesOfLength(MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1).toString(
    "base64",
  );

  assert.equal(photoBytesBase64.length, MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH);
  assert.equal(Buffer.from(photoBytesBase64, "base64").byteLength, MAX_NATIVE_CAPTURE_PHOTO_BYTES + 1);
  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        photoBytesBase64,
      }),
    /photoBytesBase64 exceeds native capture photo byte limit/,
  );

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsAppCaptureWithNonJpegPhotoBytes() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        photoBytesBase64: Buffer.alloc(decodedByteLength(proof.photoBytesBase64), 0x61).toString("base64"),
      }),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsAppCaptureWithMalformedJpegSegment() {
  clearCaptureSessions();
  const malformedProof = rewriteProofPhotoBytes(proof, malformedSofJpegBytes());
  authorizeProofSession(malformedProof);

  await assert.rejects(
    () => registerProof(buildRequest(malformedProof)),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );

  await assert.rejects(
    () => registerProof(buildRequest(malformedProof)),
    /capture session was already consumed/,
  );
}

async function rejectsAppCaptureWithMismatchedJpegComponents() {
  clearCaptureSessions();
  const malformedProof = rewriteProofPhotoBytes(proof, mismatchedComponentJpegBytes());
  authorizeProofSession(malformedProof);

  await assert.rejects(
    () => registerProof(buildRequest(malformedProof)),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsAppCaptureWithScanComponentMissingFromFrame() {
  clearCaptureSessions();
  const malformedProof = rewriteProofPhotoBytes(proof, scanComponentMissingFromFrameJpegBytes());
  authorizeProofSession(malformedProof);

  await assert.rejects(
    () => registerProof(buildRequest(malformedProof)),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsAppCaptureWithRedefinedFrameComponents() {
  clearCaptureSessions();
  const malformedProof = rewriteProofPhotoBytes(proof, duplicateStartOfFrameJpegBytes());
  authorizeProofSession(malformedProof);

  await assert.rejects(
    () => registerProof(buildRequest(malformedProof)),
    /photoBytesBase64 must pass the native-capture JPEG-like byte policy/,
  );
}

async function rejectsAppCaptureWithMotionPresenceFlagOnly() {
  clearCaptureSessions();
  const deviceIntegrityJson = stableStringify({
    appIdentityHash: proof.appIdentityHash,
    appIdentityHashPresent: true,
    motionSnapshotPresent: true,
  });
  const weakProof = rewriteProofEvidence(proof, { deviceIntegrityJson });
  authorizeProofSession(weakProof);

  await assert.rejects(
    () => registerProof(buildRequest(weakProof)),
    /app_capture requires committed motion evidence/,
  );
}

async function rejectsAppCaptureWithStaleCameraEvidence() {
  clearCaptureSessions();
  const cameraEvidence = JSON.parse(proof.cameraEvidenceJson);
  cameraEvidence.collectedAtMs = proof.manifest.captured_at_ms + 10_000;
  cameraEvidence.captureEvidenceDelayMs = 10_000;
  const staleProof = rewriteProofEvidence(proof, {
    cameraEvidenceJson: stableStringify(cameraEvidence),
  });
  authorizeProofSession(staleProof);

  await assert.rejects(
    () => registerProof(buildRequest(staleProof)),
    /camera evidence must be collected near shutter time/,
  );
}

async function rejectsAppCaptureWithStaleMotionSnapshot() {
  clearCaptureSessions();
  const staleProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildDeviceIntegrityJson(proof, {
      sampledAtMs: proof.manifest.captured_at_ms - 10_000,
    }),
  });
  authorizeProofSession(staleProof);

  await assert.rejects(
    () => registerProof(buildRequest(staleProof)),
    /motion evidence must be captured near shutter time/,
  );
}

async function rejectsAppCaptureWithWideMotionWindow() {
  clearCaptureSessions();
  const wideProof = rewriteProofEvidence(proof, {
    deviceIntegrityJson: buildDeviceIntegrityJson(proof, {
      sampleWindowMs: 10_000,
    }),
  });
  authorizeProofSession(wideProof);

  await assert.rejects(
    () => registerProof(buildRequest(wideProof)),
    /motion evidence sample window is too wide/,
  );
}

async function rejectsDeviceAttestedOverclaim() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  const manifest = {
    ...proof.manifest,
    proof_level: "device_attested",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, proof.imageHash, proof.nonce);

  await assert.rejects(
    () =>
      registerProof({
        ...buildRequest(proof),
        canonicalManifestJson,
        manifestHash,
        proofId,
        proofLevel: "device_attested",
      }),
    /proofLevel is not supported by this relayer/,
  );
}

async function consumesSessionAfterSolanaWrapperValidationFailure() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withSolanaModeWithoutRpc(async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          photoBytesBase64: sameLengthDifferentBase64(proof.photoBytesBase64),
        }),
      /photoBytesBase64 does not match imageHash/,
    );
  });

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session was already consumed/,
  );
}

async function consumesSessionAfterSolanaWrapperVerifierBaseUrlTraversal() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withSolanaModeWithoutRpc(async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          verifierBaseUrl: "https:\\verify.argus.dev\\..\\evil",
        }),
      /verifierBaseUrl must not contain path traversal segments/,
    );
  });

  await assert.rejects(
    () => registerProof(buildRequest(proof)),
    /capture session was already consumed/,
  );
}

async function rejectsOversizedVerifierBaseUrlBeforeConsumingSessionInSolanaWrapper() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withSolanaModeWithoutRpc(async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          verifierBaseUrl: oversizedVerifierBaseUrl(),
        }),
      /verifierBaseUrl exceeds relayer JSON text limit/,
    );
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function rejectsVerifierBaseUrlWithoutAuthorityBeforeConsumingSessionInSolanaWrapper() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withSolanaModeWithoutRpc(async () => {
    await assert.rejects(
      () =>
        registerProof({
          ...buildRequest(proof),
          verifierBaseUrl: "https:verify.argus.dev",
        }),
      /verifierBaseUrl must include an explicit URL authority/,
    );
  });

  const result = await registerProof(buildRequest(proof));
  assert.equal(result.proofRecord.status, "superseded");
}

async function doesNotConsumeSessionWhenSolanaWrapperCannotSubmit() {
  clearCaptureSessions();
  authorizeProofSession(proof);

  await withSolanaModeWithoutRpc(async () => {
    await assert.rejects(
      () => registerProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );

    await assert.rejects(
      () => registerProof(buildRequest(proof)),
      /SOLANA_RPC_URL or ANCHOR_PROVIDER_URL is required/,
    );
  });
}

function buildRequest(proofBundle) {
  return {
    proofId: proofBundle.proofId,
    manifestHash: proofBundle.manifestHash,
    imageHash: proofBundle.imageHash,
    partnerIdHash: proofBundle.partnerIdHash,
    partnerId: proofBundle.partnerId,
    useCase: proofBundle.useCase,
    verifierBaseUrl: "https://verify.argus.dev",
    canonicalManifestJson: proofBundle.canonicalManifestJson,
    metadataJson: proofBundle.metadataJson,
    cameraEvidenceJson: proofBundle.cameraEvidenceJson,
    deviceIntegrityJson: proofBundle.deviceIntegrityJson,
    photoBytesBase64: proofBundle.photoBytesBase64,
    captureSessionId: proofBundle.captureSessionId,
    sessionNonce: proofBundle.nonce,
    appIdentityHash: proofBundle.appIdentityHash,
    proofLevel: proofBundle.proofLevel,
    captureTimestamp: proofBundle.manifest.captured_at_ms,
  };
}

function authorizeProofSession(proofBundle, overrides = {}) {
  authorizeCaptureSession({
    appIdentityHash: overrides.appIdentityHash ?? proofBundle.appIdentityHash,
    captureSessionId: proofBundle.captureSessionId,
    expiresAtMs: overrides.expiresAtMs,
    nonce: proofBundle.nonce,
    partnerId: overrides.partnerId ?? proofBundle.partnerId,
    useCase: overrides.useCase ?? proofBundle.useCase,
  });
}

function promoteToAppCaptureProof(proofBundle, { allowDemoCameraStub = false } = {}) {
  const photoBytesBase64 = sampleJpegBytes().toString("base64");
  const imageHash = sha256Hex(Buffer.from(photoBytesBase64, "base64"));
  const photoProofBundle = {
    ...proofBundle,
    imageHash,
    photoBytesBase64,
  };
  const cameraEvidenceJson = buildCameraEvidenceJson(photoProofBundle, { allowDemoCameraStub });
  const deviceIntegrityJson = buildDeviceIntegrityJson(photoProofBundle);
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
    image_sha256: imageHash,
    proof_level: "app_capture",
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    deviceIntegrityJson,
    imageHash,
    integrityLevel: "app_capture",
    manifest,
    manifestHash,
    photoBytesBase64,
    proofId,
    proofLevel: "app_capture",
  };
}

function rewriteProofEvidence(
  proofBundle,
  {
    cameraEvidenceJson = proofBundle.cameraEvidenceJson,
    deviceIntegrityJson = proofBundle.deviceIntegrityJson,
    metadataJson = proofBundle.metadataJson,
  } = {},
) {
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
    metadata_commitment: sha256Hex(metadataJson),
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    deviceIntegrityJson,
    manifest,
    manifestHash,
    metadataJson,
    proofId,
  };
}

function rewriteProofCaptureTimestamp(proofBundle, capturedAtMs) {
  const cameraEvidence = JSON.parse(proofBundle.cameraEvidenceJson);
  cameraEvidence.capturedAtMs = capturedAtMs;
  cameraEvidence.collectedAtMs = capturedAtMs + 250;
  cameraEvidence.captureEvidenceDelayMs = 250;
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.motionSnapshot = {
    ...deviceIntegrity.motionSnapshot,
    sampledAtMs: capturedAtMs,
  };
  const cameraEvidenceJson = stableStringify(cameraEvidence);
  const deviceIntegrityJson = stableStringify(deviceIntegrity);
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    captured_at_ms: capturedAtMs,
    device_integrity_commitment: sha256Hex(deviceIntegrityJson),
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    deviceIntegrityJson,
    manifest,
    manifestHash,
    proofId,
  };
}

function rewriteProofAndroidEvidence(proofBundle, {
  attestationChallengeHex,
  certificateChainPem,
  hardwareAttestation,
  level,
  tamperSignature = false,
}) {
  if (hardwareAttestation === "level4" && attestationChallengeHex === undefined) {
    proofBundle = rewriteProof(proofBundle, { nonce: LEVEL4_ATTESTATION_CHALLENGE_HEX });
  }

  const { privateKey, publicKey } = hardwareAttestation === "level4"
    ? {
        privateKey: LEVEL4_ATTESTED_PRIVATE_KEY_PEM,
        publicKey: createPublicKey(LEVEL4_ATTESTED_PRIVATE_KEY_PEM),
      }
    : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = level;
  delete deviceIntegrity.keystoreSignature;

  if (hardwareAttestation === "level4") {
    deviceIntegrity.hardwareAttestation = level4HardwareAttestation(
      proofBundle,
      publicKeyPem,
      certificateChainPem,
      attestationChallengeHex,
    );
  } else if (hardwareAttestation) {
    deviceIntegrity.hardwareAttestation = hardwareAttestation;
  } else {
    delete deviceIntegrity.hardwareAttestation;
  }

  const signedPayloadJson = buildAndroidKeystoreSignedPayloadJson({
    deviceIntegrity,
    manifest: proofBundle.manifest,
    request: buildRequest(proofBundle),
  });
  const signatureBase64 = signAndroidEvidencePayload(privateKey, signedPayloadJson);
  deviceIntegrity.keystoreSignature = {
    algorithm: "SHA256withECDSA",
    publicKeyPem,
    signatureBase64: tamperSignature ? sameLengthDifferentBase64(signatureBase64) : signatureBase64,
    signedPayloadJson,
  };

  return rewriteProofEvidence(proofBundle, {
    deviceIntegrityJson: stableStringify(deviceIntegrity),
  });
}

function rewriteProofAndroidNativeCanonicalEvidence(proofBundle) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = 3;
  deviceIntegrity.hardwareAttestation = hardwareUnsupportedFallback(3);
  const signedPayloadJson = buildNativeKeystoreBindingJson(proofBundle);
  deviceIntegrity.keystoreSignature = {
    algorithm: "SHA256withECDSA",
    publicKeyPem,
    publicKeySpkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    signatureBase64: signAndroidEvidencePayload(privateKey, signedPayloadJson),
    signedPayloadJson,
  };

  return rewriteProofEvidence(proofBundle, {
    deviceIntegrityJson: stableStringify(deviceIntegrity),
  });
}

function rewriteProofAndroidEvidenceLevel2Fallback(proofBundle) {
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = 2;
  deviceIntegrity.hardwareAttestation = hardwareUnsupportedFallback(2);
  delete deviceIntegrity.keystoreSignature;

  return rewriteProofEvidence(proofBundle, {
    deviceIntegrityJson: stableStringify(deviceIntegrity),
  });
}

function buildNativeKeystoreBindingJson(proofBundle) {
  return [
    "{",
    "\"schema\":\"argus.keystore.binding.v1\",",
    `"partnerId":${JSON.stringify(proofBundle.partnerId)},`,
    `"useCase":${JSON.stringify(proofBundle.useCase)},`,
    `"metadataCommitment":${JSON.stringify(proofBundle.manifest.metadata_commitment)},`,
    `"cameraEvidenceCommitment":${JSON.stringify(proofBundle.manifest.camera_evidence_commitment)},`,
    `"appIdentityHash":${JSON.stringify(proofBundle.appIdentityHash)},`,
    `"captureSessionId":${JSON.stringify(proofBundle.captureSessionId)},`,
    `"sessionNonce":${JSON.stringify(proofBundle.nonce)},`,
    `"capturedAtMs":${proofBundle.manifest.captured_at_ms},`,
    `"imageHash":${JSON.stringify(proofBundle.imageHash)}`,
    "}",
  ].join("");
}

function signAndroidEvidencePayload(privateKey, signedPayloadJson) {
  const signer = createSign("sha256");
  signer.update(signedPayloadJson);
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

function certificateSha256(certificatePem) {
  return createHash("sha256").update(new X509Certificate(normalizePemBlock(certificatePem)).raw).digest("hex");
}

function syntheticCertificateWithExtensions(extensions) {
  const extensionsSequence = derSequence(...extensions);
  const extensionsWrapper = derElement(0xa3, extensionsSequence);
  const tbsCertificate = derSequence(extensionsWrapper);
  return derSequence(tbsCertificate);
}

function syntheticX509Extension(oidDer, { criticalFlagValue, extnValue = derSequence() } = {}) {
  const fields = [derElement(0x06, oidDer)];
  if (criticalFlagValue) {
    fields.push(derElement(0x01, criticalFlagValue));
  }
  fields.push(derElement(0x04, extnValue));
  return derSequence(...fields);
}

function derSequence(...children) {
  return derElement(0x30, Buffer.concat(children));
}

function derElement(tag, value) {
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

function derLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function normalizePemBlock(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function hardwareUnsupportedFallback(level) {
  return {
    fallbackLevel: level,
    reason: "android_key_attestation_unavailable",
    supported: false,
  };
}

function level4HardwareAttestation(
  proofBundle,
  publicKeyPem,
  certificateChainPem,
  attestationChallengeHex,
) {
  return {
    attestationChallengeHex: attestationChallengeHex ?? proofBundle.nonce,
    certificateChainPem: certificateChainPem ?? [LEVEL4_ATTESTATION_CERTIFICATE_PEM],
    hardwareBacked: true,
    publicKeyPem,
    supported: true,
  };
}

function rewriteProofPhotoBytes(proofBundle, imageBytes) {
  const photoBytesBase64 = Buffer.from(imageBytes).toString("base64");
  const imageHash = sha256Hex(imageBytes);
  const cameraEvidence = JSON.parse(proofBundle.cameraEvidenceJson);
  cameraEvidence.capturedFileBytes = imageBytes.length;
  const cameraEvidenceJson = stableStringify(cameraEvidence);
  const manifest = {
    ...proofBundle.manifest,
    camera_evidence_commitment: sha256Hex(cameraEvidenceJson),
    image_sha256: imageHash,
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    cameraEvidenceJson,
    canonicalManifestJson,
    imageHash,
    manifest,
    manifestHash,
    photoBytesBase64,
    proofId,
  };
}

function rewriteProof(
  proofBundle,
  {
    appIdentityHash = proofBundle.appIdentityHash,
    captureSessionId = proofBundle.captureSessionId,
    nonce = proofBundle.nonce,
    partnerId = proofBundle.partnerId,
    useCase = proofBundle.useCase,
  } = {},
) {
  const normalizedAppIdentityHash = appIdentityHash.toLowerCase();
  const partnerIdHash = sha256Hex(partnerId);
  const manifest = {
    ...proofBundle.manifest,
    app_identity_hash: normalizedAppIdentityHash,
    capture_session_id: captureSessionId,
    nonce,
    partner_id_hash: partnerIdHash,
    use_case: useCase,
  };
  const canonicalManifestJson = canonicalManifestStringify(manifest);
  const manifestHash = sha256Hex(canonicalManifestJson);
  const proofId = deriveProofId(manifestHash, manifest.image_sha256, manifest.nonce);

  return {
    ...proofBundle,
    appIdentityHash: normalizedAppIdentityHash,
    canonicalManifestJson,
    captureSessionId,
    manifest,
    manifestHash,
    nonce,
    partnerId,
    partnerIdHash,
    proofId,
    useCase,
  };
}

async function withPartnerAllowlist(entries, callback) {
  const originalAllowlist = process.env.ARGUS_PARTNER_APP_ALLOWLIST;
  process.env.ARGUS_PARTNER_APP_ALLOWLIST = JSON.stringify(entries);

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_PARTNER_APP_ALLOWLIST", originalAllowlist);
  }
}

async function withVerifierAllowlist(entries, callback) {
  const originalAllowlist = process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST;
  const originalAllowlistLocked = process.env.ARGUS_TEST_VERIFIER_ALLOWLIST_LOCKED;
  process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST = JSON.stringify(entries);
  process.env.ARGUS_TEST_VERIFIER_ALLOWLIST_LOCKED = "1";

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_VERIFIER_BASE_URL_ALLOWLIST", originalAllowlist);
    restoreEnv("ARGUS_TEST_VERIFIER_ALLOWLIST_LOCKED", originalAllowlistLocked);
  }
}

async function withSolanaModeWithoutRpc(callback) {
  const originalMode = process.env.ARGUS_RELAYER_MODE;
  const originalRpcUrl = process.env.SOLANA_RPC_URL;
  const originalAnchorProviderUrl = process.env.ANCHOR_PROVIDER_URL;
  const originalPartnerAllowlist = process.env.ARGUS_PARTNER_APP_ALLOWLIST;
  const originalVerifierAllowlist = process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST;
  const shouldUseDefaultVerifierAllowlist =
    process.env.ARGUS_TEST_VERIFIER_ALLOWLIST_LOCKED !== "1";
  process.env.ARGUS_RELAYER_MODE = "solana";
  process.env.SOLANA_RPC_URL = "";
  process.env.ANCHOR_PROVIDER_URL = "";
  process.env.ARGUS_PARTNER_APP_ALLOWLIST = JSON.stringify([
    {
      appIdentityHashes: [proof.appIdentityHash],
      partnerId: proof.partnerId,
      useCases: [proof.useCase],
    },
  ]);
  if (shouldUseDefaultVerifierAllowlist) {
    process.env.ARGUS_VERIFIER_BASE_URL_ALLOWLIST = JSON.stringify(["https://verify.argus.dev"]);
  }

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_RELAYER_MODE", originalMode);
    restoreEnv("SOLANA_RPC_URL", originalRpcUrl);
    restoreEnv("ANCHOR_PROVIDER_URL", originalAnchorProviderUrl);
    restoreEnv("ARGUS_PARTNER_APP_ALLOWLIST", originalPartnerAllowlist);
    if (shouldUseDefaultVerifierAllowlist) {
      restoreEnv("ARGUS_VERIFIER_BASE_URL_ALLOWLIST", originalVerifierAllowlist);
    }
  }
}

async function withSolanaModeWithoutPartnerPolicy(callback) {
  const originalMode = process.env.ARGUS_RELAYER_MODE;
  const originalPartnerAllowlist = process.env.ARGUS_PARTNER_APP_ALLOWLIST;
  process.env.ARGUS_RELAYER_MODE = "solana";
  delete process.env.ARGUS_PARTNER_APP_ALLOWLIST;

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_RELAYER_MODE", originalMode);
    restoreEnv("ARGUS_PARTNER_APP_ALLOWLIST", originalPartnerAllowlist);
  }
}

async function withProductionRuntime(callback, nodeEnv = "production") {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  try {
    return await callback();
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
  }
}

async function withProductionRuntimeWithoutSolanaMode(callback, nodeEnv = "production") {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMode = process.env.ARGUS_RELAYER_MODE;
  process.env.NODE_ENV = nodeEnv;
  delete process.env.ARGUS_RELAYER_MODE;

  try {
    return await callback();
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("ARGUS_RELAYER_MODE", originalMode);
  }
}

async function withProductionRuntimeWithoutPartnerPolicy(callback, nodeEnv = "production") {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPartnerAllowlist = process.env.ARGUS_PARTNER_APP_ALLOWLIST;
  process.env.NODE_ENV = nodeEnv;
  delete process.env.ARGUS_PARTNER_APP_ALLOWLIST;

  try {
    return await callback();
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("ARGUS_PARTNER_APP_ALLOWLIST", originalPartnerAllowlist);
  }
}

async function withUnsupportedRelayerMode(callback) {
  const originalMode = process.env.ARGUS_RELAYER_MODE;
  process.env.ARGUS_RELAYER_MODE = "SOLANA";

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_RELAYER_MODE", originalMode);
  }
}

async function withDemoRelayerMode(callback) {
  const originalMode = process.env.ARGUS_RELAYER_MODE;
  process.env.ARGUS_RELAYER_MODE = "demo";

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_RELAYER_MODE", originalMode);
  }
}

async function withDemoRegistryConfig({ registryProgramId, relayer }, callback) {
  const originalRegistryProgramId = process.env.ARGUS_REGISTRY_PROGRAM_ID;
  const originalSolanaPublicKey = process.env.SOLANA_PUBLIC_KEY;
  process.env.ARGUS_REGISTRY_PROGRAM_ID = registryProgramId;
  process.env.SOLANA_PUBLIC_KEY = relayer;

  try {
    return await callback();
  } finally {
    restoreEnv("ARGUS_REGISTRY_PROGRAM_ID", originalRegistryProgramId);
    restoreEnv("SOLANA_PUBLIC_KEY", originalSolanaPublicKey);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function buildCameraEvidenceJson(proofBundle, { allowDemoCameraStub = false } = {}) {
  const cameraEvidence = JSON.parse(proofBundle.cameraEvidenceJson);
  cameraEvidence.cameraMetadata = true;
  if (!allowDemoCameraStub) {
    cameraEvidence.captureSurface = "native_android_camera";
  }
  cameraEvidence.capturedFileBytes = decodedByteLength(proofBundle.photoBytesBase64);
  cameraEvidence.capturedAtMs = proofBundle.manifest.captured_at_ms;
  cameraEvidence.collectedAtMs = proofBundle.manifest.captured_at_ms + 250;
  cameraEvidence.captureEvidenceDelayMs = 250;
  return stableStringify(cameraEvidence);
}

function decodedByteLength(base64) {
  return Buffer.from(base64, "base64").byteLength;
}

function sameLengthDifferentBase64(base64) {
  const bytes = Buffer.from(base64, "base64");
  bytes[bytes.length - 3] ^= 1;
  return bytes.toString("base64");
}

function oversizedMetadataJson() {
  return `{"description":"${"a".repeat(70 * 1024)}"}`;
}

function oversizedCanonicalManifestJson() {
  return "a".repeat(MAX_CANONICAL_MANIFEST_JSON_BYTES + 1);
}

function oversizedEvidenceJson() {
  return "é".repeat(MAX_EVIDENCE_JSON_BYTES / 2) + "a";
}

function oversizedCaptureSessionId() {
  return "é".repeat(MAX_CAPTURE_SESSION_ID_BYTES / 2) + "a";
}

function oversizedVerifierBaseUrl() {
  return `https://verify.argus.dev/${"a".repeat(MAX_VERIFIER_BASE_URL_BYTES)}`;
}

function sampleJpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
    0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function malformedSofJpegBytes() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00,
    0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function mismatchedComponentJpegBytes() {
  const bytes = [...sampleJpegBytes()];
  bytes[23] = 0x00;
  bytes[24] = 0x0a;
  bytes[25] = 0x02;
  bytes.splice(28, 0, 0x02, 0x00);
  return Buffer.from(bytes);
}

function scanComponentMissingFromFrameJpegBytes() {
  const bytes = [...sampleJpegBytes()];
  bytes[26] = 0x02;
  return Buffer.from(bytes);
}

function duplicateStartOfFrameJpegBytes() {
  const bytes = [...sampleJpegBytes()];
  bytes.splice(21, 0, ...singleComponentStartOfFrameSegment(0x01));
  return Buffer.from(bytes);
}

function singleComponentStartOfFrameSegment(componentId) {
  return [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, componentId, 0x11, 0x00];
}

function jpegBytesOfLength(byteLength) {
  const sample = sampleJpegBytes();
  assert.ok(byteLength >= sample.byteLength);
  const bytes = Buffer.alloc(byteLength, 0x00);
  sample.copy(bytes, 0, 0, sample.byteLength - 2);
  sample.copy(bytes, byteLength - 2, sample.byteLength - 2);
  return bytes;
}

function buildDeviceIntegrityJson(proofBundle, motionPatch = {}) {
  const deviceIntegrity = JSON.parse(proofBundle.deviceIntegrityJson);
  deviceIntegrity.androidEvidenceLevel = 2;
  deviceIntegrity.appIdentityHash = proofBundle.appIdentityHash;
  deviceIntegrity.appIdentityHashPresent = true;
  deviceIntegrity.attestationCertificateChainPem = [];
  deviceIntegrity.attestationStatus = "level_4_unsupported_fell_back_to_level_2";
  deviceIntegrity.evidenceLevel = "level_2_native_capture";
  deviceIntegrity.hardwareAttestation = {
    fallbackLevel: 2,
    reason: "android_key_attestation_unavailable",
    supported: false,
  };
  deviceIntegrity.keystorePublicKeyPem = "";
  deviceIntegrity.keystoreSignature = false;
  deviceIntegrity.level3KeystoreSignature = false;
  deviceIntegrity.level4HardwareAttestation = false;
  delete deviceIntegrity.motionSnapshotPresent;
  deviceIntegrity.motionSnapshot = {
    accelerometer: [0.01, 0.02, 9.81],
    accelerometerAvailable: true,
    available: true,
    gyroscope: [0.001, 0.002, 0.003],
    gyroscopeAvailable: true,
    sampledAtMs: proofBundle.manifest.captured_at_ms,
    sampleWindowMs: 180,
    ...motionPatch,
  };
  return stableStringify(deviceIntegrity);
}

function buildKotlinNumberDeviceIntegrityJson(proofBundle) {
  return [
    "{",
    `"appIdentityHash":"${proofBundle.appIdentityHash}",`,
    `"appIdentityHashPresent":true,`,
    `"motionSnapshot":{`,
    `"accelerometer":[0,0,9.81],`,
    `"accelerometerAvailable":true,`,
    `"available":true,`,
    `"gyroscope":[1,0.0001,-0.000123],`,
    `"gyroscopeAvailable":true,`,
    `"sampleWindowMs":180,`,
    `"sampledAtMs":${proofBundle.manifest.captured_at_ms}`,
    "}",
    "}",
  ].join("");
}

function buildRawFloatToStringDeviceIntegrityJson(proofBundle) {
  return [
    "{",
    `"appIdentityHash":"${proofBundle.appIdentityHash}",`,
    `"appIdentityHashPresent":true,`,
    `"motionSnapshot":{`,
    `"accelerometer":[0.0,-0.0,9.81],`,
    `"accelerometerAvailable":true,`,
    `"available":true,`,
    `"gyroscope":[1.0,1.0E-4,-1.23E-4],`,
    `"gyroscopeAvailable":true,`,
    `"sampleWindowMs":180,`,
    `"sampledAtMs":${proofBundle.manifest.captured_at_ms}`,
    "}",
    "}",
  ].join("");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const fields = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${fields.join(",")}}`;
}

function canonicalManifestStringify(manifest) {
  return [
    "{",
    `"schema_version":${JSON.stringify(manifest.schema_version)},`,
    `"partner_id_hash":${JSON.stringify(manifest.partner_id_hash)},`,
    `"use_case":${JSON.stringify(manifest.use_case)},`,
    `"capture_session_id":${JSON.stringify(manifest.capture_session_id)},`,
    `"captured_at_ms":${manifest.captured_at_ms},`,
    `"image_sha256":${JSON.stringify(manifest.image_sha256)},`,
    `"metadata_commitment":${JSON.stringify(manifest.metadata_commitment)},`,
    `"camera_evidence_commitment":${JSON.stringify(manifest.camera_evidence_commitment)},`,
    `"device_integrity_commitment":${JSON.stringify(manifest.device_integrity_commitment)},`,
    `"app_identity_hash":${JSON.stringify(manifest.app_identity_hash)},`,
    `"nonce":${JSON.stringify(manifest.nonce)},`,
    `"proof_level":${JSON.stringify(manifest.proof_level)}`,
    "}",
  ].join("");
}

function deriveProofId(manifestHash, imageHash, nonce) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from("argus-proof-v1"),
      Buffer.from(manifestHash, "hex"),
      Buffer.from(imageHash, "hex"),
      Buffer.from(nonce, "hex"),
    ]),
  );
}

function deriveProofIdWithoutNonce(manifestHash, imageHash) {
  return sha256Hex(
    Buffer.concat([
      Buffer.from("argus-proof-v1"),
      Buffer.from(manifestHash, "hex"),
      Buffer.from(imageHash, "hex"),
    ]),
  );
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
