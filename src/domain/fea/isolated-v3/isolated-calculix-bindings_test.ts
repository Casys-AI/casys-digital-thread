import { assertEquals } from "@std/assert";
import {
  diagnoseIsolatedCalculixGeometryArtifact,
  isolatedCalculixBindingRejectionMessage,
  isolatedCalculixReviewProposal,
  rejectCadModelGeometryLookalikes,
  selectSealedFeaProofArtifact,
} from "./isolated-calculix-bindings.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "../seal-case/fea-proof-proposal.ts";

function sealedDocument(id: string) {
  return {
    id,
    kind: "document",
    freshness: { status: "fresh" },
    producer: {
      serverId: "digital-thread",
      tool:
        `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`,
    },
  };
}

Deno.test("isolated CalculiX names a cad-model geometry binding as the lookalike refusal", () => {
  const diagnostic = diagnoseIsolatedCalculixGeometryArtifact({
    id: "geometry-aaaa",
    kind: "cad-model",
    mediaType: "application/json",
  });
  assertEquals(diagnostic?.code, "geometry-is-cad-model");
  assertEquals(diagnostic?.artifactId, "geometry-aaaa");
});

Deno.test("isolated CalculiX rejection prose still names the exact document-and-STEP contract", () => {
  const message = isolatedCalculixBindingRejectionMessage({
    proofKind: "document",
    proofMediaType: "application/json",
    geometryKind: "cad-model",
    geometryMediaType: "application/json",
  });
  assertEquals(
    message.includes("exact proof JSON document and STEP Thread artifact"),
    true,
  );
  assertEquals(message.includes("cad-model"), true);
});

Deno.test("cad-model lookalikes collapse to one diagnostic naming every sibling", () => {
  const rejected = rejectCadModelGeometryLookalikes({
    artifacts: [
      {
        id: "geometry-aaaa",
        kind: "cad-model",
        uri: "casys://geometry-capture/sha256/aaaa",
      },
      {
        id: "cad-asset-assembly",
        kind: "cad-model",
        uri: "casys://geometry-capture/sha256/bbbb",
      },
      { id: "arm-step", kind: "step", uri: "casys://step-export/cccc.step" },
    ],
  } as never, { id: "arm-step" });
  assertEquals(rejected.length, 1);
  assertEquals(rejected[0]?.code, "geometry-is-cad-model");
  assertEquals(rejected[0]?.artifactId, "geometry-aaaa");
  assertEquals(rejected[0]?.message.includes("cad-asset-assembly"), true);
});

Deno.test("isolated CalculiX unique proof selection ignores a sibling catalog offer", () => {
  const proofId = `fea-proof-${"a".repeat(64)}`;
  const selected = selectSealedFeaProofArtifact({
    artifacts: [
      sealedDocument(proofId),
      sealedDocument(`sensitivity-catalog-offer-${"b".repeat(64)}`),
    ],
  } as never);
  assertEquals(selected.status, "ok");
  if (selected.status !== "ok") return;
  assertEquals(selected.artifact.id, proofId);
});

Deno.test("isolated CalculiX review proposal restates bindings and never invents fea.run.*", () => {
  const proposal = isolatedCalculixReviewProposal("fea-proof-abc", "cad-asset-step");
  assertEquals(
    proposal.parameters.map((parameter) => parameter.key),
    ["review.proofArtifactId", "review.stepArtifactId"],
  );
  assertEquals(proposal.parameters[0]?.value, "fea-proof-abc");
  assertEquals(proposal.parameters[1]?.value, "cad-asset-step");
  assertEquals(proposal.summary.includes("fea.run."), false);
});
