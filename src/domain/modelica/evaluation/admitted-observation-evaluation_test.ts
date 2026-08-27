import { assertEquals, assertThrows } from "@std/assert";
import { validateModelicaThermalMethodSheet } from "../thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  deriveAdmittedObservationEvaluationMethod,
  mapAdmittedObservationEvidenceBySourceIdentity,
  normalizeAdmittedObservationUnit,
  selectAdmittedObservationEvaluations,
  selectUniqueThreadRequirementByPair,
  validateAdmittedObservationEvaluationMethod,
} from "./admitted-observation-evaluation.ts";

const OUTPUT_SYMBOL_ID = `3b6a${"c".repeat(60)}`;
const NATIVE_OUTPUT_NAME = "temperature";

const POLICY = {
  id: "placeholder-unit-policy",
  version: "1.0.0",
  fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
};

function validMethod(): Record<string, unknown> {
  return {
    schemaVersion: "modelica-admitted-observation-evaluation-method/1.0",
    profile: {
      id: "admitted-modelica-observations-v1",
      version: "1.0.0",
      admittedRoles: ["final", "max_abs"],
    },
    unitPolicy: { ...POLICY, fingerprint: { ...POLICY.fingerprint } },
    selections: [{
      outputSymbolId: "placeholder-output",
      role: "final",
      requirementElementId: "placeholder-requirement",
      requirementMetric: "placeholder-output",
      declaredUnit: "unit-pending-source",
    }],
  };
}

function identityMethod(): Record<string, unknown> {
  const method = validMethod();
  (method.selections as Record<string, unknown>[])[0]!.outputSymbolId =
    OUTPUT_SYMBOL_ID;
  return method;
}

Deno.test(
  "admitted observation method derives from a thermal method sheet without caller values",
  async () => {
    const sheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    const method = deriveAdmittedObservationEvaluationMethod(
      sheet,
      await admittedModelicaUnitIdentityPolicy(),
    );
    assertEquals(method.unitPolicy.id, "admitted-modelica-unit-identity");
    assertEquals(method.selections, [{
      outputSymbolId: "placeholder-output",
      role: "final",
      requirementElementId: "placeholder-requirement",
      requirementMetric: "placeholder-output",
      declaredUnit: "unit-pending-source",
    }]);
  },
);

Deno.test("admitted observation method accepts exact final/max_abs selections", () => {
  const method = validateAdmittedObservationEvaluationMethod(validMethod());
  assertEquals(method.profile.admittedRoles, ["final", "max_abs"]);
  const selected = selectAdmittedObservationEvaluations(
    method,
    [{ name: "placeholder-output", unit: "unit-pending-source" }],
    [{
      outputName: "placeholder-output",
      statistic: "final",
      unit: "unit-pending-source",
    }],
  );
  assertEquals(selected, method.selections);
});

Deno.test(
  "admitted observation identity map keys evidence by sha-like symbol id distinct from native name",
  () => {
    const method = validateAdmittedObservationEvaluationMethod(identityMethod());
    const mapped = mapAdmittedObservationEvidenceBySourceIdentity(
      method,
      [{ id: OUTPUT_SYMBOL_ID, kind: "variable", name: NATIVE_OUTPUT_NAME }],
      [{ name: NATIVE_OUTPUT_NAME, unit: "unit-pending-source" }],
      [{
        outputName: NATIVE_OUTPUT_NAME,
        statistic: "final",
        unit: "unit-pending-source",
        value: 42,
      }],
    );
    assertEquals(mapped.outputs, [{
      name: OUTPUT_SYMBOL_ID,
      unit: "unit-pending-source",
    }]);
    assertEquals(mapped.metrics, [{
      outputName: OUTPUT_SYMBOL_ID,
      statistic: "final",
      unit: "unit-pending-source",
      value: 42,
    }]);
    assertEquals(
      selectAdmittedObservationEvaluations(method, mapped.outputs, mapped.metrics),
      method.selections,
    );
  },
);

Deno.test(
  "admitted observation identity map refuses a native-name mismatch",
  () => {
    const method = validateAdmittedObservationEvaluationMethod(identityMethod());
    assertThrows(
      () =>
        mapAdmittedObservationEvidenceBySourceIdentity(
          method,
          [{ id: OUTPUT_SYMBOL_ID, kind: "variable", name: NATIVE_OUTPUT_NAME }],
          [{ name: "other-output", unit: "unit-pending-source" }],
          [{
            outputName: "other-output",
            statistic: "final",
            unit: "unit-pending-source",
            value: 42,
          }],
        ),
      TypeError,
      "exact native source output",
    );
  },
);

Deno.test(
  "admitted observation identity map refuses a wrong-kind source symbol",
  () => {
    const method = validateAdmittedObservationEvaluationMethod(identityMethod());
    assertThrows(
      () =>
        mapAdmittedObservationEvidenceBySourceIdentity(
          method,
          [{ id: OUTPUT_SYMBOL_ID, kind: "parameter", name: NATIVE_OUTPUT_NAME }],
          [{ name: NATIVE_OUTPUT_NAME, unit: "unit-pending-source" }],
          [{
            outputName: NATIVE_OUTPUT_NAME,
            statistic: "final",
            unit: "unit-pending-source",
            value: 42,
          }],
        ),
      TypeError,
      "exact source-analysis variable",
    );
  },
);

