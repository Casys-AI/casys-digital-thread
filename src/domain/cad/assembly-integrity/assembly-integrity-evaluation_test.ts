import { assertEquals, assertRejects } from "@std/assert";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  assemblyIntegrityEvaluationMethod,
  evaluateAssemblyIntegrity,
  validateAssemblyIntegrityEvaluationCapture,
} from "./assembly-integrity-evaluation.ts";
import {
  assemblyIntegrityExpectedPlacementMatrix,
  type AssemblyIntegrityObservation,
  type AssemblyIntegrityTransformMatrix,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-observation.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

Deno.test("assembly-integrity L4 passes only exact observed factual lanes", async () => {
  const result = await evaluate(observedAssembly());

  assertEquals(result.criteria, [
    { id: "assembly-import", verdict: "pass" },
    { id: "occurrence-coverage", verdict: "pass" },
    { id: "placement-recross", verdict: "pass" },
    { id: "brep-validity", verdict: "pass" },
    { id: "pairwise-intersection", verdict: "pass" },
  ]);
  assertEquals(result.verdict, "pass");
  assertEquals(result.method, await assemblyIntegrityEvaluationMethod());
  assertEquals(result.method.measurementTolerance, "diagnostic-only");
  assertEquals(result.method.matrixRepresentationEquivalence, {
    kind: "fixed-rigid-matrix-epsilon",
    epsilon: 1e-9,
  });
  assertEquals(result.measurementDiagnostics.pairwiseLinearToleranceMm, [{
    firstUsageElementId: "usage-arm",
    secondUsageElementId: "usage-base",
    linearToleranceMm: 10,
  }]);
  assertEquals(result.method.limitations, {
    providerCalls: "none",
    genericSysmlRequirementEvaluation: "none",
    safety: "not-evaluated",
    physicalJoints: "not-evaluated",
    clearance: "not-evaluated",
    motion: "not-evaluated",
    load: "not-evaluated",
    fabricability: "not-evaluated",
  });
});

Deno.test("assembly-integrity L4 applies fail over unresolved and never uses tolerance as acceptance", async () => {
  const importFailure = await evaluate({
    ...observedAssembly(),
    importFacts: {
      ...observedAssembly().importFacts,
      solidCount: observed(0),
    },
  });
  assertEquals(importFailure.criteria[0], { id: "assembly-import", verdict: "fail" });
  assertEquals(importFailure.verdict, "fail");

  const divergentPlacement = await evaluate({
    ...observedAssembly(),
    occurrences: replaceOccurrence(observedAssembly(), 0, (occurrence) => ({
      ...occurrence,
      transform: observed({
        expectedPlacement: placement(0, 0, 0, 0, 0, 0),
        expectedMatrix: identity(),
        observedMatrix: translatedIdentity(1),
      }),
    })),
  });
  assertEquals(divergentPlacement.criteria[2], {
    id: "placement-recross",
    verdict: "fail",
  });
  assertEquals(divergentPlacement.verdict, "fail");

  const invalidBrep = await evaluate({
    ...observedAssembly(),
    topology: { ...observedAssembly().topology, brepValidity: observed("invalid") },
  });
  assertEquals(invalidBrep.criteria[3], { id: "brep-validity", verdict: "fail" });
  assertEquals(invalidBrep.verdict, "fail");

  const positiveIntersection = await evaluate({
    ...observedAssembly(),
    pairs: [{
      ...observedAssembly().pairs[0]!,
      // It is smaller than the retained 10 mm diagnostic tolerance but still fails.
      intersectionVolumeMm3: observed(0.000_000_001),
    }],
  });
  assertEquals(positiveIntersection.criteria[4], {
    id: "pairwise-intersection",
    verdict: "fail",
  });
  assertEquals(positiveIntersection.verdict, "fail");

  const missingTarget = await evaluate({
    ...observedAssembly(),
    occurrences: replaceOccurrence(observedAssembly(), 0, (occurrence) => ({
      ...occurrence,
      target: unavailable(),
    })),
    pairs: [{
      ...observedAssembly().pairs[0]!,
      intersectionVolumeMm3: unavailable(),
    }],
  });
  assertEquals(missingTarget.criteria[1], {
    id: "occurrence-coverage",
    verdict: "unresolved",
  });
  assertEquals(missingTarget.criteria[4], {
    id: "pairwise-intersection",
    verdict: "unresolved",
  });
  assertEquals(missingTarget.verdict, "unresolved");

  const failedImport = await evaluate({
    ...observedAssembly(),
    importability: observed("failed"),
  });
  assertEquals(failedImport.criteria[0], { id: "assembly-import", verdict: "fail" });

  const missingExpectedOccurrence = await evaluate({
    ...observedAssembly(),
    occurrences: [],
  });
  assertEquals(missingExpectedOccurrence.criteria[1], {
    id: "occurrence-coverage",
    verdict: "unresolved",
  });
  assertEquals(missingExpectedOccurrence.criteria[2], {
    id: "placement-recross",
    verdict: "unresolved",
  });

  const incompletePairSet = await evaluate({
    ...observedAssembly(),
    pairs: [],
  });
  assertEquals(incompletePairSet.criteria[4], {
    id: "pairwise-intersection",
    verdict: "unresolved",
  });
});

Deno.test("assembly-integrity L4 treats canonical 90-degree matrix residuals as structural equivalence", async () => {
  const cosine = Math.cos(Math.PI / 2);
  const sine = Math.sin(Math.PI / 2);
  const result = await evaluate({
    ...observedAssembly(),
    occurrences: replaceOccurrence(observedAssembly(), 0, (occurrence) => ({
      ...occurrence,
      transform: observed({
        expectedPlacement: placement(0, 0, 0, 0, 0, 0),
        expectedMatrix: [
          cosine,
          -sine,
          0,
          0,
          sine,
          cosine,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
        ],
        observedMatrix: [
          0,
          -1,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
        ],
      }),
    })),
  });
  assertEquals(result.criteria[2], { id: "placement-recross", verdict: "pass" });
});

Deno.test("assembly-integrity L4 recrosses the corrected Build123d multi-axis placement convention", async () => {
  const expectedMatrix = assemblyIntegrityExpectedPlacementMatrix({
    translationMm: [4, 5, 6],
    rotationDeg: [10, 20, 30],
  });
  const correct = await evaluate({
    ...observedAssembly(),
    occurrences: replaceOccurrence(observedAssembly(), 0, (occurrence) => ({
      ...occurrence,
      transform: observed({
        expectedPlacement: placement(4, 5, 6, 10, 20, 30),
        expectedMatrix,
        observedMatrix: expectedMatrix,
      }),
    })),
  });
  assertEquals(correct.criteria[2], { id: "placement-recross", verdict: "pass" });

  const oldRzRyRx: AssemblyIntegrityTransformMatrix = [
    0.8137976813493738,
    -0.44096961052988237,
    0.37852230636979245,
    4,
    0.46984631039295416,
    0.8825641192593856,
    0.01802831123629725,
    5,
    -0.3420201433256687,
    0.16317591116653482,
    0.9254165783983234,
    6,
    0,
    0,
    0,
    1,
  ];
  const wrongOrder = await evaluate({
    ...observedAssembly(),
    occurrences: replaceOccurrence(observedAssembly(), 0, (occurrence) => ({
      ...occurrence,
      transform: observed({
        expectedPlacement: placement(4, 5, 6, 10, 20, 30),
        expectedMatrix,
        observedMatrix: oldRzRyRx,
      }),
    })),
  });
  assertEquals(wrongOrder.criteria[2], { id: "placement-recross", verdict: "fail" });
});

Deno.test("assembly-integrity L4 capture is closed, code-owned, and not a generic requirement evaluation", async () => {
  const evaluation = await evaluate(observedAssembly());
  const capture = {
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation",
    operation: { id: "verify.evaluate-assembly-integrity", version: "1" },
    trustedRunId: "run-evaluate",
    evaluatedAt: "2026-08-26T10:00:00.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "assembly:r7",
      revision: 7,
      subjectId: "assembly",
    },
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${A}`,
      fingerprint: fp(A),
    },
    assemblyStep: {
      artifactId: `cad-asset-${A}-module-step-${B}`,
      fingerprint: fp(B),
    },
    observation: {
      schemaVersion: "assembly-integrity-observation-capture/1.0",
      artifactId: `assembly-integrity-observation-${C}`,
      fingerprint: fp(C),
      observationFingerprint: fp(D),
    },
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0",
      fingerprint: fp(A),
      byteCount: 1024,
    },
    method: evaluation.method,
    evaluation,
  };

  const parsed = await validateAssemblyIntegrityEvaluationCapture(capture);
  assertEquals(parsed, capture);
  await assertRejects(
    () =>
      validateAssemblyIntegrityEvaluationCapture({ ...capture, requirementId: "R-1" }),
    TypeError,
    "unsupported field requirementId",
  );
  await assertRejects(
    () =>
      validateAssemblyIntegrityEvaluationCapture({
        ...capture,
        method: { ...capture.method, version: "1.0.1" },
      }),
    TypeError,
    "exact code-owned method",
  );
});

function observedAssembly(): AssemblyIntegrityObservation {
  return {
    schemaVersion: "assembly-integrity-observation/1.0",
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0",
      fingerprint: fp(A),
      byteCount: 1024,
    },
    method: {
      id: "assembly-integrity-factual-v1",
      version: "1.0",
      linearToleranceMm: 10,
    },
    importability: observed("imported"),
    importFacts: { unitSystem: observed("mm"), solidCount: observed(2) },
    topology: {
      brepValidity: observed("valid"),
      degenerateEdgeCount: observed(0),
      freeEdgeCount: observed(0),
      shellCount: observed(1),
    },
    occurrences: [
      {
        usageElementId: "usage-arm",
        target: observed({ partDefinitionElementId: "definition-arm" }),
        transform: observed({
          expectedPlacement: placement(0, 0, 0, 0, 0, 0),
          expectedMatrix: identity(),
          observedMatrix: identity(),
        }),
      },
      {
        usageElementId: "usage-base",
        target: observed({ partDefinitionElementId: "definition-base" }),
        transform: observed({
          expectedPlacement: placement(0, 0, 0, 0, 0, 0),
          expectedMatrix: identity(),
          observedMatrix: identity(),
        }),
      },
    ],
    pairs: [{
      firstUsageElementId: "usage-arm",
      secondUsageElementId: "usage-base",
      linearToleranceMm: 10,
      minimumDistanceMm: observed(1),
      intersectionVolumeMm3: observed(0),
      contact: observed("no-contact"),
    }],
  };
}

function evaluate(
  observation: AssemblyIntegrityObservation,
  expectedOccurrenceCount = 2,
) {
  return evaluateAssemblyIntegrity({ observation, expectedOccurrenceCount });
}

function observed<T>(value: T) {
  return { status: "observed" as const, value };
}

function unavailable() {
  return { status: "unavailable" as const, reason: "unsupported" as const };
}

function replaceOccurrence(
  observation: AssemblyIntegrityObservation,
  index: number,
  replace: (
    occurrence: AssemblyIntegrityObservation["occurrences"][number],
  ) => AssemblyIntegrityObservation["occurrences"][number],
): readonly AssemblyIntegrityObservation["occurrences"][number][] {
  return observation.occurrences.map((occurrence, occurrenceIndex) =>
    occurrenceIndex === index ? replace(occurrence) : occurrence
  );
}

function placement(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
) {
  return {
    translationMm: [x, y, z] as const,
    rotationDeg: [rx, ry, rz] as const,
  };
}

function identity(): AssemblyIntegrityTransformMatrix {
  return [
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ];
}

function translatedIdentity(x: number): AssemblyIntegrityTransformMatrix {
  return [
    1,
    0,
    0,
    x,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  ];
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
