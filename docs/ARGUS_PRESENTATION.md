# Argus Presentation Brief

Submission-facing content is written in English because the Frontier official rules require submitted content to be in English.

## One-liner

Argus is a capture-provenance layer for platforms: verify required real capture before trusting user-submitted photos as evidence.

## Core Thesis

AI detection is an arms race. Argus takes the narrower path: prove the required capture path before a photo is trusted as platform evidence.

The root problem is AI-era photo evidence: any workflow where a user-submitted photo can affect money, trust, access, or dispute resolution while being generated, edited, reused, or uploaded from elsewhere. Argus gives platforms an embedded SDK, verifier-backed status, and public commitment record: the user stays inside the partner app, the SDK binds the submitted file to native capture evidence, and an authorized production relayer fee payer registers commitments with sponsored gas in the production-pinned Argus Registry on Solana. Production registration is not hash-only; the relayer checks the full proof bundle and partner/use-case/app identity policy before sponsorship.

The marketplace demo is one concrete example because it is visual and easy to understand. The product is horizontal capture-provenance infrastructure for platform photo-evidence workflows: marketplaces, insurance claims, warranty/return disputes, rental and real-estate media, field inspection, compliance, and other cases where platforms need required real capture rather than another uploaded file.

## Investor Answer Spine

| Question | Direct answer |
| --- | --- |
| Who pays? | Platform teams that rely on user-submitted photo evidence: trust/safety, claims, fraud, review, listing-integrity, warranty/returns, or field-operations teams. They pay for production relayer/verifier access, SDK integration/support, sponsored accepted registrations, verifier API usage, and later review tooling after Verified Capture volume exists. |
| Can the SDK be open source? | Yes, the SDK/protocol surface can be inspectable for trust and composability. The commercial boundary is production acceptance: authorized hosted relayer access, partner policy, verifier hosting, audit logs, abuse monitoring, key rotation, support, and optional dedicated deployments. A forked SDK cannot mint production Argus status by itself. |
| Why now? | Generative tools make plausible fake evidence photos, edited possession photos, fake memo-verification images, fake damage photos, and fake shipping/ID images easier to create. Platforms need a capture-path gate before a photo becomes trusted evidence. These stats support the problem context; they do not prove buyer demand. |
| Why a company? | Platforms need one accountable capture rule across SDK capture, verification policy, relayer operations, registry records, verifier UX, and partner integration. A policy memo or database flag is not enough when verification needs to be checked outside one platform database. |
| Why not C2PA or platform policy? | Pixel-level AI detectors score uploads after the fact. C2PA can complement Argus, but it mainly answers which credential is attached to a file and who signed it. Argus answers whether the platform-required capture path, relayer policy, and verification rules were satisfied. Internal policy is not externally verifiable once the image leaves that database. |
| Why Solana? | Solana is core to the product promise: a verifier outside one platform database can inspect a public commitment record instead of trusting mutable internal metadata. The Argus Registry stores compact commitments, not photos. It does not certify photo content or Android evidence by itself; the relayer/backend validates before registration, and Solana anchors accepted commitments afterward so later photo, manifest, or evidence rewrites are detectable by platforms, reviewers, claim handlers, buyers, and third-party verifiers. The authorized production relayer fee payer keeps users away from wallets and gas while still creating recurring Solana commitment records. |
| Why marketplace demo? | Marketplace listings are a clear demo surface because fake product photos are visual, familiar, and easy to explain. The demo is an example of the broader evidence workflow, not the product boundary. |
| Why would platforms integrate? | Start with one workflow pilot, not a platform-wide rollout: users stay inside the partner app, users do not touch wallets, failed verification states route into existing review workflows, and the pilot measures retake, review, dispute, and fraud-review signals. Partner validation is the next milestone. |
| What does a platform or reviewer do after the badge? | Accept, badge, retake, downgrade, reject, or review. Reviewers can treat the badge as a stronger capture-path signal and open the verifier for high-value cases. Do not treat it as ownership, authenticity, legal validity, or scene-truth proof. |
| What fraud path is addressed? | False Verified Capture claims: direct imports of gallery, reused/stock, or AI-generated files; tampered photo bytes whose hash or byte count do not match the manifest/evidence; and replay/backdating attempts that fail nonce/session/relayer policy should be denied the production badge. This blocks the badge claim, not necessarily the upload itself. |
| What fraud is not reduced? | Ordinary unverified uploads, theft, counterfeit goods, off-frame damage, staged scenes, photographing a screen or printout, compromised clients that bypass integrity policy, collusion, shipping fraud, and false claims outside the photo. |
| How strong is the device evidence? | Registry `proofLevel` stays `app_capture`; Level 3/4 are Android evidence levels inside committed device evidence. Level 3 is a verifier/relayer-validated Keystore signature over the proof manifest/device-binding message and signer public key. Level 4 is Android Key Attestation validated against the capture-session nonce, TEE/StrongBox security level, and configured trusted root/fingerprint. Unsupported, unverifiable, unconfigured, or root-unvalidated Level 4 falls back to Level 3 or Level 2 and cannot claim hardware-backed attestation. None of these are camera sensor signatures. |
| Post-hackathon path? | Pilot one evidence-heavy workflow with required Argus capture, verifier bundle checks, clear badge/status copy, reviewer escalation for failed verification states, and measurement of retake, review, dispute, and fraud signals. Marketplace listings are one candidate; claims, returns, rental/real-estate, field inspection, and compliance are equally valid if partner access is stronger. |
| What expands after the first pilot? | The same capture commitment primitive can serve insurance claim photos, warranty/return dispute photos, rental and real-estate listing media, ticket or collectible transfer evidence, field inspection, compliance, and other user-generated evidence. Keep these as roadmap markets until the first workflow has buyer validation. |
| What AI-enabled fraud pressure is emerging? | AI-edited possession photos, fake handwritten memo verification photos, fake shipping labels or ID cards, non-existent product listings, reused/stock/gallery imports, AI-generated damage or condition photos, and replay/backdating attempts. Argus gates the capture path for platform decisions; it does not prove scene truth. |
| Customer validation status? | Available evidence is market-context support, not proof of customer demand: fraud data, platform photo policies, and existing high-value trust/review workflows. Customer validation starts with one required-capture pilot with a platform partner. |

