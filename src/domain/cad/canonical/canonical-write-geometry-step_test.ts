import { assertEquals } from "@std/assert";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import {
  attestCanonicalWriteGeometryStep,
  DESIGN_WRITE_GEOMETRY_TOOL,
} from "./canonical-write-geometry-step.ts";

const CAPTURE = "b59023102670e06b4e33e534d05008c0fe2440ae91dafbaa9c256c92a4ebe3e8";
const STEP = "2572f73de4a8607fbd963642778019cfa742d6e06d9dd01a37294c0d3e7d8b5f";

Deno.test(
  "attests a cad-asset STEP via its write-geometry parent",
  () => {
    const step = cadAssetStep();
    const geometry = writeGeometryPrimary();
    const result = attestCanonicalWriteGeometryStep(
      snapshot([geometry, step]),
      step,
      STEP,
    );
    assertEquals(result.status, "attested");
    if (result.status !== "attested") return;
    assertEquals(result.step.id, step.id);
    assertEquals(result.geometry.id, `geometry-${CAPTURE}`);
    assertEquals(result.geometry.producer.tool, DESIGN_WRITE_GEOMETRY_TOOL);
  },
);

Deno.test("refuses admission and isolated geometry tools", () => {
  const step = artifact(
    "geometry-step-support-bracket",
    "step",
    STEP,
    "model/step",
    "design.execute-build123d@1",
    `/api/thread/assets/${STEP}.step`,
  );
  const result = attestCanonicalWriteGeometryStep(snapshot([step]), step, STEP);
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "isolated");
});

Deno.test("refuses a cad-asset STEP whose write-geometry parent is absent", () => {
  const step = cadAssetStep();
  const result = attestCanonicalWriteGeometryStep(snapshot([step]), step, STEP);
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "parent-absent");
});

function cadAssetStep(): ThreadArtifact {
  return artifact(
    `cad-asset-${CAPTURE}-target-0-${STEP}`,
    "step",
    STEP,
    "model/step",
    "build123d_export",
    `/api/thread/assets/${STEP}.step`,
  );
}

function writeGeometryPrimary(): ThreadArtifact {
  return artifact(
    `geometry-${CAPTURE}`,
    "cad-model",
    CAPTURE,
    "application/json",
    DESIGN_WRITE_GEOMETRY_TOOL,
    `casys://geometry-capture/sha256/${CAPTURE}`,
  );
}

function artifact(
  id: string,
  kind: ThreadArtifact["kind"],
  digest: string,
  mediaType: string,
  tool: string,
  uri: string,
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri,
    mediaType,
    producer: { serverId: "digital-thread", tool, runId: "run.geometry" },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-15T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function snapshot(artifacts: ThreadArtifact[]): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "snapshot.cad",
    revision: 1,
    generatedAt: "2026-08-15T00:00:00.000Z",
    subject: {
      id: "project:cad",
      name: "CAD",
      kind: "system",
      version: "r1",
      modelArtifactId: artifacts[0]!.id,
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-15T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change-set.cad",
      name: "CAD",
      status: "applied",
      createdAt: "2026-08-15T00:00:00.000Z",
      appliedAt: "2026-08-15T00:00:00.000Z",
      changes: [],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}
