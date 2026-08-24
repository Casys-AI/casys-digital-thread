import { assertEquals, assertThrows } from "@std/assert";
import { ARCHITECTURE_CAPTURE_SCHEMA } from "../renderer/architecture-capture.ts";
import { parseExactArchitectureCapture } from "../renderer/architecture-capture.ts";
import {
  parseExactPartDefinitionsCapture,
  PART_DEFINITIONS_CAPTURE_SCHEMA,
} from "./part-definitions-capture.ts";

const AT = "2026-08-08T12:15:00.000Z";

function fingerprint(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

function partDefinitions() {
  return [{
    id: "part-def-system",
    kind: "PartDefinition",
    label: "LampSystem",
    usages: [{
      id: "part-usage-arm",
      kind: "PartUsage",
      label: "arm",
      targetId: "part-def-arm",
      targetKind: "PartDefinition",
      targetLabel: "Arm",
    }],
  }, {
    id: "part-def-arm",
    kind: "PartDefinition",
    label: "Arm",
    usages: [],
  }];
}

function validCapture(): Record<string, unknown> {
  return {
    schemaVersion: PART_DEFINITIONS_CAPTURE_SCHEMA,
    kind: "part-definitions",
    scope: "sealed-architecture-subgraph",
    statement:
      "Read-only re-read of the exact PartDefinition subgraph sealed by the generic architecture capture. Sibling PartDefinitions added in SysON after that capture are not observed. No CAD, physics, quantity inference, manufacturing claim or verdict is recorded.",
    capturedAt: AT,
    trustedRunId: "run:part-definitions",
    operation: { id: "model.capture-part-definitions", version: "1" },
    architecture: {
      artifactId: "architecture-" + "e".repeat(64),
      fingerprint: fingerprint("e"),
      producerRunId: "run:architecture",
      uri: `casys://architecture-capture/sha256/${"e".repeat(64)}`,
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
      packageName: "LampPackage",
      systemName: "LampSystem",
      scopeRoot: { id: "package-lamp", kind: "Package", label: "LampPackage" },
      semanticRoot: {
        id: "part-def-system",
        kind: "PartDefinition",
        label: "LampSystem",
      },
    },
    seed: {
      artifactId: "syson-model-seed-" + "d".repeat(64),
      fingerprint: fingerprint("d"),
      producerRunId: "run:seed",
      editingContextId: "ctx-1",
      rootPackageId: "root-1",
    },
    partDefinitions: partDefinitions(),
  };
}

Deno.test("part-definitions-capture/1.0 rejects extra or missing top-level keys", () => {
  assertEquals(
    parseExactPartDefinitionsCapture(validCapture()).schemaVersion,
    PART_DEFINITIONS_CAPTURE_SCHEMA,
  );
  const extra = validCapture();
  extra.recipe = "forbidden";
  assertThrows(() => parseExactPartDefinitionsCapture(extra));
  const missing = validCapture();
  delete missing.seed;
  assertThrows(() => parseExactPartDefinitionsCapture(missing));
  const quantity = validCapture();
  quantity.quantity = 1;
  assertThrows(() => parseExactPartDefinitionsCapture(quantity));
});

Deno.test(
  "part-definitions-capture/1.0 rejects a PartUsage whose target is not a sealed PartDefinition",
  () => {
    const capture = validCapture();
    const parts = capture.partDefinitions as Array<{
      usages: Array<{ targetId: string; targetLabel: string }>;
    }>;
    parts[0]!.usages[0]!.targetId = "part-def-unknown";
    assertThrows(() => parseExactPartDefinitionsCapture(capture));
    parts[0]!.usages[0]!.targetId = "part-def-arm";
    parts[0]!.usages[0]!.targetLabel = "Unknown";
    assertThrows(() => parseExactPartDefinitionsCapture(capture));
  },
);

Deno.test("part-definitions-capture/1.0 cannot be parsed as architecture-capture/4.0", () => {
  assertThrows(() => parseExactArchitectureCapture(validCapture()));
});
