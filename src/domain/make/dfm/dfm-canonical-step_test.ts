import { assertEquals } from "@std/assert";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import {
  attestCanonicalWriteGeometryStep,
  DESIGN_WRITE_GEOMETRY_TOOL,
} from "./dfm-canonical-step.ts";

/** Live ID01 CameraBoardEnvelope write-geometry capture digest. */
const CAPTURE = "b59023102670e06b4e33e534d05008c0fe2440ae91dafbaa9c256c92a4ebe3e8";
/** Live CameraBoardEnvelope authoritative STEP digest (target-0). */
const STEP = "2572f73de4a8607fbd963642778019cfa742d6e06d9dd01a37294c0d3e7d8b5f";

Deno.test(
  "attests the live CameraBoardEnvelope cad-asset STEP via its write-geometry parent",
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
    assertEquals(result.step.producer.tool, "build123d_export");
    assertEquals(result.step.mediaType, "model/step");
  },
);

Deno.test("attests a PartDefinition cad-asset STEP the same way as a target child", () => {
  const step = artifact(
    `cad-asset-${CAPTURE}-definition-0-0-${STEP}`,
    "step",
    STEP,
    "model/step",
    "build123d_export",
    `/api/thread/assets/${STEP}.step`,
  );
  const result = attestCanonicalWriteGeometryStep(
    snapshot([writeGeometryPrimary(), step]),
    step,
    STEP,
  );
  assertEquals(result.status, "attested");
});

Deno.test("still attests a historical same-artefact write-geometry STEP", () => {
  const step = artifact(
    "geometry-step-support-bracket",
    "step",
    STEP,
    "model/step",
    DESIGN_WRITE_GEOMETRY_TOOL,
    `/api/thread/assets/${STEP}.step`,
  );
  const result = attestCanonicalWriteGeometryStep(snapshot([step]), step, STEP);
  assertEquals(result.status, "attested");
  if (result.status !== "attested") return;
  assertEquals(result.geometry.id, step.id);
});

Deno.test("refuses the JSON write-geometry primary as a DFM STEP target", () => {
  const geometry = writeGeometryPrimary();
  const result = attestCanonicalWriteGeometryStep(
    snapshot([geometry]),
    geometry,
    STEP,
  );
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "media-type");
});

Deno.test("refuses a cad-asset STEP whose write-geometry parent is absent", () => {
  const step = cadAssetStep();
  const result = attestCanonicalWriteGeometryStep(snapshot([step]), step, STEP);
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "parent-absent");
  assertEquals(result.message.includes(`geometry-${CAPTURE}`), true);
});

Deno.test("refuses a cad-asset STEP owned by isolated geometry", () => {
  const step = cadAssetStep();
  const geometry = artifact(
    `geometry-${CAPTURE}`,
    "cad-model",
    CAPTURE,
    "application/json",
    "design.seal-isolated-geometry@1",
    `casys://geometry-capture/sha256/${CAPTURE}`,
  );
  const result = attestCanonicalWriteGeometryStep(
    snapshot([geometry, step]),
    step,
    STEP,
  );
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "parent-isolated");
  assertEquals(result.message.includes("design.seal-isolated-geometry@1"), true);
});

Deno.test("refuses an isolated STEP even when mediaType is model/step", () => {
  const step = artifact(
    "isolated-step",
    "step",
    STEP,
    "model/step",
    "design.seal-isolated-geometry@1",
    `/api/thread/assets/${STEP}.step`,
  );
  const result = attestCanonicalWriteGeometryStep(snapshot([step]), step, STEP);
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "isolated");
});

Deno.test("refuses an opaque cad-asset id that does not name its capture", () => {
  const step = artifact(
    `cad-asset-${STEP}`,
    "step",
    STEP,
    "model/step",
    "build123d_export",
    `/api/thread/assets/${STEP}.step`,
  );
  const result = attestCanonicalWriteGeometryStep(
    snapshot([writeGeometryPrimary(), step]),
    step,
    STEP,
  );
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "not-canonical");
});

Deno.test("refuses an assembly cad-asset STEP that does not name a part owner", () => {
  const step = artifact(
    `cad-asset-${CAPTURE}-assembly-0-${STEP}`,
    "step",
    STEP,
    "model/step",
    "build123d_export",
    `/api/thread/assets/${STEP}.step`,
  );
  const result = attestCanonicalWriteGeometryStep(
    snapshot([writeGeometryPrimary(), step]),
    step,
    STEP,
  );
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "not-canonical");
});

Deno.test("refuses a SHA-256 that does not match the named STEP", () => {
  const step = cadAssetStep();
  const result = attestCanonicalWriteGeometryStep(
    snapshot([writeGeometryPrimary(), step]),
    step,
    "0".repeat(64),
  );
  assertEquals(result.status, "refused");
  if (result.status !== "refused") return;
  assertEquals(result.code, "sha256");
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

function snapshot(artifacts: ThreadArtifact[]): ThreadSnapshot {
  return { artifacts } as unknown as ThreadSnapshot;
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
    producer: { serverId: "digital-thread", tool, runId: "run:fixture" },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-09-11T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}
