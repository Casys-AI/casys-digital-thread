import { assertEquals, assertRejects } from "@std/assert";
import { sha256Hex } from "../../kernel/deterministic-json.ts";
import { geometrySourceIdFor } from "../source/geometry-source-analysis-reference.ts";
import {
  parseCanonicalGeometryCapture,
  parseGeometryPartCapture,
} from "./geometry-part-capture.ts";

const fp = (digest: string) => ({ algorithm: "sha256" as const, digest });

Deno.test("complete geometry-part capture parses through the shared canonical authority", async () => {
  const capture = await validCapture();
  const parsed = await parseGeometryPartCapture(capture);
  assertEquals(parsed.schemaVersion, "geometry-part-capture/1.0");
  assertEquals(parsed.sourceScript.authoritativeStep.bytes, 321);
  assertEquals(
    (await parseCanonicalGeometryCapture(capture)).schemaVersion,
    "geometry-part-capture/1.0",
  );
});

Deno.test("geometry-part capture rejects non-closed and divergent evidence", async () => {
  const capture = await validCapture();
  await assertRejects(() => parseGeometryPartCapture({ ...capture, verdict: "pass" }));
  await assertRejects(() =>
    parseGeometryPartCapture({
      ...capture,
      sourceScript: {
        ...capture.sourceScript,
        authoritativeStep: {
          ...capture.sourceScript.authoritativeStep,
          bytes: 0,
        },
      },
    })
  );
  await assertRejects(() =>
    parseGeometryPartCapture({
      ...capture,
      sourceScript: {
        ...capture.sourceScript,
        partDefinitionElementId: "definition:other",
      },
    })
  );
  await assertRejects(() =>
    parseGeometryPartCapture({
      ...capture,
      sourceScript: {
        ...capture.sourceScript,
        scriptHash: fp("9".repeat(64)),
      },
    })
  );
  await assertRejects(() =>
    parseGeometryPartCapture({
      ...capture,
      sourceAnalysis: { ...capture.sourceAnalysis, sourceText: "forbidden" },
    })
  );
});

async function validCapture() {
  // SysML provider identities are opaque. Slash and hash are valid exact bytes
  // even though they are deliberately outside the Casys safe-id alphabet.
  const targetId = "definition/arm#1";
  const label = "Arm";
  const script = "width = 10\nfrom build123d import Box\nresult = Box(width, 2, 3)\n";
  const scriptHash = fp(
    await sha256Hex(new TextEncoder().encode(script)),
  );
  const architectureFingerprint = fp("a".repeat(64));
  const admissionFingerprint = fp("b".repeat(64));
  const stepFingerprint = fp("c".repeat(64));
  const glbFingerprint = fp("d".repeat(64));
  const selector = { kind: "part-definition" as const, elementId: targetId };
  return {
    schemaVersion: "geometry-part-capture/1.0" as const,
    operation: { id: "design.write-geometry" as const, version: "1" as const },
    trustedRunId: "run:geometry-part",
    draftDigest: "e".repeat(64),
    manifest: {
      schemaVersion: "geometry-part-manifest/1.0" as const,
      architectureBasis: {
        snapshotId: "snapshot:architecture",
        revision: 1,
        artifactFingerprint: architectureFingerprint,
      },
      target: {
        partDefinitionElementId: targetId,
        label,
        scriptHash,
        files: [
          { format: "step" as const, name: "arm.step", fingerprint: stepFingerprint },
          { format: "gltf" as const, name: "arm.glb", fingerprint: glbFingerprint },
        ],
      },
      unitSystem: "mm" as const,
      exportFormats: ["step" as const, "gltf" as const],
    },
    architectureBasis: {
      artifactId: `architecture-${architectureFingerprint.digest}`,
      fingerprint: architectureFingerprint,
      producerRunId: "run:architecture",
    },
    previewProducer: {
      serverId: "build123d-sandbox" as const,
      tool: "build123d_export" as const,
      runId: "run:preview",
    },
    sourceScript: {
      partDefinitionElementId: targetId,
      label,
      script,
      scriptHash,
      admission: {
        schemaVersion: "geometry-draft-admission/2.0" as const,
        artifactId: `technical-compilation-admission-${admissionFingerprint.digest}`,
        fingerprint: admissionFingerprint,
        sourceFingerprint: scriptHash,
        target: { partDefinitionElementId: targetId, label },
      },
      authoritativeStep: {
        fileIndex: 0,
        fingerprint: stepFingerprint,
        bytes: 321,
      },
    },
    sourceAnalysis: {
      sourceId: await geometrySourceIdFor(selector),
      selector,
      sourceFingerprint: scriptHash,
      sourceCaptureFingerprint: fp("f".repeat(64)),
      analysisFingerprint: fp("1".repeat(64)),
    },
    sealedAt: "2026-08-25T10:00:00.000Z",
  };
}
