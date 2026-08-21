import { assertEquals, assertThrows } from "@std/assert";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
  architectureGraphFromCapture,
  buildExactArchitectureCapture,
  extractPartDefinitionsFromCapture,
  parseArchitectureCapturePartDefinitions,
  parseExactArchitectureCapture,
} from "./architecture-capture.ts";
import { parseExactPartDefinitionsCapture } from "../part-definitions/part-definitions-capture.ts";

const RUN_ID = "run:architecture";
const PACKAGE_NAME = "DroneV4";
const AT = "2026-08-08T12:15:00.000Z";

function fingerprint(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

function sourceReference() {
  return {
    sourceId: "sysml-source:drone-v4",
    selector: { kind: "full-package" as const, packageName: PACKAGE_NAME },
    runId: RUN_ID,
    operation: { id: "model.write-architecture", version: "1" },
    sourceFingerprint: fingerprint("a"),
    sourceCaptureFingerprint: fingerprint("b"),
    analysisFingerprint: fingerprint("c"),
  };
}

function baseCapture() {
  return {
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: RUN_ID,
    packageName: PACKAGE_NAME,
    systemName: "DroneSystem",
    package: { id: "package-drone-v4", label: PACKAGE_NAME },
    seed: {
      artifactId: "artifact:seed",
      fingerprint: fingerprint("d"),
      producerRunId: "run:seed",
    },
    partDefinitions: [{
      id: "part-def-drone-system",
      kind: "PartDefinition",
      label: "DroneSystem",
      usages: [{
        id: "part-usage-wing",
        kind: "PartUsage",
        label: "wing",
        targetId: "part-def-wing",
        targetKind: "PartDefinition",
        targetLabel: "Wing",
      }],
    }, {
      id: "part-def-wing",
      kind: "PartDefinition",
      label: "Wing",
      usages: [],
    }],
    insertedAt: AT,
  };
}

function currentCapture(): Record<string, unknown> {
  return {
    schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
    ...baseCapture(),
    sourceAnalyses: [sourceReference()],
  };
}

Deno.test("architecture capture parser bi-reads exact historical v2 and current v3", () => {
  assertEquals(
    parseExactArchitectureCapture({
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
      ...baseCapture(),
    }).schemaVersion,
    ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
  );
  const current = parseExactArchitectureCapture(currentCapture());
  assertEquals(current.schemaVersion, ARCHITECTURE_CAPTURE_SCHEMA);
  if (current.schemaVersion === ARCHITECTURE_CAPTURE_SCHEMA) {
    assertEquals(current.sourceAnalyses, [sourceReference()]);
  }
});
Deno.test("current architecture capture requires non-empty exact source analyses", () => {
  const missing = currentCapture();
  delete missing.sourceAnalyses;
  assertThrows(() => parseExactArchitectureCapture(missing));
  assertThrows(() =>
    parseExactArchitectureCapture({ ...currentCapture(), sourceAnalyses: [] })
  );

  const malformed = currentCapture();
  const [reference] = malformed.sourceAnalyses as Record<string, unknown>[];
  reference!.unexpected = true;
  assertThrows(() => parseExactArchitectureCapture(malformed));
});

Deno.test("current architecture capture rejects foreign run operation and package", () => {
  for (
    const mutate of [
      (reference: Record<string, unknown>) => {
        reference.runId = "run:foreign";
      },
      (reference: Record<string, unknown>) => {
        reference.operation = { id: "model.write-requirements", version: "1" };
      },
      (reference: Record<string, unknown>) => {
        reference.selector = {
          kind: "full-package",
          packageName: "ForeignPackage",
        };
      },
    ]
  ) {
    const capture = currentCapture();
    const [reference] = capture.sourceAnalyses as Record<string, unknown>[];
    mutate(reference!);
    assertThrows(() => parseExactArchitectureCapture(capture));
  }
});

Deno.test("current architecture capture rejects repeated references and selectors", () => {
  const reference = sourceReference();
  assertThrows(() =>
    parseExactArchitectureCapture({
      ...currentCapture(),
      sourceAnalyses: [reference, reference],
    })
  );
  assertThrows(() =>
    parseExactArchitectureCapture({
      ...currentCapture(),
      sourceAnalyses: [
        reference,
        { ...reference, sourceId: "sysml-source:duplicate-selector" },
      ],
    })
  );
});

Deno.test(
  "parseExactArchitectureCapture remains the only reader of architecture-capture/2.0 and 3.0 keys",
  async () => {
    const thisFile = await Deno.readTextFile(new URL(import.meta.url));
    const parser = await Deno.readTextFile(
      new URL("./architecture-capture.ts", import.meta.url),
    );
    const sibling = await Deno.readTextFile(
      new URL(
        "../part-definitions/part-definitions-capture.ts",
        import.meta.url,
      ),
    );
    const executor = await Deno.readTextFile(
      new URL(
        "../part-definitions/model-capture-part-definitions-run-executor.ts",
        import.meta.url,
      ),
    );
    assertEquals(
      parser.includes("export function parseExactArchitectureCapture"),
      true,
    );
    assertEquals(parser.includes("parseArchitectureCapturePartDefinitions("), true);
    assertEquals(sibling.includes("parseExactArchitectureCapture("), false);
    assertEquals(sibling.includes("parseArchitectureCapturePartDefinitions("), true);
    assertEquals(executor.includes("parseExactArchitectureCapture("), true);
    assertEquals(executor.includes("exactKeys("), false);
    assertEquals(thisFile.includes("architecture-capture/2.0"), true);
  },
);

Deno.test(
  "extractPartDefinitionsFromCapture returns the sealed PartDefinition graph without re-reading schema keys",
  () => {
    const parsed = parseExactArchitectureCapture(currentCapture());
    assertEquals(extractPartDefinitionsFromCapture(parsed), parsed.partDefinitions);
  },
);

Deno.test(
  "parseArchitectureCapturePartDefinitions is shared by architecture-capture and part-definitions-capture",
  () => {
    const shared = parseArchitectureCapturePartDefinitions(
      baseCapture().partDefinitions,
      "partDefinitions",
      ["package-drone-v4"],
    );
    const architecture = parseExactArchitectureCapture(currentCapture());
    assertEquals(architecture.partDefinitions, shared);

    const partDefinitionsCapture = parseExactPartDefinitionsCapture({
      schemaVersion: "part-definitions-capture/1.0",
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
        producerRunId: RUN_ID,
        uri: `casys://architecture-capture/sha256/${"e".repeat(64)}`,
        schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
        packageName: PACKAGE_NAME,
        systemName: "DroneSystem",
        package: { id: "package-drone-v4", label: PACKAGE_NAME },
      },
      seed: {
        artifactId: "artifact:seed",
        fingerprint: fingerprint("d"),
        producerRunId: "run:seed",
        editingContextId: "ctx-1",
        rootPackageId: "root-1",
      },
      partDefinitions: baseCapture().partDefinitions,
    });
    assertEquals(partDefinitionsCapture.partDefinitions, shared);
  },
);

