import { assertEquals } from "@std/assert";
import { parseExactArchitectureCapture } from "./architecture-capture.ts";
import { architectureCaptureNavigationIndex } from "./architecture-capture-navigation-index.ts";

const AT = "2026-08-08T12:15:00.000Z";

Deno.test(
  "architecture capture navigation index keeps two PartUsage occurrences of one definition distinct",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const root = index.root();
    assertEquals(root, {
      kind: "part-definition",
      id: "def-system",
      label: "Slider",
      definitionId: "def-system",
      path: [],
      expandable: true,
    });
    const children = index.childrenOf({
      kind: "part-definition",
      id: "def-system",
      path: [],
    });
    assertEquals(children.map((node) => node.usageId), [
      "usage-left",
      "usage-right",
    ]);
    assertEquals(children[0]?.definitionId, "def-rail");
    assertEquals(children[1]?.definitionId, "def-rail");
    assertEquals(children[0]?.path, ["usage-left"]);
    assertEquals(children[1]?.path, ["usage-right"]);
    assertEquals(children[0]?.id === children[1]?.id, false);
  },
);

Deno.test(
  "architecture capture navigation index expands nested children from the typed definition",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const nested = index.childrenOf({
      kind: "part-usage",
      id: "usage-left",
      path: ["usage-left"],
    });
    assertEquals(nested, [{
      kind: "part-usage",
      id: "usage-pad",
      label: "pad",
      definitionId: "def-pad",
      usageId: "usage-pad",
      path: ["usage-left", "usage-pad"],
      expandable: false,
    }]);
  },
);

Deno.test(
  "architecture capture navigation index recrosses an exact occurrence path and rejects a foreign usage",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const path = index.path(["usage-left", "usage-pad"]);
    assertEquals(path?.map((node) => node.id), [
      "def-system",
      "usage-left",
      "usage-pad",
    ]);
    assertEquals(index.path(["usage-missing"]), undefined);
    assertEquals(index.path(["usage-pad"]), undefined);
  },
);

Deno.test(
  "architecture capture navigation index uses sealed semanticRoot.id, not topology",
  () => {
    const capture = parseExactArchitectureCapture({
      schemaVersion: "architecture-capture/4.0",
      operation: { id: "model.write-architecture", version: "1" },
      trustedRunId: "run:architecture",
      packageName: "Slider",
      systemName: "DisplayOnly",
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
      }],
      insertedAt: AT,
      sourceAnalyses: [{
        sourceId: "sysml-source:slider",
        selector: { kind: "full-package", packageName: "Slider" },
        runId: "run:architecture",
        operation: { id: "model.write-architecture", version: "1" },
        sourceFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        sourceCaptureFingerprint: {
          algorithm: "sha256",
          digest: "b".repeat(64),
        },
        analysisFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      }],
    });
    const index = architectureCaptureNavigationIndex(capture);
    assertEquals(index.root()?.id, "def-system");
    assertEquals(index.root()?.id === "def-orphan", false);
  },
);

Deno.test(
  "architecture capture navigation index locates a reused definition as two occurrence paths",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    assertEquals(
      index.locate("def-rail").map((node) => node.path),
      [["usage-left"], ["usage-right"]],
    );
    const around = index.neighborhood({
      kind: "part-usage",
      id: "usage-left",
      path: ["usage-left"],
    });
    assertEquals(around.parent?.id, "def-system");
    assertEquals(around.siblings.map((node) => node.id), ["usage-right"]);
    assertEquals(around.children.map((node) => node.id), ["usage-pad"]);
  },
);

Deno.test(
  "architecture capture navigation index hasElement matches exact id and SysML kind, not locate heuristics",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    assertEquals(
      index.hasElement({ id: "def-rail", kind: "PartDefinition" }),
      true,
    );
    assertEquals(
      index.hasElement({ id: "def-rail", kind: "PartUsage" }),
      false,
    );
    assertEquals(
      index.hasElement({ id: "usage-left", kind: "PartUsage" }),
      true,
    );
    assertEquals(
      index.hasElement({ id: "usage-left", kind: "PartDefinition" }),
      false,
    );
    assertEquals(
      index.locate("def-rail").map((node) => node.id),
      ["usage-left", "usage-right"],
    );
    assertEquals(
      index.hasElement({ id: "latest", kind: "PartDefinition" }),
      false,
    );
    assertEquals(
      index.hasElement({ id: "missing", kind: "PartDefinition" }),
      false,
    );
  },
);

function capture() {
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
      usages: [{
        id: "usage-pad",
        kind: "PartUsage",
        label: "pad",
        targetId: "def-pad",
        targetKind: "PartDefinition",
        targetLabel: "Pad",
      }],
    }, {
      id: "def-pad",
      kind: "PartDefinition",
      label: "Pad",
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
