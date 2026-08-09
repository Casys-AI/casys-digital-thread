import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  assertProofWithinPolicy,
  assertStepBytesWithinPolicy,
  FEA_EXECUTION_POLICY_VERSION,
  type FeaExecutionPolicy,
  FeaPolicyViolationError,
  validateFeaExecutionPolicy,
} from "./fea-execution-policy.ts";
import type { MechanicalProofCase } from "./mechanical-proof-case.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A policy that leaves generous headroom for the default proof fixture.
 * Tests override individual fields via makePolicy().
 */
function makePolicy(
  overrides: Partial<Omit<FeaExecutionPolicy, "policyVersion">> = {},
): FeaExecutionPolicy {
  return {
    policyVersion: FEA_EXECUTION_POLICY_VERSION,
    meshTargetSizeMinMm: 1.0,
    forceMagnitudeMaxN: 1000,
    stepBytesMax: 100_000,
    selectionsMax: 10,
    ...overrides,
  };
}

/**
 * Build a minimal valid MechanicalProofCase directly as a typed literal.
 * Only fields consumed by assertProofWithinPolicy are non-trivial; the rest
 * are set to stable placeholder values so the object satisfies the interface.
 *
 * Tests adjust mesh, loads, or supports via the optional overrides.
 */
function makeProof(overrides: {
  meshTargetSizeMm?: number;
  loadForce?: readonly [number, number, number];
  extraSupport?: boolean;
  extraLoad?: boolean;
} = {}): MechanicalProofCase {
  const meshTargetSizeMm = overrides.meshTargetSizeMm ?? 5.0;
  const loadForce = overrides.loadForce ?? ([0, 0, -100] as const);

  const supports: MechanicalProofCase["analysis"]["supports"] = [
    {
      id: "support-001",
      kind: "fixed",
      selection: {
        name: "Bottom",
        box: { min: [0, 0, 0], max: [10, 10, 1], unit: "mm" },
      },
    },
    ...(overrides.extraSupport
      ? [
        {
          id: "support-002",
          kind: "fixed" as const,
          selection: {
            name: "Left",
            box: {
              min: [0, 0, 2] as readonly [number, number, number],
              max: [1, 10, 3] as readonly [number, number, number],
              unit: "mm" as const,
            },
          },
        },
      ]
      : []),
  ];

  const loads: MechanicalProofCase["analysis"]["loads"] = [
    {
      id: "load-001",
      kind: "force",
      selection: {
        name: "Top",
        box: { min: [0, 0, 9], max: [10, 10, 10], unit: "mm" },
      },
      force: { value: loadForce, unit: "N" },
    },
    ...(overrides.extraLoad
      ? [
        {
          id: "load-002",
          kind: "force" as const,
          selection: {
            name: "Side",
            box: {
              min: [9, 0, 2] as readonly [number, number, number],
              max: [10, 10, 8] as readonly [number, number, number],
              unit: "mm" as const,
            },
          },
          force: { value: [10, 0, 0] as const, unit: "N" as const },
        },
      ]
      : []),
  ];

  return {
    schemaVersion: "mechanical-proof-case/1.0",
    id: "test-proof-case",
    revision: 1,
    scope: "test scope",
    evidenceBoundary: "test boundary",
    project: {
      id: "test-project",
      subjectId: "test-subject",
      baseThreadSnapshot: {
        id: "ts-001",
        revision: 1,
        subjectId: "test-subject",
      },
    },
    target: { id: "target-001", modelElementId: "model-elem-001" },
    authorization: { workItemId: "wi-001", decisionId: "dec-001" },
    requirementsSource: {
      provider: "syson",
      editingContextId: "ctx-001",
      elementId: "elem-001",
    },
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
    },
    cadSource: {
      kind: "parametric",
      generator: {
        provider: "build123d",
        tool: "build123d_execute",
        definition: {
          mediaType: "text/x-python",
          sha256: "a".repeat(64),
          bytes: 1024,
        },
      },
      engineeringBoundary: {
        designIntent: "preserved",
        editableCad: "native",
        manufacturability: "not-established",
        limitations: ["test limitation"],
      },
    },
    expectedCadArtifact: {
      format: "step",
      sha256: "b".repeat(64),
      bytes: 15000,
    },
    analysis: {
      kind: "linear-static",
      material: {
        model: "isotropic-linear-elastic",
        basis: "standard",
        youngModulus: { value: 70000, unit: "MPa" },
        poissonRatio: { value: 0.3, unit: "1" },
      },
      mesh: {
        kind: "tetrahedral-volume",
        targetSize: { value: meshTargetSizeMm, unit: "mm" },
      },
      supports,
      loads,
    },
    requirements: [
      {
        id: "req-displacement",
        name: "req-displacement",
        metric: "maximum-displacement",
        feature: "maxDisplacement",
        operator: "<=",
        limit: { value: 1.0, unit: "mm" },
      },
      {
        id: "req-stress",
        name: "req-stress",
        metric: "maximum-von-mises-stress",
        feature: "maxVonMisesStress",
        operator: "<=",
        limit: { value: 100_000, unit: "Pa" },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// validateFeaExecutionPolicy — structural guards
// ---------------------------------------------------------------------------

Deno.test("validateFeaExecutionPolicy rejects an object with an extra key", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 1,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000,
        selectionsMax: 10,
        unexpected: "field",
      }),
    TypeError,
    "unsupported field unexpected",
  );
});

