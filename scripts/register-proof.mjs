#!/usr/bin/env node
import { createDemoCaptureProof } from "../packages/argus-rn-sdk/src/demoProof.mjs";

const proof = await createDemoCaptureProof({
  partnerId: "recommerce-demo",
  useCase: "marketplace_listing",
  metadata: {
    condition: "used-excellent",
    listingId: "argus-listing-500cm",
    title: "Hasselblad 500C/M Medium Format Film Camera Kit",
  },
});

console.log(
  JSON.stringify(
    {
      proofId: proof.proofId,
      manifestHash: proof.manifestHash,
      imageHash: proof.imageHash,
      proofLevel: proof.proofLevel,
      registryAddress: proof.registryAddress,
      registryProgramId: proof.registryProgramId,
      solanaTx: proof.solanaTx,
      relayer: proof.relayer,
      feePayer: proof.feePayer,
      proofRecord: proof.proofRecord,
      sponsoredGas: proof.sponsoredGas,
      verificationUrl: proof.verificationUrl,
    },
    null,
    2,
  ),
);