Deno.test("admitted observation method refuses a caller equation or value", () => {
  const withEquation = validMethod();
  withEquation.equation = "T = P / h";
  assertThrows(
    () => validateAdmittedObservationEvaluationMethod(withEquation),
    TypeError,
    "unsupported field",
  );
  const withValue = validMethod();
  (withValue.selections as Record<string, unknown>[])[0]!.value = 42;
  assertThrows(
    () => validateAdmittedObservationEvaluationMethod(withValue),
    TypeError,
    "unsupported field",
  );
});

Deno.test("admitted observation method refuses a duplicate requirement", () => {
  const input = validMethod();
  input.selections = [{
    outputSymbolId: "placeholder-output",
    role: "final",
    requirementElementId: "placeholder-requirement",
    requirementMetric: "placeholder-output",
    declaredUnit: "unit-pending-source",
  }, {
    outputSymbolId: "placeholder-output",
    role: "max_abs",
    requirementElementId: "placeholder-requirement",
    requirementMetric: "placeholder-output",
    declaredUnit: "unit-pending-source",
  }];
  assertThrows(
    () => validateAdmittedObservationEvaluationMethod(input),
    TypeError,
    "duplicate",
  );
});

Deno.test("admitted observation method refuses a missing unit policy", () => {
  const input = validMethod();
  delete input.unitPolicy;
  assertThrows(
    () => validateAdmittedObservationEvaluationMethod(input),
    TypeError,
    "unitPolicy",
  );
});

Deno.test("admitted observation selection rejects an output outside v2 source", () => {
  const method = validateAdmittedObservationEvaluationMethod(validMethod());
  assertThrows(
    () =>
      selectAdmittedObservationEvaluations(
        method,
        [{ name: "other-output", unit: "unit-pending-source" }],
        [{
          outputName: "placeholder-output",
          statistic: "final",
          unit: "unit-pending-source",
        }],
      ),
    TypeError,
    "exact v2 source output",
  );
});

Deno.test("admitted observation selection rejects an absent published role", () => {
  const method = validateAdmittedObservationEvaluationMethod(validMethod());
  assertThrows(
    () =>
      selectAdmittedObservationEvaluations(
        method,
        [{ name: "placeholder-output", unit: "unit-pending-source" }],
        [{
          outputName: "placeholder-output",
          statistic: "max_abs",
          unit: "unit-pending-source",
        }],
      ),
    TypeError,
    "absent from published evidence",
  );
});

Deno.test("identity unit policy matches only Object.is-equal unit strings", () => {
  assertEquals(
    normalizeAdmittedObservationUnit("unit-pending-source", "unit-pending-source"),
    { status: "matched", unit: "unit-pending-source" },
  );
  assertEquals(
    normalizeAdmittedObservationUnit("unit-pending-source", "K"),
    { status: "unresolved", reason: "unit-identity-mismatch" },
  );
});

Deno.test(
  "admitted observation pair selects exactly one Thread requirement and never the first of several",
  () => {
    const identity = {
      requirementElementId: "c1f7534f-cca7-4909-bf0f-42a0b09701bc",
      requirementMetric: "temperature",
    };
    const displacement = threadRequirement(
      "thread-displacement",
      identity.requirementElementId,
      "maxDisplacement",
    );
    const vonMises = threadRequirement(
      "thread-von-mises",
      identity.requirementElementId,
      "maxVonMises",
    );
    const temperature = threadRequirement(
      "thread-temperature",
      identity.requirementElementId,
      "temperature",
    );
    const selected = selectUniqueThreadRequirementByPair(
      [displacement, vonMises, temperature],
      identity,
    );
    assertEquals(selected, temperature);

    assertThrows(
      () =>
        selectUniqueThreadRequirementByPair(
          [displacement, vonMises],
          identity,
        ),
      TypeError,
      "no current requirement",
    );
    assertThrows(
      () =>
        selectUniqueThreadRequirementByPair(
          [temperature, { ...temperature, id: "thread-temperature-duplicate" }],
          identity,
        ),
      TypeError,
      "will not choose one",
    );
  },
);

function threadRequirement(
  id: string,
  elementId: string,
  metric: string,
) {
  return {
    id,
    trace: { elementId },
    criterion: { metric },
  };
}

Deno.test("admitted observation selection leaves a unit mismatch unresolved", () => {
  const method = validateAdmittedObservationEvaluationMethod(validMethod());
  assertThrows(
    () =>
      selectAdmittedObservationEvaluations(
        method,
        [{ name: "placeholder-output", unit: "K" }],
        [{
          outputName: "placeholder-output",
          statistic: "final",
          unit: "K",
        }],
      ),
    TypeError,
    "unresolved",
  );
});