Deno.test("validateFeaExecutionPolicy rejects an object with a missing key", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 1,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000,
        // selectionsMax missing
      }),
    TypeError,
    "selectionsMax is required",
  );
});

Deno.test("validateFeaExecutionPolicy rejects a wrong policyVersion", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: "fea-execution-policy/0",
        meshTargetSizeMinMm: 1,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000,
        selectionsMax: 10,
      }),
    TypeError,
    "must equal",
  );
});

Deno.test("validateFeaExecutionPolicy rejects a non-finite meshTargetSizeMinMm", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: Infinity,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000,
        selectionsMax: 10,
      }),
    TypeError,
    "finite number",
  );
});

Deno.test("validateFeaExecutionPolicy rejects a zero meshTargetSizeMinMm", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000,
        selectionsMax: 10,
      }),
    TypeError,
    "positive finite number",
  );
});

Deno.test("validateFeaExecutionPolicy rejects a negative forceMagnitudeMaxN", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 1,
        forceMagnitudeMaxN: -500,
        stepBytesMax: 100_000,
        selectionsMax: 10,
      }),
    TypeError,
    "positive finite number",
  );
});

Deno.test("validateFeaExecutionPolicy rejects a non-integer stepBytesMax", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 1,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000.5,
        selectionsMax: 10,
      }),
    TypeError,
    "positive integer",
  );
});

Deno.test("validateFeaExecutionPolicy rejects a zero selectionsMax", () => {
  assertThrows(
    () =>
      validateFeaExecutionPolicy({
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 1,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 100_000,
        selectionsMax: 0,
      }),
    TypeError,
    "positive integer",
  );
});

Deno.test("validateFeaExecutionPolicy returns a frozen policy on valid input", () => {
  const raw = {
    policyVersion: FEA_EXECUTION_POLICY_VERSION,
    meshTargetSizeMinMm: 0.5,
    forceMagnitudeMaxN: 500.25,
    stepBytesMax: 50_000,
    selectionsMax: 8,
  };
  const policy = validateFeaExecutionPolicy(raw);
  assertEquals(policy.policyVersion, FEA_EXECUTION_POLICY_VERSION);
  assertEquals(policy.meshTargetSizeMinMm, 0.5);
  assertEquals(policy.forceMagnitudeMaxN, 500.25);
  assertEquals(policy.stepBytesMax, 50_000);
  assertEquals(policy.selectionsMax, 8);
  assertEquals(Object.isFrozen(policy), true);
});

// ---------------------------------------------------------------------------
// assertProofWithinPolicy — mesh boundary
// ---------------------------------------------------------------------------

Deno.test(
  "assertProofWithinPolicy accepts a mesh target size exactly at the minimum",
  () => {
    // At the limit is accepted — must not throw.
    assertProofWithinPolicy(
      makeProof({ meshTargetSizeMm: 5.0 }),
      makePolicy({ meshTargetSizeMinMm: 5.0 }),
    );
  },
);

Deno.test(
  "assertProofWithinPolicy rejects a mesh target size strictly below the minimum",
  () => {
    const err = assertThrows(
      () =>
        assertProofWithinPolicy(
          makeProof({ meshTargetSizeMm: 4.999 }),
          makePolicy({ meshTargetSizeMinMm: 5.0 }),
        ),
      FeaPolicyViolationError,
    );
    assertEquals(err.code, "mesh_below_minimum");
    assertEquals(err.context.meshTargetSizeMm, 4.999);
    assertEquals(err.context.meshTargetSizeMinMm, 5.0);
  },
);

// ---------------------------------------------------------------------------
// assertProofWithinPolicy — force boundary
// ---------------------------------------------------------------------------

Deno.test(
  "assertProofWithinPolicy accepts a load whose Euclidean norm equals the maximum",
  () => {
    // force [0, 0, -100] → norm = 100; policy max = 100 → accepted.
    assertProofWithinPolicy(
      makeProof({ loadForce: [0, 0, -100] }),
      makePolicy({ forceMagnitudeMaxN: 100 }),
    );
  },
);

Deno.test(
  "assertProofWithinPolicy rejects a load whose Euclidean norm strictly exceeds the maximum",
  () => {
    // force [0, 0, -100] → norm = 100; policy max = 99.9 → rejected.
    const err = assertThrows(
      () =>
        assertProofWithinPolicy(
          makeProof({ loadForce: [0, 0, -100] }),
          makePolicy({ forceMagnitudeMaxN: 99.9 }),
        ),
      FeaPolicyViolationError,
    );
    assertEquals(err.code, "force_exceeds_maximum");
    assertEquals(err.context.forceMagnitudeMaxN, 99.9);
  },
);

