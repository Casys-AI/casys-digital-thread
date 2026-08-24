import { assertEquals, assertThrows } from "@std/assert";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
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

function roots() {
  return {
    scopeRoot: {
      id: "package-drone-v4",
      kind: "Package" as const,
      label: PACKAGE_NAME,
    },
    semanticRoot: {
      id: "part-def-drone-system",
      kind: "PartDefinition" as const,
      label: "DroneSystem",
    },
  };
}

function baseCapture() {
  return {
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: RUN_ID,
    packageName: PACKAGE_NAME,
    systemName: "DroneSystem",
    ...roots(),
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

function liveFromBase() {
  const capture = baseCapture();
  return {
    packageId: capture.scopeRoot.id,
    packageLabel: capture.scopeRoot.label ?? PACKAGE_NAME,
    partDefs: capture.partDefinitions.map((part) => ({
      ...part,
      attributes: [],
    })),
  };
}

Deno.test("architecture capture parser accepts only exact architecture-capture/4.0", () => {
  const current = parseExactArchitectureCapture(currentCapture());
  assertEquals(current.schemaVersion, ARCHITECTURE_CAPTURE_SCHEMA);
  assertEquals(current.scopeRoot, roots().scopeRoot);
  assertEquals(current.semanticRoot, roots().semanticRoot);
  assertEquals(current.sourceAnalyses, [sourceReference()]);
  assertThrows(() =>
    parseExactArchitectureCapture({
      schemaVersion: "architecture-capture/3.0",
      ...baseCapture(),
      package: { id: "package-drone-v4", label: PACKAGE_NAME },
      sourceAnalyses: [sourceReference()],
    })
  );
  assertThrows(() =>
    parseExactArchitectureCapture({
      schemaVersion: "architecture-capture/2.0",
      ...baseCapture(),
      sourceAnalyses: [sourceReference()],
    })
  );
});

Deno.test("architecture capture parser rejects a legacy package field and empty root ids", () => {
  const withPackage = currentCapture();
  withPackage.package = { id: "package-drone-v4", label: PACKAGE_NAME };
  assertThrows(() => parseExactArchitectureCapture(withPackage));

  const emptyScope = currentCapture();
  emptyScope.scopeRoot = { id: "", kind: "Package", label: PACKAGE_NAME };
  assertThrows(() => parseExactArchitectureCapture(emptyScope));

  const emptySemantic = currentCapture();
  emptySemantic.semanticRoot = {
    id: "",
    kind: "PartDefinition",
    label: "DroneSystem",
  };
  assertThrows(() => parseExactArchitectureCapture(emptySemantic));

  const wrongScopeKind = currentCapture();
  wrongScopeKind.scopeRoot = {
    id: "package-drone-v4",
    kind: "PartDefinition",
    label: PACKAGE_NAME,
  };
  assertThrows(() => parseExactArchitectureCapture(wrongScopeKind));

  const wrongSemanticKind = currentCapture();
  wrongSemanticKind.semanticRoot = {
    id: "part-def-drone-system",
    kind: "Package",
    label: "DroneSystem",
  };
  assertThrows(() => parseExactArchitectureCapture(wrongSemanticKind));
});

Deno.test("architecture capture parser requires semanticRoot exactly once among PartDefinitions", () => {
  const missing = currentCapture();
  missing.semanticRoot = {
    id: "part-def-absent",
    kind: "PartDefinition",
    label: "DroneSystem",
  };
  assertThrows(() => parseExactArchitectureCapture(missing));

  const asUsage = currentCapture();
  asUsage.semanticRoot = {
    id: "part-usage-wing",
    kind: "PartDefinition",
    label: "wing",
  };
  assertThrows(() => parseExactArchitectureCapture(asUsage));
});

Deno.test("architecture capture parser does not choose a root by systemName or topology", () => {
  const renamedDisplay = currentCapture();
  renamedDisplay.systemName = "DisplayOnlySystem";
  const parsed = parseExactArchitectureCapture(renamedDisplay);
  assertEquals(parsed.semanticRoot.id, "part-def-drone-system");
  assertEquals(parsed.packageName, PACKAGE_NAME);
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
  "parseExactArchitectureCapture remains the only reader of architecture-capture/4.0 keys",
  async () => {
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
    assertEquals(
      parser.includes("parseArchitectureCapturePartDefinitions("),
      true,
    );
    assertEquals(parser.includes("architecture-capture/4.0"), true);
    assertEquals(parser.includes("architecture-capture/3.0"), false);
    assertEquals(parser.includes("ARCHITECTURE_CAPTURE_SCHEMA_LEGACY"), false);
    assertEquals(sibling.includes("parseExactArchitectureCapture("), false);
    assertEquals(
      sibling.includes("parseArchitectureCapturePartDefinitions("),
      true,
    );
    assertEquals(executor.includes("parseExactArchitectureCapture("), true);
    assertEquals(executor.includes("exactKeys("), false);
  },
);

Deno.test(
  "extractPartDefinitionsFromCapture returns the sealed PartDefinition graph without re-reading schema keys",
  () => {
    const parsed = parseExactArchitectureCapture(currentCapture());
    assertEquals(
      extractPartDefinitionsFromCapture(parsed),
      parsed.partDefinitions,
    );
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
        scopeRoot: roots().scopeRoot,
        semanticRoot: roots().semanticRoot,
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

Deno.test("buildExactArchitectureCapture requires source analyses and always writes 4.0", () => {
  assertThrows(() =>
    buildExactArchitectureCapture({
      trustedRunId: RUN_ID,
      packageName: PACKAGE_NAME,
      systemName: "DroneSystem",
      scopeRoot: roots().scopeRoot,
      semanticRoot: roots().semanticRoot,
      seed: baseCapture().seed,
      live: liveFromBase(),
      insertedAt: AT,
      sourceAnalyses: [],
    })
  );
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
    scopeRoot: roots().scopeRoot,
    semanticRoot: roots().semanticRoot,
    seed: baseCapture().seed,
    live: liveFromBase(),
    insertedAt: AT,
    sourceAnalyses: [first, second],
  });
  assertEquals(built.schemaVersion, ARCHITECTURE_CAPTURE_SCHEMA);
  assertEquals(built.scopeRoot.kind, "Package");
  assertEquals(built.semanticRoot.kind, "PartDefinition");
  assertEquals(built.sourceAnalyses, [first, second]);
  assertEquals(parseExactArchitectureCapture(built), built);
  const graph = architectureGraphFromCapture(built);
  assertEquals(graph.packageId, "package-drone-v4");
  assertEquals(graph.partDefs.map((part) => part.label), [
    "DroneSystem",
    "Wing",
  ]);
  assertEquals(graph.partDefs[0]?.usages.map((usage) => usage.label), ["wing"]);
});
