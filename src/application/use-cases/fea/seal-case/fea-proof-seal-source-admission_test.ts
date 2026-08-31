import { assertEquals } from "@std/assert";
import type { FeaProofDecisionParameters } from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { sha256Hex } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { admitFeaProofSealSource } from "./fea-proof-seal-source-admission.ts";

const GEOM_DIGEST = "b".repeat(64);
const TARGET_ID = "7dda85d1-764e-4329-95ea-09052355cc47";
const STEP_BYTES = 15460;
const STEP_BYTES_DATA = new Uint8Array(STEP_BYTES);
const STEP_DIGEST = await sha256Hex(STEP_BYTES_DATA);
const ADMISSION_DIGEST = "d".repeat(64);

Deno.test("seal source admission reopens the geometry capture and canonical STEP bytes", async () => {
  const admitted = await admitFeaProofSealSource(world());
  assertEquals(admitted.status, "admitted");
  if (admitted.status !== "admitted") return;
  assertEquals(admitted.geometryArtifact.id, `geometry-${GEOM_DIGEST}`);
  assertEquals(
    admitted.stepArtifact.id,
    `cad-asset-${GEOM_DIGEST}-definition-0-0-${STEP_DIGEST}`,
  );
  assertEquals(admitted.stepBytes, STEP_BYTES);
});

Deno.test("an unreadable geometry capture is unavailable, not resolved", async () => {
  const admitted = await admitFeaProofSealSource({
    ...world(),
    geometryCaptures: { read: () => Promise.resolve(undefined) },
  });
  assertEquals(admitted.status, "unavailable");
  if (admitted.status === "unavailable") {
    assertEquals(admitted.diagnostic.code, "geometry-capture-unavailable");
  }
});

Deno.test("geometry-capture/2.0 is rejected by FEA source admission", async () => {
  const admitted = await admitFeaProofSealSource({
    ...world(),
    geometryCaptures: {
      read: () =>
        Promise.resolve(JSON.stringify({
          schemaVersion: "geometry-capture/2.0",
          manifest: {
            partDefinitions: [{
              elementId: TARGET_ID,
              files: [{
                format: "step",
                fingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
              }],
            }],
          },
        })),
    },
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "geometry-capture-invalid");
  }
});

Deno.test("a target missing from the geometry capture stays unresolved", async () => {
  const admitted = await admitFeaProofSealSource({
    ...world(),
    geometryCaptures: {
      read: () => Promise.resolve(captureText({ elementId: "other-part" })),
    },
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "geometry-capture-invalid");
  }
});

Deno.test("unreadable canonical STEP bytes are unavailable", async () => {
  const admitted = await admitFeaProofSealSource({
    ...world(),
    stepAssets: {
      read: () => Promise.reject(new Error("digest not found")),
    },
  });
  assertEquals(admitted.status, "unavailable");
  if (admitted.status === "unavailable") {
    assertEquals(admitted.diagnostic.code, "step-unavailable");
  }
});

Deno.test("a STEP byte-count mismatch stays unresolved", async () => {
  const admitted = await admitFeaProofSealSource({
    ...world(),
    stepAssets: { read: () => Promise.resolve(new Uint8Array(12)) },
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "step-mismatch");
  }
});

Deno.test("a STEP SHA-256 mismatch against the read bytes stays unresolved", async () => {
  const admitted = await admitFeaProofSealSource({
    ...world(),
    stepAssets: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES).fill(1)) },
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "step-mismatch");
  }
});

Deno.test("a target PartDefinition capture admits only its exact canonical STEP", async () => {
  const admitted = await admitFeaProofSealSource(targetWorld());
  assertEquals(admitted.status, "admitted");
  if (admitted.status !== "admitted") return;
  assertEquals(
    admitted.stepArtifact.id,
    `cad-asset-${GEOM_DIGEST}-target-0-${STEP_DIGEST}`,
  );
  assertEquals(admitted.stepBytes, STEP_BYTES);
});

Deno.test("a target PartDefinition capture rejects a proof for another model element", async () => {
  const input = targetWorld();
  const admitted = await admitFeaProofSealSource({
    ...input,
    decisionParams: {
      ...input.decisionParams,
      target: { id: "other", modelElementId: "other-definition" },
    },
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "geometry-capture-invalid");
  }
});

Deno.test("a target PartDefinition capture rejects mismatched authoritative STEP bytes", async () => {
  const admitted = await admitFeaProofSealSource({
    ...targetWorld(),
    geometryCaptures: {
      read: () => Promise.resolve(targetCaptureText({ stepBytes: STEP_BYTES + 1 })),
    },
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "step-mismatch");
  }
});

Deno.test("a cad-model artifact is never accepted as target proof geometry", async () => {
  const input = targetWorld();
  const badStep = {
    ...input.snapshot.artifacts[1],
    kind: "cad-model" as const,
  };
  const admitted = await admitFeaProofSealSource({
    ...input,
    snapshot: {
      ...input.snapshot,
      artifacts: [input.snapshot.artifacts[0], badStep],
    } as ThreadSnapshot,
  });
  assertEquals(admitted.status, "unresolved");
  if (admitted.status === "unresolved") {
    assertEquals(admitted.diagnostic.code, "step-mismatch");
  }
});