## Why This Matters Now

Use these as market-context support, not as evidence that platforms have already validated Argus or agreed to buy it.

1. Social media is a major scam surface that often touches shopping. The FTC reported that 2025 social-media scam losses reached $2.1B, and shopping scams were the most reported scam type that started on social media.
   Source: https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2026/04/reported-losses-scams-social-media-eight-times-higher-2020

2. Online shopping fraud is widespread enough to matter as adjacent market context, not as the whole Argus market. Pew reported that about a third of U.S. adults say they have experienced an online shopping scam, and FTC data showed $434.4M in reported U.S. online-shopping fraud losses in 2024.
   Source: https://www.pewresearch.org/short-reads/2025/11/19/about-a-third-of-americans-say-theyve-had-an-online-shopping-scam-happen-to-them/

3. Recommerce has enough visible activity for a clear demo category. eBay's 2025 Recommerce Report frames secondhand buying and selling as mainstream in its surveyed recommerce audience.
   Source: https://www.ebayinc.com/recommerce-report/

4. Photos are already a trust primitive in platform workflows. eBay's picture policy is one concrete example: it requires photos to accurately represent the item and restricts stock photos for used, damaged, or defective items; Argus targets the narrower capture-path enforcement gap underneath policies like this.
   Source: https://www.ebay.com/help/listing-policies/policies/picture-policy?id=4370

5. Platforms already use badges and review states to communicate trust. eBay's Authenticity Guarantee surfaces a checkmark and uses expert verification for categories including watches, handbags, jewelry, sneakers, apparel, and trading cards. This is trust-UX precedent, not evidence that Argus verifies authenticity.
   Source: https://www.ebay.com/help/selling/selling-tools/selling-authenticity-guarantee?id=4644

6. AI-image detection is brittle in real-world settings. AIGIBench reports that state-of-the-art detectors can drop significantly outside controlled datasets.
   Source: https://arxiv.org/abs/2505.12335

7. AI-enabled secondhand fraud is now concrete, not hypothetical. Korea JoongAng Daily reported a Korean secondhand-marketplace case where a buyer transferred 240,000 won after receiving an AI-edited product photo and shipping-label photo; authorities estimated at least 1,000 victims tied to the same scam group.
   Source: https://koreajoongangdaily.joins.com/news/2026-04-18/national/socialAffairs/Secondhand-marketplace-scams-grow-as-fraudsters-weaponize-AI-tools-to-hoodwink-victims/2572237

