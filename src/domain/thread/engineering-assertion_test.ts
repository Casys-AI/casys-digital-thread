import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  AUTHORITY_ADMISSION_SCHEMA,
  ENGINEERING_ASSERTION_SCHEMA,
  fingerprintAuthorityAdmission,
  fingerprintEngineeringAssertion,
  validateAuthorityAdmission,
  validateEngineeringAssertion,
} from "./engineering-assertion.ts";

const FINGERPRINT = {
  algorithm: "sha256",
  digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} as const;

const OTHER_FINGERPRINT = {
  algorithm: "sha256",
  digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
} as const;

const ASSERTION: unknown = {
  schemaVersion: ENGINEERING_ASSERTION_SCHEMA,
  id: "sensitivity.size-z.max-displacement",
  relation: "measured-local-sensitivity",
  from: {
    domain: "cad",
    kind: "parameter",
    id: "size-z",
    basisFingerprint: FINGERPRINT,
  },
  to: {
    domain: "calculix",
    kind: "metric",
    id: "max-displacement",
    basisFingerprint: FINGERPRINT,
  },
  epistemicBasis: "observed",
  assertedBy: { kind: "provider", id: "calculix", version: "1.0" },
  evidence: [
    { id: "run.capture", fingerprint: FINGERPRINT },
    { id: "result.capture", fingerprint: OTHER_FINGERPRINT },
  ],
  scope: {
    kind: "local-neighborhood",
    parameter: { domain: "cad", kind: "parameter", id: "size-z" },
    basisFingerprint: FINGERPRINT,
    lower: { value: 29, unit: "mm" },
    upper: { value: 31, unit: "mm" },
  },
  measurement: {
    method: "forward-finite-difference",
    basePoint: { value: 30, unit: "mm" },
    perturbationStep: { value: 1, unit: "mm" },
    responseAtBase: { value: 0.1, unit: "mm" },
    responseAtPerturbed: { value: 0.092, unit: "mm" },
    derivative: { value: -0.008, unit: "mm/mm" },
  },
  rationale: "Finite-difference measurement around the captured CAD basis.",
};

const ADMISSION: unknown = {
  schemaVersion: AUTHORITY_ADMISSION_SCHEMA,
  assertion: {
    id: "sensitivity.size-z.max-displacement",
    fingerprint: OTHER_FINGERPRINT,
  },
  operation: { id: "verify.run-fea-static-proof", version: "1" },
  basisFingerprint: FINGERPRINT,
  decision: { id: "mrtr.sensitivity", inputFingerprint: OTHER_FINGERPRINT },
  admittedAt: "2026-08-11T09:12:13.456Z",
};

function nonMeasuredAssertion(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const { measurement: _measurement, ...assertion } = ASSERTION as Record<
    string,
    unknown
  >;
  return { ...assertion, ...overrides };
}

Deno.test("engineering assertion accepts an observed local sensitivity with exact evidence", () => {
  const assertion = validateEngineeringAssertion(ASSERTION);
  assertEquals(assertion.relation, "measured-local-sensitivity");
  assertEquals(assertion.scope.kind, "local-neighborhood");
  if (assertion.scope.kind === "local-neighborhood") {
    assertEquals(assertion.scope.lower.unit, "mm");
    assertEquals(assertion.scope.basisFingerprint, FINGERPRINT);
  }
  assertEquals(assertion.measurement?.derivative.value, -0.008);
  assert(Object.isFrozen(assertion));
  assert(Object.isFrozen(assertion.from));
  assert(Object.isFrozen(assertion.evidence));
  assert(Object.isFrozen(assertion.evidence[0].fingerprint));
});

Deno.test("engineering assertion binds a sensitivity neighborhood to its driver", () => {
  const scope = (ASSERTION as Record<string, unknown>).scope as Record<
    string,
    unknown
  >;
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        scope: {
          ...scope,
          parameter: { domain: "cad", kind: "parameter", id: "height-mm" },
        },
      }),
    TypeError,
    "scope.parameter must equal $assertion.from",
  );
});

Deno.test("measured local sensitivity relates exactly a parameter to a metric", () => {
  const wrongDriver = structuredClone(ASSERTION) as Record<string, unknown>;
  (wrongDriver.from as Record<string, unknown>).kind = "component";
  assertThrows(
    () => validateEngineeringAssertion(wrongDriver),
    TypeError,
    "must relate a parameter to a metric",
  );

  const wrongResponse = structuredClone(ASSERTION) as Record<string, unknown>;
  (wrongResponse.to as Record<string, unknown>).kind = "parameter";
  assertThrows(
    () => validateEngineeringAssertion(wrongResponse),
    TypeError,
    "must relate a parameter to a metric",
  );
});

