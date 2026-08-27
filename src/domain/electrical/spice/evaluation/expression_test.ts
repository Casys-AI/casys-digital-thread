import { assertEquals, assertThrows } from "@std/assert";
import {
  collectNativeObservationNames,
  deriveExpressionUnit,
  ELECTRICAL_OBSERVATION_EXPRESSION_MAX_DEPTH,
  ELECTRICAL_OBSERVATION_EXPRESSION_MAX_NODES,
  evaluateElectricalObservationExpression,
  validateElectricalObservationExpression,
} from "./expression.ts";

Deno.test("native voltage and current names derive V and A", () => {
  assertEquals(
    deriveExpressionUnit({ kind: "native-observation", name: "v(n1)" }),
    "V",
  );
  assertEquals(
    deriveExpressionUnit({ kind: "native-observation", name: "i(vsrc)" }),
    "A",
  );
  assertEquals(
    deriveExpressionUnit({ kind: "native-observation", name: "@r1[i]" }),
    "A",
  );
});

Deno.test("negate preserves unit and flips the finite sign", () => {
  const expression = validateElectricalObservationExpression({
    kind: "negate",
    operand: { kind: "native-observation", name: "i(vsrc)" },
  });
  assertEquals(deriveExpressionUnit(expression), "A");
  const result = evaluateElectricalObservationExpression(expression, [{
    name: "i(vsrc)",
    value: -2,
    unit: "A",
  }]);
  assertEquals(result, {
    status: "ok",
    quantity: { value: 2, unit: "A" },
  });
});

Deno.test("multiply admits only V*A -> W and dimensionless scalar 1", () => {
  const power = validateElectricalObservationExpression({
    kind: "multiply",
    left: { kind: "native-observation", name: "v(n1)" },
    right: {
      kind: "negate",
      operand: { kind: "native-observation", name: "i(vsrc)" },
    },
  });
  assertEquals(deriveExpressionUnit(power), "W");
  assertEquals(
    evaluateElectricalObservationExpression(power, [
      { name: "v(n1)", value: 3, unit: "V" },
      { name: "i(vsrc)", value: -2, unit: "A" },
    ]),
    { status: "ok", quantity: { value: 6, unit: "W" } },
  );
  const scaled = validateElectricalObservationExpression({
    kind: "multiply",
    left: { kind: "constant", value: -1, unit: "1" },
    right: { kind: "native-observation", name: "i(vsrc)" },
  });
  assertEquals(deriveExpressionUnit(scaled), "A");
  assertThrows(
    () =>
      validateElectricalObservationExpression({
        kind: "multiply",
        left: { kind: "native-observation", name: "v(n1)" },
        right: { kind: "native-observation", name: "v(n2)" },
      }),
    TypeError,
    "only V*A -> W",
  );
});

Deno.test("expression validation rejects extra fields and unknown natives", () => {
  assertThrows(
    () =>
      validateElectricalObservationExpression({
        kind: "native-observation",
        name: "v(n1)",
        alias: "vout",
      }),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () =>
      validateElectricalObservationExpression({
        kind: "native-observation",
        name: "p(n1)",
      }),
    TypeError,
    "admitted ngspice native name",
  );
  assertThrows(
    () =>
      validateElectricalObservationExpression({
        kind: "constant",
        value: Number.NaN,
        unit: "V",
      }),
    TypeError,
    "finite",
  );
});

Deno.test("evaluation leaves missing natives unresolved and never aliases", () => {
  const expression = validateElectricalObservationExpression({
    kind: "native-observation",
    name: "v(n1)",
  });
  const missing = evaluateElectricalObservationExpression(expression, [{
    name: "v(n2)",
    value: 3,
    unit: "V",
  }]);
  assertEquals(missing.status, "unresolved");
  if (missing.status === "unresolved") {
    assertEquals(missing.reason, "native-missing");
  }
  const duplicate = evaluateElectricalObservationExpression(expression, [
    { name: "v(n1)", value: 1, unit: "V" },
    { name: "v(n1)", value: 2, unit: "V" },
  ]);
  assertEquals(duplicate.status, "unresolved");
  if (duplicate.status === "unresolved") {
    assertEquals(duplicate.reason, "native-not-unique");
  }
  assertEquals(collectNativeObservationNames(expression), ["v(n1)"]);
});

Deno.test("expression validation rejects a closed AST deeper than the code-owned maximum", () => {
  let nested: Record<string, unknown> = {
    kind: "native-observation",
    name: "v(n1)",
  };
  for (let depth = 0; depth < ELECTRICAL_OBSERVATION_EXPRESSION_MAX_DEPTH; depth++) {
    nested = { kind: "negate", operand: nested };
  }
  assertThrows(
    () => validateElectricalObservationExpression(nested),
    TypeError,
    "closed expression depth",
  );
});

Deno.test("expression validation rejects more nodes than the code-owned maximum", () => {
  function scalarTree(remaining: number): Record<string, unknown> {
    if (remaining <= 1) return { kind: "constant", value: 1, unit: "1" };
    const child = remaining - 1;
    const leftCount = Math.ceil(child / 2);
    return {
      kind: "multiply",
      left: scalarTree(leftCount),
      right: scalarTree(child - leftCount),
    };
  }
  assertThrows(
    () =>
      validateElectricalObservationExpression(
        scalarTree(ELECTRICAL_OBSERVATION_EXPRESSION_MAX_NODES + 1),
      ),
    TypeError,
    "closed expression node count",
  );
});