8. Korean secondhand platforms already see AI manipulation attacking "memo verification," where sellers are asked to photograph an item beside a handwritten username/date note. Seoul Economic Daily reported that fraudsters synthesize memo notes onto product photos, and that manipulated videos have also been confirmed.
   Source: https://en.sedaily.com/technology/2025/12/20/ai-generated-fake-memo-verification-photos-emerge-as-new

9. AI-generated image scams are not limited to Korea. A Harvard Kennedy School Misinformation Review study found Facebook spam/scam pages using unlabeled AI-generated images for audience growth; scam pages attempted to sell non-existent products or obtain personal details.
   Source: https://misinforeview.hks.harvard.edu/wp-content/uploads/2024/08/diresta_spammers_scammers_ai_images_facebook_20240815.pdf

10. AI-enabled fraud is becoming easier to execute across modalities. AARP reported that Microsoft AI for Good researchers analyzed 531,000 AARP Fraud Watch Network and BBB Scam Tracker reports and found victim-identified AI-enabled scams increased 20-fold from 2023 to 2025.
   Source: https://www.aarp.org/money/scams-fraud/detecting-ai-fraud/

11. Online purchase fraud remains a serious buyer-risk context. BBB reported that online purchase scams made up 30.3% of BBB Scam Tracker submissions in its 2024 risk report, and 87.5% of those reports involved monetary loss.
   Source: https://www.bbb.org/article/scams/28289-bbb-scam-tracker-risk-report

12. Social commerce is a major scam surface. The FTC reported that people lost $2.1B to scams that started on social media in 2025, and shopping scams were the most reported category.
   Source: https://consumer.ftc.gov/consumer-alerts/2026/04/how-spot-top-scams-started-social-media

13. Provenance standards support the direction, but file-bound credentials alone do not solve every marketplace workflow. C2PA defines signed provenance information, while OpenAI notes that metadata can be removed by platforms, screenshots, or intentional stripping.
   Sources: https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html and https://help.openai.com/en/articles/8912793-c2pa-in-chatgpt-images

14. Solana is essential to Argus's public-verification promise because the registry stores compact public commitments, not photos. Official Solana docs list the base fee as 5,000 lamports per signature plus optional priority fees.
   Source: https://solana.com/docs/core/fees/fee-structure

15. Frontier rules judge submissions on this mix: functionality, potential impact, novelty, UX, open-source composability, and business plan.
   Source: https://colosseum.com/legal/Solana%20Frontier%20Hackathon%20Rules.pdf

## Expansion Fraud Map

Keep the demo focused, but explain that Argus is a reusable capture-commitment primitive for evidence workflows.

| Market | Fraud pressure | Argus fit | Boundary |
| --- | --- | --- | --- |
| Insurance claims | Reused, staged, backdated, or AI-generated damage photos | Bind claim photos to a fresh app capture session, device evidence, and public commitment record | Does not prove legal validity or actual cause of loss |
| Warranty and returns | AI-generated damage photos, post-purchase condition disputes, fake return evidence | Require fresh capture at claim/return intake and make later evidence rewrites detectable | Does not decide merchant policy or product defect truth |
| Rental and real-estate listings | AI-generated or materially edited listing media, reused photos, stale condition photos | Require platform-controlled fresh capture for selected listing media and verifier-backed provenance | Does not prove the property is available or fairly represented |
| Field-work audits | Backdated inspection photos, reused site photos, missing on-site evidence | Bind inspection media to session nonce, app identity, timing, and public commitment records | Does not prove the worker performed every required action |
| Marketplace listings | AI-edited possession photos, fake memo-verification notes, reused/stock/gallery imports, non-existent goods, fake shipping labels | Require a fresh in-app capture path before a Verified Capture badge, retake, downgrade, or review decision | Does not prove ownership, authenticity, condition, or delivery |

## Demo Narrative

Describe the intended `app_capture` production path first, show the failed-verification action, then label any local/browser run honestly. The reference demo can use a marketplace listing, but the narration should call it one example of a broader platform evidence workflow.