Deno.test("engineering assertion canonicalizes evidence order before fingerprinting", async () => {
  const reversed = {
    ...(ASSERTION as Record<string, unknown>),
    evidence: [...((ASSERTION as Record<string, unknown>).evidence as unknown[])]
      .reverse(),
  };
  const normal = validateEngineeringAssertion(ASSERTION);
  const canonicalized = validateEngineeringAssertion(reversed);
  assertEquals(canonicalized.evidence.map((item) => item.id), [
    "result.capture",
    "run.capture",
  ]);
  assertEquals(
    await fingerprintEngineeringAssertion(normal),
    await fingerprintEngineeringAssertion(canonicalized),
  );
});

Deno.test("engineering assertion rejects unsupported root fields and self-relations", () => {
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        authority: "no",
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        to: (ASSERTION as Record<string, unknown>).from,
      }),
    TypeError,
    "must be distinct",
  );
});

Deno.test("engineering assertion rejects missing and duplicate exact evidence", () => {
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        evidence: [],
      }),
    TypeError,
    "must not be empty",
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        evidence: [
          { id: "same", fingerprint: FINGERPRINT },
          { id: "same", fingerprint: OTHER_FINGERPRINT },
        ],
      }),
    TypeError,
    "must not contain duplicates",
  );
});

Deno.test("engineering assertion rejects explicit undefined optional fields", () => {
  const from = (ASSERTION as Record<string, unknown>).from as Record<string, unknown>;
  const assertedBy = (ASSERTION as Record<string, unknown>)
    .assertedBy as Record<string, unknown>;
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        from: { ...from, basisFingerprint: undefined },
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        assertedBy: { ...assertedBy, version: undefined },
      }),
    TypeError,
  );
});

Deno.test("engineering assertion rejects unknown domains, unsafe semantic IDs, and non-SHA fingerprints", () => {
  const from = (ASSERTION as Record<string, unknown>).from as Record<string, unknown>;
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...ASSERTION as Record<string, unknown>,
        from: { ...from, domain: "python" },
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...ASSERTION as Record<string, unknown>,
        from: { ...from, id: "size z" },
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        evidence: [{ id: "run", fingerprint: { algorithm: "sha1", digest: "x" } }],
      }),
    TypeError,
  );
});

Deno.test("engineering assertion requires units and ordered local-neighborhood bounds", () => {
  const scope = (ASSERTION as Record<string, unknown>).scope as Record<string, unknown>;
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        scope: { ...scope, lower: { value: 32, unit: "mm" } },
      }),
    TypeError,
    "less than or equal",
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        scope: { ...scope, upper: { value: 31, unit: "m" } },
      }),
    TypeError,
    "must equal",
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        scope: { ...scope, lower: { value: 29, unit: "" } },
      }),
    TypeError,
  );
});

Deno.test("measured local sensitivity requires a complete and coherent measurement", () => {
  const { measurement: _measurement, ...withoutMeasurement } = ASSERTION as Record<
    string,
    unknown
  >;
  assertThrows(
    () => validateEngineeringAssertion(withoutMeasurement),
    TypeError,
    "measurement is required",
  );
  const measurement = (ASSERTION as Record<string, unknown>)
    .measurement as Record<string, unknown>;
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        measurement: { ...measurement, derivative: { value: 0, unit: "mm/mm" } },
      }),
    TypeError,
    "finite-difference quotient",
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        measurement: {
          ...measurement,
          derivative: { value: -0.008, unit: "MPa/mm" },
        },
      }),
    TypeError,
    "must equal mm/mm",
  );
  assertThrows(
    () =>
      validateEngineeringAssertion({
        ...(ASSERTION as Record<string, unknown>),
        measurement: {
          ...measurement,
          basePoint: { value: 32, unit: "mm" },
          perturbationStep: { value: 1, unit: "mm" },
        },
      }),
    TypeError,
    "must lie within",
  );
});

Deno.test("non-measured assertions reject measurements and enforce their relation invariants", () => {
  const withMeasurement = nonMeasuredAssertion({
    id: "cad-script.value-flow-with-measurement",
    relation: "static-value-flow",
    epistemicBasis: "inferred",
    scope: {
      kind: "source-span",
      source: { domain: "cad", kind: "source", id: "drip-tray.py" },
      basisFingerprint: FINGERPRINT,
      start: { line: 1, column: 0 },
      end: { line: 1, column: 0 },
    },
    measurement: (ASSERTION as Record<string, unknown>).measurement,
  });
  assertThrows(() => validateEngineeringAssertion(withMeasurement), TypeError);
  assertThrows(
    () =>
      validateEngineeringAssertion(nonMeasuredAssertion({
        id: "cad-script.not-inferred",
        relation: "static-value-flow",
        epistemicBasis: "observed",
        scope: {
          kind: "source-span",
          source: { domain: "cad", kind: "source", id: "drip-tray.py" },
          basisFingerprint: FINGERPRINT,
          start: { line: 1, column: 0 },
          end: { line: 1, column: 0 },
        },
      })),
    TypeError,
    "must be inferred",
  );
  assertThrows(
    () =>
      validateEngineeringAssertion(nonMeasuredAssertion({
        id: "declared-dependency.not-declared",
        relation: "declared-dependency",
        epistemicBasis: "inferred",
        scope: {
          kind: "scenario",
          scenario: { domain: "modelica", kind: "scenario", id: "nominal" },
          basisFingerprint: FINGERPRINT,
        },
      })),
    TypeError,
    "must have a declared",
  );
});