function world() {
  const geometryId = `geometry-${GEOM_DIGEST}`;
  const stepId = `cad-asset-${GEOM_DIGEST}-definition-0-0-${STEP_DIGEST}`;
  const geometryArtifact = artifact(geometryId, "cad-model", GEOM_DIGEST, {
    uri: `casys://geometry-capture/sha256/${GEOM_DIGEST}`,
    mediaType: "application/json",
  });
  const stepArtifact = artifact(stepId, "step", STEP_DIGEST, {
    uri: `/api/thread/assets/${STEP_DIGEST}.step`,
    mediaType: "model/step",
  });
  return {
    snapshot: {
      artifacts: [geometryArtifact, stepArtifact],
    } as unknown as ThreadSnapshot,
    decisionParams: {
      geometryArtifact: {
        id: geometryId,
        fingerprint: fp(GEOM_DIGEST),
      },
      target: { id: "arm", modelElementId: TARGET_ID },
      step: { digest: STEP_DIGEST, bytes: STEP_BYTES },
    } as FeaProofDecisionParameters,
    geometryCaptures: {
      read: () => Promise.resolve(captureText()),
    },
    stepAssets: {
      read: () => Promise.resolve(STEP_BYTES_DATA),
    },
  };
}

function targetWorld() {
  const geometryId = `geometry-${GEOM_DIGEST}`;
  const stepId = `cad-asset-${GEOM_DIGEST}-target-0-${STEP_DIGEST}`;
  const geometryArtifact = artifact(geometryId, "cad-model", GEOM_DIGEST, {
    uri: `casys://geometry-capture/sha256/${GEOM_DIGEST}`,
    mediaType: "application/json",
  });
  const stepArtifact = artifact(stepId, "step", STEP_DIGEST, {
    uri: `/api/thread/assets/${STEP_DIGEST}.step`,
    mediaType: "model/step",
  });
  return {
    snapshot: {
      artifacts: [geometryArtifact, stepArtifact],
    } as unknown as ThreadSnapshot,
    decisionParams: {
      geometryArtifact: {
        id: geometryId,
        fingerprint: fp(GEOM_DIGEST),
      },
      target: { id: "arm", modelElementId: TARGET_ID },
      step: { digest: STEP_DIGEST, bytes: STEP_BYTES },
    } as FeaProofDecisionParameters,
    geometryCaptures: {
      read: () => Promise.resolve(targetCaptureText()),
    },
    stepAssets: {
      read: () => Promise.resolve(STEP_BYTES_DATA),
    },
  };
}

function captureText(
  options: { readonly elementId?: string } = {},
): string {
  return JSON.stringify({
    schemaVersion: "geometry-capture/2.1",
    manifest: {
      partDefinitions: [{
        elementId: options.elementId ?? TARGET_ID,
        files: [{
          format: "step",
          fingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
        }],
      }],
    },
  });
}

function targetCaptureText(
  options: { readonly elementId?: string; readonly stepBytes?: number } = {},
): string {
  return JSON.stringify({
    schemaVersion: "geometry-part-capture/1.0",
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: "run-geom",
    draftDigest: "a".repeat(64),
    manifest: {
      schemaVersion: "geometry-part-manifest/1.0",
      architectureBasis: {
        snapshotId: "thread:r1",
        revision: 1,
        artifactFingerprint: fp("a".repeat(64)),
      },
      unitSystem: "mm",
      exportFormats: ["step", "gltf"],
      target: {
        partDefinitionElementId: options.elementId ?? TARGET_ID,
        label: "Arm",
        scriptHash: fp("c".repeat(64)),
        files: [{
          format: "step",
          name: "arm.step",
          fingerprint: fp(STEP_DIGEST),
        }, {
          format: "gltf",
          name: "arm.glb",
          fingerprint: fp("e".repeat(64)),
        }],
      },
    },
    architectureBasis: {
      artifactId: "architecture-a",
      fingerprint: fp("a".repeat(64)),
      producerRunId: "architecture-run",
    },
    previewProducer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "preview-arm",
    },
    sourceScript: {
      partDefinitionElementId: options.elementId ?? TARGET_ID,
      label: "Arm",
      script: "arm_length = 42\n",
      scriptHash: fp("c".repeat(64)),
      admission: {
        schemaVersion: "geometry-draft-admission/2.0",
        artifactId: `technical-compilation-admission-${ADMISSION_DIGEST}`,
        fingerprint: fp(ADMISSION_DIGEST),
        sourceFingerprint: fp("c".repeat(64)),
        target: {
          partDefinitionElementId: options.elementId ?? TARGET_ID,
          label: "Arm",
        },
      },
      authoritativeStep: {
        fileIndex: 0,
        fingerprint: fp(STEP_DIGEST),
        bytes: options.stepBytes ?? STEP_BYTES,
      },
    },
    sourceAnalysis: {},
    sealedAt: "2026-08-16T00:00:00.000Z",
  });
}

function artifact(
  id: string,
  kind: "cad-model" | "step",
  digest: string,
  extra: { readonly uri: string; readonly mediaType: string },
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: digest,
    fingerprint: fp(digest),
    uri: extra.uri,
    mediaType: extra.mediaType,
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run-geom",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-16T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}