1. A user submits photo evidence inside a partner app; the reference demo can show a seller listing a high-value used camera.
2. The platform requires Verified Capture before the photo can receive a trusted status, badge, or review decision.
3. The user taps "Take Verified Capture photo" inside the partner app.
4. Argus SDK opens the Android native capture flow instead of gallery or file import.
5. Kotlin captures the photo and collects the required evidence package: native camera-path evidence, capture timing, motion context, app identity, short-lived session nonce, and optional integrity status.
6. The Android proof builder mirrors the Rust core canonical rules: it hashes the exact submitted photo bytes, creates the manifest, and returns a proof ID.
7. The authorized production relayer fee payer checks canonical photo bytes, basic byte-shape/size policy, hash/byte-count/evidence matches, and partner/use-case/app identity policy before sponsoring production-pinned Argus Registry registration on Solana.
8. The platform shows Verified Capture status only after that verifier bundle passes.
9. If the bundle is missing or fails verification, the platform asks for a fresh Argus retake, downgrades the evidence to unverified, rejects it, or routes it to review instead of showing the production badge.
10. The reviewer, buyer, claims handler, or third-party verifier opens a verifier page for the bundle details and limitations.

The proof bundle is stored offchain. The photo lives in platform storage or is supplied to the verifier; `canonicalManifestJson`, `metadataJson`, `cameraEvidenceJson`, and `deviceIntegrityJson` live in a partner/Argus proof-bundle store keyed by `proofId`; session and nonce state live in relayer backend storage until consumed or expired; Solana stores only commitments. The verifier treats that storage as a data source, then recomputes the bundle against the onchain record.

Keep the demo labels simple:

| Label | Use it when | Pitch rule |
| --- | --- | --- |
| **Production Verified Capture** | Full production trust root: production Android capture evidence, matching photo/manifest/evidence commitments, required device/app/motion commitments, production-pinned registry/config, authorized production relayer fee payer, sponsored gas/fee-payer binding, and allowlisted partner/use-case/app identity policy. | Only this label may show the production badge. |
| **Solana/devnet integration demo** | The relayer uses production-style partner policy such as `ARGUS_PARTNER_APP_ALLOWLIST`, but the run is not under the complete production trust root. | Say it shows integration shape, not production verification. |
| **Demo Preview** | Local RN, browser, simulator, `mock://`, `proofLevel: "demo"`, simulated evidence such as `android-native-camera-stub`, local demo records keyed by an explicit `proofId`, `demo_verified`, or simulated transaction references. | Show UX and verifier logic only. A browser preview without `proofId` is invalid and must not auto-load a saved demo record. |
| **Non-production record** | `relayerAuthorized: false`, `status: "superseded"`, `proofLevel: "demo"`, or missing required evidence. | Must not display a production Verified Capture badge. |

Verifier links are allowlisted entrypoints only; the URL does not confer Verified Capture unless the verifier checks the full Argus bundle and trust root.

## Slide Outline

### 1. Title

Argus
AI can fake photos. Argus verifies the capture path.

### 2. Problem

Platforms increasingly depend on user-submitted photo evidence, but ordinary uploads cannot prove whether a file was freshly captured in-app or generated, edited, reused, or imported from elsewhere.

Judging link: impact.

### 3. Why Now

Generative tools make plausible fake evidence photos easier to create, social-shopping and secondhand fraud show the pressure in one visible category, and the same capture-path gap appears in claims, returns, rental/real-estate media, and field-work evidence.

Judging link: impact and business plan.

### 4. Failed Approach

AI detection tries to judge pixels after upload. It is brittle, model-dependent, and exposed to false positives and false negatives.

Judging link: novelty.

### 5. Core Insight

Do not guess whether pixels are fake after upload. Make the platform-required capture path verifiable through SDK capture, device-side evidence, authorized registry registration, and an inspectable verifier bundle.

Judging link: novelty and UX.

### 6. Product

Argus B2B Verified Capture SDK + verifier workflow + Verified Capture badge + independent commitment registry for external verification.

Judging link: functionality.

### 7. Architecture

Partner React Native App -> Argus RN SDK -> Kotlin Android native capture -> Kotlin proof builder mirroring Rust core rules -> authorized production relayer fee payer with sponsored gas -> Argus Registry on Solana -> React Native verifier.

