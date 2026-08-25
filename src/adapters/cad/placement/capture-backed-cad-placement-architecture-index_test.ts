import { assertEquals } from "@std/assert";
import { parseExactArchitectureCapture } from "../../architecture/renderer/architecture-capture.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { CaptureBackedCadPlacementArchitectureIndex } from "./capture-backed-cad-placement-architecture-index.ts";

const AT = "2026-08-08T12:15:00.000Z";
const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("placement architecture index recrosses owner, immediate usages and typed_by from one capture", async () => {
  const capture = sliderCapture();
  const text = deterministicJson(capture);
  const index = new CaptureBackedCadPlacementArchitectureIndex({
    read: (fingerprint) =>
      Promise.resolve(fingerprint.digest === FINGERPRINT.digest ? text : undefined),
  });
  const facts = await index.open({
    artifactId: "architecture-" + "a".repeat(64),
    fingerprint: FINGERPRINT,
  });
  assertEquals(facts?.ownerDefinitionId("usage-left"), "def-system");
  assertEquals(facts?.immediateUsageIds("def-system"), [
    "usage-left",
    "usage-right",
  ]);
  assertEquals(facts?.typedDefinitionId("usage-left"), "def-rail");
  assertEquals(facts?.typedDefinitionId("usage-right"), "def-rail");
  assertEquals(
    await index.open({
      artifactId: "architecture-missing",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    }),
    undefined,
  );
});

function sliderCapture() {
  return parseExactArchitectureCapture({
    schemaVersion: "architecture-capture/4.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: "run:architecture",
    packageName: "Slider",
    systemName: "Slider",
    scopeRoot: { id: "package-slider", kind: "Package", label: "Slider" },
    semanticRoot: {
      id: "def-system",
      kind: "PartDefinition",
      label: "Slider",
    },
    seed: {
      artifactId: "artifact:seed",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      producerRunId: "run:seed",
    },
    partDefinitions: [{
      id: "def-system",
      kind: "PartDefinition",
      label: "Slider",
      usages: [{
        id: "usage-left",
        kind: "PartUsage",
        label: "left_rail",
        targetId: "def-rail",
        targetKind: "PartDefinition",
        targetLabel: "Rail",
      }, {
        id: "usage-right",
        kind: "PartUsage",
        label: "right_rail",
        targetId: "def-rail",
        targetKind: "PartDefinition",
        targetLabel: "Rail",
      }],
    }, {
      id: "def-rail",
      kind: "PartDefinition",
      label: "Rail",
      usages: [],
    }],
    insertedAt: AT,
    sourceAnalyses: [{
      sourceId: "sysml-source:slider",
      selector: { kind: "full-package", packageName: "Slider" },
      runId: "run:architecture",
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      sourceCaptureFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      analysisFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    }],
  });
}
