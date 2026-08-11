import { assertEquals, assertThrows } from "@std/assert";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
  parseExactArchitectureCapture,
} from "./architecture-capture.ts";

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

Deno.test("historical v2 capture cannot be retrofitted with source analyses", () => {
  assertThrows(() =>
    parseExactArchitectureCapture({
      schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA_LEGACY,
      ...baseCapture(),
      sourceAnalyses: [sourceReference()],
    })
  );
});