Judging link: functionality and open-source composability.

### 8. Demo

In the production path, a user captures photo evidence inside the partner app. The Verified Capture status appears only after the verifier checks required capture evidence and an authorized production relayer fee payer record in the production-pinned known Argus Registry program; reviewers or third-party verifiers can open the verifier to see the path, registry status, and limitations. Local, browser, simulator, and devnet runs must be labeled preview or integration demo unless the complete production trust root is present.

Judging link: UX and functionality.

### 9. Why Solana

Solana is part of the product promise: a verifier outside one platform database can inspect a public commitment record instead of trusting mutable internal metadata. Argus stores commitments, not photos. The Argus Registry on Solana provides the compact public record without certifying photo content or Android evidence by itself. The backend/relayer validates before registration; Solana anchors accepted commitments afterward so platforms, reviewers, claim handlers, buyers, and third-party verifiers can detect later photo, manifest, or evidence rewrites. The authorized production relayer fee payer hides blockchain complexity from users while still producing real Solana commitment activity.

Judging link: UX and open-source composability.

### 10. Trust Boundary

Argus verifies the capture path, evidence bindings, and authorized registry commitment registration. Argus does not prove item existence, physical scene truth, seller ownership, item authenticity, item condition, legal validity, or that the photographer did not photograph a screen.

Normal Android apps also do not get a universal cryptographic signature from the physical camera sensor over image pixels. Argus treats a committed camera evidence summary, motion and app evidence, server nonce, and optional integrity status as provenance evidence, not sensor-signed truth.

Evidence levels must stay conservative: demo/bundle checks are Level 1, production `app_capture` with the full trust root is Level 2, a Keystore proof-manifest/device-binding signature is Level 3, and Android Key Attestation with nonce, TEE/StrongBox, and trusted-root validation is Level 4. If Level 4 is unsupported, unverifiable, unconfigured, or root validation fails, say Level 3 or Level 2; do not imply hardware-backed attestation or camera-sensor signatures.

The relayer, verifier, and client status logic bind the exact submitted photo bytes to the manifest, evidence, and registry commitments. The byte policy is a production gate against malformed or mismatched payloads, not proof of camera origin by bytes alone, deep JPEG/container semantic validation, or media forensics.

Argus is accountable trust, not a backend-free trustless photo oracle. If the proof-bundle store later serves a changed photo, manifest, or evidence JSON, the verifier catches the mismatch against Solana commitments. If an authorized relayer is malicious or compromised, that is a trust-root incident requiring monitoring, rate limiting, key rotation, audit, and revocation/supersession.

Judging link: functionality and credibility.

### 11. Business Model

Open SDK/protocol surface for trust and composability, with paid production relayer/verifier access for platform trust, safety, claims, fraud, review, and field-operations teams. Charge for integration/support, accepted production registrations, verifier API usage, audit logs, fraud/dispute dashboards, and enterprise dedicated deployments after Verified Capture volume exists.

Judging link: business plan.

### 12. Expansion Markets

The reference demo can be marketplace-shaped, but the product is broader. The same capture-commitment primitive can serve insurance claims, warranty and return disputes, rental and real-estate listing media, field inspection, compliance evidence, and ticket or collectible transfer evidence. The fraud pattern is similar: AI-edited possession photos, fake shipping labels or ID cards, reused/stock/gallery imports, AI-generated damage or condition photos, and replay/backdating attempts.

Judging link: impact and business plan.

### 13. Closing

Win one evidence workflow first. Use the marketplace demo to make the product legible, but pitch Argus as capture-provenance infrastructure for any platform that needs real photo evidence.

Judging link: impact.

## Three-minute Script

Argus helps platforms trust photo evidence only when the verifier can confirm the required capture path and authorized registry record.

The root problem is broader than used-camera listings. Platforms are increasingly asked to trust user-submitted photos for listings, insurance claims, returns, rentals, inspections, and disputes, while generative tools make it easier to create photos that look real but never came from the claimed capture context. Argus focuses on the enforceable capture-path layer underneath those workflows.

That is market-context support, not validated demand. The next validation milestone is one evidence-heavy platform pilot with required capture, clear status copy, verifier bundle checks, and reviewer escalation.