Deno.test("engineering assertion validates basis, source-span, and scenario scopes", () => {
  const basis = validateEngineeringAssertion(nonMeasuredAssertion({
    id: "brief.binding",
    relation: "semantic-binding",
    epistemicBasis: "declared",
    scope: { kind: "basis", basisFingerprint: FINGERPRINT },
  }));
  assertEquals(basis.scope.kind, "basis");
  const sourceSpan = validateEngineeringAssertion(nonMeasuredAssertion({
    id: "cad-script.value-flow",
    relation: "static-value-flow",
    epistemicBasis: "inferred",
    scope: {
      kind: "source-span",
      source: { domain: "cad", kind: "source", id: "drip-tray.py" },
      basisFingerprint: FINGERPRINT,
      start: { line: 4, column: 0 },
      end: { line: 4, column: 12 },
    },
  }));
  assertEquals(sourceSpan.scope.kind, "source-span");
  const pointSpan = validateEngineeringAssertion(nonMeasuredAssertion({
    id: "cad-script.point",
    relation: "static-value-flow",
    epistemicBasis: "inferred",
    scope: {
      kind: "source-span",
      source: { domain: "cad", kind: "source", id: "drip-tray.py" },
      basisFingerprint: FINGERPRINT,
      start: { line: 4, column: 12 },
      end: { line: 4, column: 12 },
    },
  }));
  assertEquals(pointSpan.scope.kind, "source-span");
  const scenario = validateEngineeringAssertion(nonMeasuredAssertion({
    id: "modelica-scenario.dependency",
    relation: "declared-dependency",
    epistemicBasis: "declared",
    scope: {
      kind: "scenario",
      scenario: { domain: "modelica", kind: "scenario", id: "nominal" },
      basisFingerprint: FINGERPRINT,
    },
  }));
  assertEquals(scenario.scope.kind, "scenario");
  assertThrows(
    () =>
      validateEngineeringAssertion(nonMeasuredAssertion({
        relation: "static-value-flow",
        epistemicBasis: "inferred",
        scope: {
          kind: "source-span",
          source: { domain: "cad", kind: "source", id: "drip-tray.py" },
          basisFingerprint: FINGERPRINT,
          start: { line: 4, column: 12 },
          end: { line: 4, column: 11 },
        },
      })),
    TypeError,
    "must not be before",
  );
});

Deno.test("authority admission is separate, exact, immutable, and content-addressable", async () => {
  const admission = validateAuthorityAdmission(ADMISSION);
  assertEquals(admission.operation.id, "verify.run-fea-static-proof");
  assertEquals(admission.assertion.fingerprint, OTHER_FINGERPRINT);
  assert(Object.isFrozen(admission));
  assert(Object.isFrozen(admission.decision.inputFingerprint));
  const first = await fingerprintAuthorityAdmission(admission);
  const second = await fingerprintAuthorityAdmission(admission);
  assertEquals(first, second);
  assertEquals(first.algorithm, "sha256");
});

Deno.test("authority admission rejects assertion facts, missing decision integrity, and non-canonical timestamps", () => {
  assertThrows(
    () =>
      validateAuthorityAdmission({
        ...(ADMISSION as Record<string, unknown>),
        epistemicBasis: "observed",
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateAuthorityAdmission({
        ...(ADMISSION as Record<string, unknown>),
        decision: { id: "mrtr.sensitivity" },
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateAuthorityAdmission({
        ...(ADMISSION as Record<string, unknown>),
        admittedAt: "2026-08-11T09:12:13Z",
      }),
    TypeError,
    "canonical UTC",
  );
});

Deno.test("assertion fingerprint and admitted assertion fingerprint are protected by their hashes", async () => {
  const assertion = validateEngineeringAssertion(ASSERTION);
  const changedAssertion = validateEngineeringAssertion({
    ...(ASSERTION as Record<string, unknown>),
    rationale: "A different explanation.",
  });
  assertNotEquals(
    await fingerprintEngineeringAssertion(assertion),
    await fingerprintEngineeringAssertion(changedAssertion),
  );

  const admission = validateAuthorityAdmission(ADMISSION);
  const changedAdmission = validateAuthorityAdmission({
    ...(ADMISSION as Record<string, unknown>),
    assertion: {
      id: "sensitivity.size-z.max-displacement",
      fingerprint: FINGERPRINT,
    },
  });
  assertNotEquals(
    await fingerprintAuthorityAdmission(admission),
    await fingerprintAuthorityAdmission(changedAdmission),
  );
});
