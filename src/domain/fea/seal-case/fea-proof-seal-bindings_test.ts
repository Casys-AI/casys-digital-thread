import { assertEquals } from "@std/assert";
import type { MechanicalProofCase } from "./mechanical-proof-case.ts";
import { resolveFeaProofSealThreadBindings } from "./fea-proof-seal-bindings.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";

const GEOMETRY_DIGEST = "a".repeat(64);
const STEP_DIGEST = "b".repeat(64);

Deno.test("FEA binding derives a target STEP owner from its deterministic target artifact id", () => {
  const requirements = artifact(
    "requirements",
    "sysml-model",
    "c".repeat(64),
    "application/json",
  );
  const result = resolveFeaProofSealThreadBindings(
    snapshot([
      geometryArtifact(),
      artifact(
        `cad-asset-${GEOMETRY_DIGEST}-target-0-${STEP_DIGEST}`,
        "step",
        STEP_DIGEST,
        "model/step",
      ),
      requirements,
    ]),
    proofCase(),
    "project:target",
    requirements,
  );
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.bindings.geometryArtifact.id, `geometry-${GEOMETRY_DIGEST}`);
  assertEquals(
    result.bindings.stepArtifact.id,
    `cad-asset-${GEOMETRY_DIGEST}-target-0-${STEP_DIGEST}`,
  );
});

Deno.test("FEA binding never substitutes a cad-model capture for a malformed target STEP identity", () => {
  const requirements = artifact(
    "requirements",
    "sysml-model",
    "c".repeat(64),
    "application/json",
  );
  const result = resolveFeaProofSealThreadBindings(
    snapshot([
      geometryArtifact(),
      artifact(`cad-asset-${STEP_DIGEST}`, "cad-model", STEP_DIGEST, "model/step"),
      requirements,
    ]),
    proofCase(),
    "project:target",
    requirements,
  );
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.diagnostics.some((item) => item.code === "step-absent"), true);
});

function proofCase(): MechanicalProofCase {
  return {
    caseId: "target-proof",
    project: { id: "project:target", subjectId: "subject:target" },
    target: { id: "arm", modelElementId: "part-definition:arm" },
    expectedCadArtifact: { sha256: STEP_DIGEST },
  } as unknown as MechanicalProofCase;
}

function snapshot(artifacts: ThreadArtifact[]): ThreadSnapshot {
  return {
    subject: { id: "subject:target" },
    artifacts,
  } as unknown as ThreadSnapshot;
}

function geometryArtifact(): ThreadArtifact {
  return artifact(
    `geometry-${GEOMETRY_DIGEST}`,
    "cad-model",
    GEOMETRY_DIGEST,
    "application/json",
  );
}

function artifact(
  id: string,
  kind: ThreadArtifact["kind"],
  digest: string,
  mediaType: string,
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: kind === "cad-model"
      ? `casys://geometry-capture/sha256/${digest}`
      : `/api/thread/assets/${digest}.step`,
    mediaType,
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run:target",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-22T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}
