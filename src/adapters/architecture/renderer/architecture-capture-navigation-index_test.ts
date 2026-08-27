import { assertEquals } from "@std/assert";
import { parseExactArchitectureCapture } from "./architecture-capture.ts";
import { architectureCaptureNavigationIndex } from "./architecture-capture-navigation-index.ts";
import { productStructureElementRef } from "../../../domain/architecture/product-structure-ref.ts";

const AT = "2026-08-08T12:15:00.000Z";

Deno.test(
  "architecture capture navigation index keeps two PartUsage occurrences of one definition distinct",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const root = index.root();
    assertEquals(root?.element, {
      elementKind: "PartDefinition",
      elementId: "def-system",
    });
    assertEquals(root?.occurrence, undefined);
    assertEquals(root?.expandable, true);
    const children = index.childrenOfRoot();
    assertEquals(children.map((node) => node.element.elementId), [
      "usage-left",
      "usage-right",
    ]);
    assertEquals(children[0]?.typedDefinition?.elementId, "def-rail");
    assertEquals(children[1]?.typedDefinition?.elementId, "def-rail");
    assertEquals(children[0]?.occurrence?.path, ["usage-left"]);
    assertEquals(children[1]?.occurrence?.path, ["usage-right"]);
    assertEquals(
      children[0]?.element.elementId === children[1]?.element.elementId,
      false,
    );
  },
);

Deno.test(
  "architecture capture navigation index expands nested children from the typed definition",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const nested = index.childrenOf({
      element: productStructureElementRef("PartUsage", "usage-left"),
      path: ["usage-left"],
    });
    assertEquals(nested.length, 1);
    assertEquals(nested[0]?.element, {
      elementKind: "PartUsage",
      elementId: "usage-pad",
    });
    assertEquals(nested[0]?.typedDefinition, {
      elementKind: "PartDefinition",
      elementId: "def-pad",
    });
    assertEquals(nested[0]?.occurrence?.path, ["usage-left", "usage-pad"]);
    assertEquals(nested[0]?.expandable, false);
  },
);

Deno.test(
  "architecture capture navigation index exposes owner and immediate usage identities without labels",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    assertEquals(index.ownerDefinitionId("usage-left"), "def-system");
    assertEquals(index.ownerDefinitionId("usage-pad"), "def-rail");
    assertEquals(index.immediateUsageIds("def-system"), [
      "usage-left",
      "usage-right",
    ]);
    assertEquals(index.immediateUsageIds("def-rail"), ["usage-pad"]);
    assertEquals(index.typedDefinition("usage-left")?.element.elementId, "def-rail");
    assertEquals(index.ownerDefinitionId("usage-missing"), undefined);
  },
);

Deno.test(
  "architecture capture navigation index recrosses an exact occurrence path and rejects a foreign usage",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const path = index.path(["usage-left", "usage-pad"]);
    assertEquals(path?.map((node) => node.element.elementId), [
      "def-system",
      "usage-left",
      "usage-pad",
    ]);
    assertEquals(index.path(["usage-missing"]), undefined);
    assertEquals(index.path(["usage-pad"]), undefined);
  },
);

Deno.test(
  "architecture capture navigation index uses sealed semanticRoot.id, not array order",
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
        id: "def-rail",
        kind: "PartDefinition",
        label: "Rail",
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
    assertEquals(index.root()?.element.elementId, "def-system");
    assertEquals(index.root()?.element.elementId === "def-rail", false);
  },
);