Deno.test(
  "assertProofWithinPolicy accepts a diagonal force vector whose norm is exactly at the maximum",
  () => {
    // force [60, 80, 0] → norm = sqrt(3600 + 6400) = sqrt(10000) = 100; max = 100.
    assertProofWithinPolicy(
      makeProof({ loadForce: [60, 80, 0] }),
      makePolicy({ forceMagnitudeMaxN: 100 }),
    );
  },
);

Deno.test(
  "assertProofWithinPolicy rejects a diagonal force vector whose norm strictly exceeds the maximum",
  () => {
    // force [60, 80, 0] → norm = 100; max = 99 → rejected.
    assertThrows(
      () =>
        assertProofWithinPolicy(
          makeProof({ loadForce: [60, 80, 0] }),
          makePolicy({ forceMagnitudeMaxN: 99 }),
        ),
      FeaPolicyViolationError,
    );
  },
);

// ---------------------------------------------------------------------------
// assertProofWithinPolicy — selections boundary
// ---------------------------------------------------------------------------

Deno.test(
  "assertProofWithinPolicy accepts a selection count exactly at the maximum",
  () => {
    // Default proof: 1 support + 1 load = 2 selections; max = 2 → accepted.
    assertProofWithinPolicy(makeProof(), makePolicy({ selectionsMax: 2 }));
  },
);

Deno.test(
  "assertProofWithinPolicy rejects a selection count strictly exceeding the maximum",
  () => {
    // Default proof: 1 support + 1 load = 2 selections; max = 1 → rejected.
    const err = assertThrows(
      () => assertProofWithinPolicy(makeProof(), makePolicy({ selectionsMax: 1 })),
      FeaPolicyViolationError,
    );
    assertEquals(err.code, "too_many_selections");
    assertEquals(err.context.selectionCount, 2);
    assertEquals(err.context.selectionsMax, 1);
  },
);

Deno.test(
  "assertProofWithinPolicy accepts 2 supports + 2 loads when max is 4",
  () => {
    // 2 supports + 2 loads = 4; max = 4 → accepted.
    assertProofWithinPolicy(
      makeProof({ extraSupport: true, extraLoad: true }),
      makePolicy({ selectionsMax: 4 }),
    );
  },
);

Deno.test(
  "assertProofWithinPolicy rejects 2 supports + 2 loads when max is 3",
  () => {
    assertThrows(
      () =>
        assertProofWithinPolicy(
          makeProof({ extraSupport: true, extraLoad: true }),
          makePolicy({ selectionsMax: 3 }),
        ),
      FeaPolicyViolationError,
    );
  },
);

// ---------------------------------------------------------------------------
// assertProofWithinPolicy — error is FeaPolicyViolationError instance
// ---------------------------------------------------------------------------

Deno.test(
  "assertProofWithinPolicy throws a FeaPolicyViolationError that is an Error",
  () => {
    const err = assertThrows(
      () =>
        assertProofWithinPolicy(
          makeProof({ meshTargetSizeMm: 0.1 }),
          makePolicy({ meshTargetSizeMinMm: 1.0 }),
        ),
      FeaPolicyViolationError,
    );
    assertInstanceOf(err, Error);
    assertEquals(err.name, "FeaPolicyViolationError");
  },
);

// ---------------------------------------------------------------------------
// assertStepBytesWithinPolicy — bytes boundary
// ---------------------------------------------------------------------------

Deno.test(
  "assertStepBytesWithinPolicy accepts a byte count exactly at the maximum",
  () => {
    // At the limit is accepted — must not throw.
    assertStepBytesWithinPolicy(50_000, makePolicy({ stepBytesMax: 50_000 }));
  },
);

Deno.test(
  "assertStepBytesWithinPolicy accepts a byte count below the maximum",
  () => {
    assertStepBytesWithinPolicy(49_999, makePolicy({ stepBytesMax: 50_000 }));
  },
);

Deno.test(
  "assertStepBytesWithinPolicy rejects a byte count strictly above the maximum",
  () => {
    const err = assertThrows(
      () => assertStepBytesWithinPolicy(50_001, makePolicy({ stepBytesMax: 50_000 })),
      FeaPolicyViolationError,
    );
    assertEquals(err.code, "step_bytes_exceeds_maximum");
    assertEquals(err.context.bytes, 50_001);
    assertEquals(err.context.stepBytesMax, 50_000);
  },
);

Deno.test(
  "assertStepBytesWithinPolicy error context carries the exact byte count and limit",
  () => {
    const err = assertThrows(
      () => assertStepBytesWithinPolicy(15_491, makePolicy({ stepBytesMax: 15_490 })),
      FeaPolicyViolationError,
    );
    assertEquals(err.code, "step_bytes_exceeds_maximum");
    assertEquals(err.context.bytes, 15_491);
    assertEquals(err.context.stepBytesMax, 15_490);
  },
);