Argus is not an AI detector. Detection is brittle as generators and real-world image pipelines change through compression, screenshots, edits, and platform handling. Argus takes a different route: make the platform-required capture path verifiable, from SDK capture and device-side evidence to authorized registry registration.

In the intended `app_capture` production path, a user submits photo evidence inside a partner app; the reference demo can show a seller listing a used Hasselblad camera. The Argus SDK opens native Android capture and binds the file to camera-path, timing, motion, app identity, nonce, and optional integrity evidence. The Android proof builder mirrors the Rust core canonical manifest and proof-ID rules. An authorized production relayer fee payer checks the full proof bundle, basic byte-shape/size policy, and partner/use-case/app identity policy before sponsoring registration, so the user never sees a wallet or gas fee. Only then can the platform show Verified Capture status, and the reviewer, buyer, claims handler, or third-party verifier can open a verifier page that shows the capture path, registry status, and limitations.

When shown as a local, browser, simulator, or `mock://` demo, the same screens should be labeled Demo Preview. Browser preview links must include an explicit `proofId`; a `demo_verified` result exercises the UX and bundle-checking logic, but it does not mean that the production Argus Android camera surface or production registry accepted the capture.

For a Solana-mode/devnet run, say the relayer is enforcing an explicit partner allowlist for the partner ID, use case, and app identity hash so the demo shows production-style partner-policy enforcement, not just hash posting. Treat it as an integration demo; use the production label only when the production Android capture path, required evidence commitments, production-pinned registry program, trusted registry configuration, authorized production relayer fee payer, and sponsored gas binding are all present.

Solana is the public-verification promise in Argus. It gives platforms, reviewers, buyers, claims handlers, and third-party verifiers an independent public commitment record for accepted proof bundles. Argus stores commitments only, and production Verified Capture records must come from the production-pinned Argus Registry program through an authorized production relayer fee payer with sponsored gas. The proof bundle itself stays offchain in platform or Argus storage, and the verifier recomputes it against the registry commitments. Solana does not certify the photo or Android evidence by itself; it makes an authorized registry record externally checkable and tamper-evident when file-bound metadata is stripped, the photo moves outside one platform database, or backend records are later rewritten.

The trust boundary is clear: Argus verifies the capture path, evidence bindings, and authorized registry commitment registration. It does not prove the item exists, the seller owns it, the item is authentic or correctly described, the scene is physically true, or that no one photographed a screen. Normal Android apps also do not receive a universal camera-sensor signature over pixels, so Argus treats a committed camera evidence summary, motion, and app signals as evidence rather than sensor-signed truth. That narrow claim is what makes the product credible.

Bundle and byte checks keep a hash-only proof from becoming a production badge, but they should not become the pitch headline: they are production gates, not claims of camera-origin forensics, media forensics, or universal truth.

The expansion story is not random vertical sprawl. It is the same capture-commitment primitive applied to other evidence workflows: insurance claim photos, warranty and return disputes, rental and real-estate listing media, field inspection, compliance evidence, and ticket or collectible transfer evidence. The fraud patterns are similar: AI-edited possession photos, fake memo notes, fake shipping labels or ID cards, reused uploads, AI-generated damage photos, and replay or backdating.

The business model is B2B: the SDK and protocol surface can be open for trust, but production platforms pay for authorized relayer and verifier access, accepted registration usage, integration support, audit logs, and later fraud/dispute dashboards. Start with one evidence workflow; use the marketplace demo as the clearest example, not as the product boundary.

## Submission Checklist Mapping

| Frontier criterion | Argus answer |
| --- | --- |
| Functionality | RN reference demo, RN verifier, SDK surface, Rust proof core, relayer simulation plus devnet submitter, and Argus Registry program with relayer gating |
| Impact | Capture-path provenance for AI-photo fraud across marketplaces, insurance, returns, rental/real-estate, field inspection, and compliance evidence |
| Novelty | Capture provenance instead of AI-image detection |
| UX | Users take photos in the partner app; the authorized relayer fee payer hides wallet and gas complexity |
| Open-source/composability | SDK package, proof manifest, registry commitment model, verifier API shape, and demo relayer pattern are inspectable |
| Business plan | Paid production relayer/verifier access, accepted registrations, verifier API, support, and enterprise fraud/audit tooling |