Deno.test("historical v2 capture cannot be retrofitted with source analyses", () => {
  assertThrows(() =>
    parseExactArchitectureCapture({
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
      ...baseCapture(),
      sourceAnalyses: [sourceReference()],
    })
  );
});

function liveFromBase() {
  const capture = baseCapture();
  return {
    packageId: capture.package.id,
    packageLabel: capture.package.label,
    partDefs: capture.partDefinitions.map((part) => ({
      ...part,
      attributes: [],
    })),
  };
}

Deno.test("buildExactArchitectureCapture v2 omits sourceAnalyses and round-trips the parser", () => {
  const built = buildExactArchitectureCapture({
    trustedRunId: RUN_ID,
    packageName: PACKAGE_NAME,
    systemName: "DroneSystem",
    architecturePackage: baseCapture().package,
    seed: baseCapture().seed,
    live: liveFromBase(),
    insertedAt: AT,
  });
  assertEquals(built.schemaVersion, ARCHITECTURE_CAPTURE_SCHEMA_LEGACY);
  assertEquals("sourceAnalyses" in built, false);
  assertEquals(parseExactArchitectureCapture(built), built);
});

Deno.test("buildExactArchitectureCapture v3 preserves source reference order and round-trips", () => {
  const first = sourceReference();
  const second = {
    ...sourceReference(),
    sourceId: "sysml-source:drone-v4-usage",
    selector: {
      kind: "usage" as const,
      packageName: PACKAGE_NAME,
      componentName: "Wing",
      usageName: "wing",
      parentName: "DroneSystem",
    },
    sourceFingerprint: fingerprint("1"),
    sourceCaptureFingerprint: fingerprint("2"),
    analysisFingerprint: fingerprint("3"),
  };
  const built = buildExactArchitectureCapture({
    trustedRunId: RUN_ID,
    packageName: PACKAGE_NAME,
    systemName: "DroneSystem",
    architecturePackage: baseCapture().package,
    seed: baseCapture().seed,
    live: liveFromBase(),
    insertedAt: AT,
    sourceAnalyses: [first, second],
  });
  assertEquals(built.schemaVersion, ARCHITECTURE_CAPTURE_SCHEMA);
  if (built.schemaVersion === ARCHITECTURE_CAPTURE_SCHEMA) {
    assertEquals(built.sourceAnalyses, [first, second]);
  }
  assertEquals(parseExactArchitectureCapture(built), built);
  const graph = architectureGraphFromCapture(built);
  assertEquals(graph.packageId, "package-drone-v4");
  assertEquals(graph.partDefs.map((part) => part.label), ["DroneSystem", "Wing"]);
  assertEquals(graph.partDefs[0]?.usages.map((usage) => usage.label), ["wing"]);
});
