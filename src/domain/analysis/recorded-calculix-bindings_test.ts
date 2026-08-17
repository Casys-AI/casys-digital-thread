import { assertEquals } from "@std/assert";
import {
  diagnoseRecordedCalculixGeometryArtifact,
  recordedCalculixBindingRejectionMessage,
  recordedCalculixReviewProposal,
  rejectCadModelGeometryLookalikes,
} from "./recorded-calculix-bindings.ts";

Deno.test("recorded CalculiX names a cad-model geometry binding as the lookalike refusal", () => {
  const diagnostic = diagnoseRecordedCalculixGeometryArtifact({
    id: "geometry-aaaa",
    kind: "cad-model",
    mediaType: "application/json",
  });
  assertEquals(diagnostic?.code, "geometry-is-cad-model");
  assertEquals(diagnostic?.artifactId, "geometry-aaaa");
});

Deno.test("recorded CalculiX rejection prose still names the exact document-and-STEP contract", () => {
  const message = recordedCalculixBindingRejectionMessage({
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

Deno.test("recorded CalculiX review proposal restates bindings and never invents fea.run.*", () => {
  const proposal = recordedCalculixReviewProposal("fea-proof-abc", "cad-asset-step");
  assertEquals(
    proposal.parameters.map((parameter) => parameter.key),
    ["review.proofArtifactId", "review.stepArtifactId"],
  );
  assertEquals(proposal.parameters[0]?.value, "fea-proof-abc");
  assertEquals(proposal.parameters[1]?.value, "cad-asset-step");
  assertEquals(proposal.summary.includes("fea.run."), false);
});
