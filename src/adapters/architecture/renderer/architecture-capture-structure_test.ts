import { assertEquals } from "@std/assert";
import { parseExactArchitectureCapture } from "./architecture-capture.ts";
import {
  architectureCaptureIsNavigable,
  inspectArchitectureCaptureStructure,
} from "./architecture-capture-structure.ts";
import { architectureCaptureNavigationIndex } from "./architecture-capture-navigation-index.ts";

const AT = "2026-08-08T12:15:00.000Z";

Deno.test("architecture capture structure rejects a PartDefinition cycle before Graphology indexing", () => {
  const capture = parseExactArchitectureCapture(cyclicCapture());
  assertEquals(inspectArchitectureCaptureStructure(capture), "cycle");
  assertEquals(architectureCaptureIsNavigable(capture), false);
  assertEquals(architectureCaptureNavigationIndex(capture).root(), undefined);
});

Deno.test("architecture capture structure rejects an unreachable PartDefinition before Graphology indexing", () => {
  const capture = parseExactArchitectureCapture(unreachableCapture());
  assertEquals(inspectArchitectureCaptureStructure(capture), "unreachable");
  assertEquals(architectureCaptureIsNavigable(capture), false);
  assertEquals(architectureCaptureNavigationIndex(capture).root(), undefined);
});

function cyclicCapture() {
  return structureCapture([{
    id: "def-system",
    kind: "PartDefinition",
    label: "Slider",
    usages: [{
      id: "usage-a",
      kind: "PartUsage",
      label: "a",
      targetId: "def-a",
      targetKind: "PartDefinition",
      targetLabel: "A",
    }],
  }, {
    id: "def-a",
    kind: "PartDefinition",
    label: "A",
    usages: [{
      id: "usage-b",
      kind: "PartUsage",
      label: "b",
      targetId: "def-b",
      targetKind: "PartDefinition",
      targetLabel: "B",
    }],
  }, {
    id: "def-b",
    kind: "PartDefinition",
    label: "B",
    usages: [{
      id: "usage-back",
      kind: "PartUsage",
      label: "back",
      targetId: "def-a",
      targetKind: "PartDefinition",
      targetLabel: "A",
    }],
  }]);
}

function unreachableCapture() {
  return structureCapture([{
    id: "def-orphan",
    kind: "PartDefinition",
    label: "Orphan",
    usages: [],
  }, {
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
    }],
  }, {
    id: "def-rail",
    kind: "PartDefinition",
    label: "Rail",
    usages: [],
  }]);
}

function structureCapture(
  partDefinitions: readonly Record<string, unknown>[],
) {
  return {
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
    partDefinitions,
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
  };
}
