import { assertEquals, assertThrows } from "@std/assert";
import { validateModelicaThermalMethodSheet } from "../thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  deriveAdmittedObservationEvaluationMethod,
  normalizeAdmittedObservationUnit,
  selectAdmittedObservationEvaluations,
  validateAdmittedObservationEvaluationMethod,
} from "./admitted-observation-evaluation.ts";

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
      declaredUnit: "unit-pending-source",
    }],
  };
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
    declaredUnit: "unit-pending-source",
  }, {
    outputSymbolId: "placeholder-output",
    role: "max_abs",
    requirementElementId: "placeholder-requirement",
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