Deno.test(
  "architecture capture navigation index refuses an unreachable PartDefinition before traversal",
  () => {
    const capture = parseExactArchitectureCapture({
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
    assertEquals(index.root(), undefined);
    assertEquals(
      index.pageOccurrences(
        productStructureElementRef("PartDefinition", "def-rail"),
        0,
        50,
      ).items,
      [],
    );
  },
);

Deno.test(
  "architecture capture navigation index enumerates reused definition occurrences without search expanding the tree",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    assertEquals(
      index.pageOccurrences(
        productStructureElementRef("PartDefinition", "def-system"),
        0,
        50,
      ).items,
      [],
    );
    assertEquals(
      index.pageOccurrences(
        productStructureElementRef("PartDefinition", "def-rail"),
        0,
        50,
      ).items.map((node) => node.occurrence?.path),
      [["usage-left"], ["usage-right"]],
    );
    const first = index.pageOccurrences(
      productStructureElementRef("PartDefinition", "def-rail"),
      0,
      1,
    );
    assertEquals(first.items.map((node) => node.occurrence?.path), [[
      "usage-left",
    ]]);
    assertEquals(first.nextOffset, 1);
    const second = index.pageOccurrences(
      productStructureElementRef("PartDefinition", "def-rail"),
      1,
      1,
    );
    assertEquals(second.items.map((node) => node.occurrence?.path), [[
      "usage-right",
    ]]);
    assertEquals(second.nextOffset, null);
    const many = architectureCaptureNavigationIndex(manyRailCapture());
    const firstMany = many.pageOccurrences(
      productStructureElementRef("PartDefinition", "def-rail"),
      0,
      2,
    );
    assertEquals(
      firstMany.items.map((node) => node.occurrence?.path),
      [["usage-left"], ["usage-mid"]],
    );
    assertEquals(firstMany.nextOffset, 2);
    const secondMany = many.pageOccurrences(
      productStructureElementRef("PartDefinition", "def-rail"),
      2,
      2,
    );
    assertEquals(
      secondMany.items.map((node) => node.occurrence?.path),
      [["usage-rear"], ["usage-right"]],
    );
    assertEquals(secondMany.nextOffset, null);
    const exact = index.searchElements({
      kind: "exact-id",
      elementId: "def-rail",
    });
    assertEquals(exact, [{
      element: { elementKind: "PartDefinition", elementId: "def-rail" },
      label: "Rail",
      match: "exact-id",
    }]);
    const around = index.neighborhood({
      element: productStructureElementRef("PartUsage", "usage-left"),
      path: ["usage-left"],
    });
    assertEquals(around.parent?.element.elementId, "def-system");
    assertEquals(
      around.siblings.map((node) => node.element.elementId),
      ["usage-right"],
    );
    assertEquals(
      around.children.map((node) => node.element.elementId),
      ["usage-pad"],
    );
  },
);

Deno.test(
  "architecture capture navigation index text search matches normalized label and id tokens as exact element refs",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    const byLabel = index.searchElements({ kind: "text", text: "rail" });
    assertEquals(
      byLabel.map((hit) => [hit.element.elementKind, hit.element.elementId, hit.match]),
      [
        ["PartDefinition", "def-rail", "id-token"],
        ["PartUsage", "usage-left", "label-token"],
        ["PartUsage", "usage-right", "label-token"],
      ],
    );
    assertEquals(
      index.searchElements({ kind: "text", text: "latest" }),
      [],
    );
  },
);

Deno.test(
  "architecture capture navigation index hasElement matches exact id and SysML kind, not occurrence heuristics",
  () => {
    const index = architectureCaptureNavigationIndex(capture());
    assertEquals(
      index.hasElement(productStructureElementRef("PartDefinition", "def-rail")),
      true,
    );
    assertEquals(
      index.hasElement({ elementKind: "PartUsage", elementId: "def-rail" }),
      false,
    );
    assertEquals(
      index.hasElement(productStructureElementRef("PartUsage", "usage-left")),
      true,
    );
    assertEquals(
      index.hasElement({
        elementKind: "PartDefinition",
        elementId: "usage-left",
      }),
      false,
    );
    assertEquals(
      index.hasElement({
        elementKind: "PartDefinition",
        elementId: "latest",
      }),
      false,
    );
    assertEquals(
      index.hasElement({
        elementKind: "PartDefinition",
        elementId: "missing",
      }),
      false,
    );
  },
);

function manyRailCapture() {
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
        id: "usage-mid",
        kind: "PartUsage",
        label: "mid_rail",
        targetId: "def-rail",
        targetKind: "PartDefinition",
        targetLabel: "Rail",
      }, {
        id: "usage-rear",
        kind: "PartUsage",
        label: "rear_rail",
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
