import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  buildConstraintAst,
  fingerprintOracleRequirements,
  type OracleRequirement,
  renderOracleRequirementsSysml,
  renderTargetedOracleRequirementsSysml,
  validateOracleRequirements,
} from "./proof-case.ts";

// ---------------------------------------------------------------------------
// validateOracleRequirements
// ---------------------------------------------------------------------------

Deno.test("validateOracleRequirements rejects a non-array input", () => {
  assertThrows(
    () => validateOracleRequirements({ id: "x" }),
    Error,
    "$requirements must be an array",
  );
});

Deno.test("validateOracleRequirements rejects an empty list", () => {
  assertThrows(
    () => validateOracleRequirements([]),
    Error,
    "$requirements must not be empty",
  );
});

Deno.test("validateOracleRequirements rejects a requirement with an extra field", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "Max displacement",
          metric: "max_displacement",
          operator: "<=",
          limit: { value: 1.0, unit: "mm" },
          extra: "forbidden",
        },
      ]),
    Error,
    "unsupported field extra",
  );
});

Deno.test("validateOracleRequirements rejects a requirement with a missing field", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "Max displacement",
          metric: "max_displacement",
          operator: "<=",
          // limit intentionally absent
        },
      ]),
    Error,
    ".limit is required",
  );
});

Deno.test("unit is a value not decoration: a requirement with an empty unit is rejected", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "Max displacement",
          metric: "max_displacement",
          operator: "<=",
          limit: { value: 1.0, unit: "" },
        },
      ]),
    Error,
  );
});

Deno.test("unit is a value not decoration: a limit missing its unit field is rejected", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "Max displacement",
          metric: "max_displacement",
          operator: "<=",
          limit: { value: 1.0 },
        },
      ]),
    Error,
    ".unit is required",
  );
});

Deno.test("validateOracleRequirements rejects an unsupported operator", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "Max displacement",
          metric: "max_displacement",
          operator: "==",
          limit: { value: 1.0, unit: "mm" },
        },
      ]),
    Error,
    '"<=" or ">="',
  );
});

Deno.test("validateOracleRequirements rejects duplicate requirement ids", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "A",
          metric: "m1",
          operator: "<=",
          limit: { value: 1, unit: "mm" },
        },
        {
          id: "req-1",
          name: "B",
          metric: "m2",
          operator: "<=",
          limit: { value: 2, unit: "mm" },
        },
      ]),
    Error,
    "ids must not contain duplicates",
  );
});

Deno.test("validateOracleRequirements rejects a non-finite limit value", () => {
  assertThrows(
    () =>
      validateOracleRequirements([
        {
          id: "req-1",
          name: "A",
          metric: "m1",
          operator: "<=",
          limit: { value: Infinity, unit: "mm" },
        },
      ]),
    Error,
    "must be a finite number",
  );
});

Deno.test("validateOracleRequirements accepts a valid <= requirement", () => {
  const result = validateOracleRequirements([
    {
      id: "req-displacement",
      name: "Assembly max displacement",
      metric: "max_displacement",
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
    },
  ]);
  assertEquals(result.length, 1);
  assertEquals(result[0].id, "req-displacement");
  assertEquals(result[0].operator, "<=");
  assertEquals(result[0].limit.unit, "mm");
});

Deno.test("validateOracleRequirements accepts a valid >= requirement", () => {
  const result = validateOracleRequirements([
    {
      id: "req-temp",
      name: "Water temperature reached",
      metric: "water_temperature_max",
      operator: ">=",
      limit: { value: 90, unit: "degC" },
    },
  ]);
  assertEquals(result[0].operator, ">=");
});

Deno.test("validateOracleRequirements accepts a list of two requirements with distinct ids", () => {
  const result = validateOracleRequirements([
    {
      id: "req-displacement",
      name: "Max displacement",
      metric: "max_displacement",
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
    },
    {
      id: "req-stress",
      name: "Max von Mises stress",
      metric: "max_von_mises",
      operator: "<=",
      limit: { value: 20_000_000, unit: "Pa" },
    },
  ]);
  assertEquals(result.length, 2);
  assertEquals(result[0].id, "req-displacement");
  assertEquals(result[1].id, "req-stress");
});

Deno.test("validateOracleRequirements returns frozen immutable requirement objects", () => {
  const result = validateOracleRequirements([
    {
      id: "req-1",
      name: "Test req",
      metric: "metric_1",
      operator: "<=",
      limit: { value: 5, unit: "MPa" },
    },
  ]);
  assertEquals(Object.isFrozen(result[0]), true);
  assertEquals(Object.isFrozen(result[0].limit), true);
});

// ---------------------------------------------------------------------------
// buildConstraintAst
// ---------------------------------------------------------------------------

Deno.test(
  "buildConstraintAst produces the AST shape consumed by syson_constraint_evaluate",
  () => {
    const requirements = validateOracleRequirements([
      {
        id: "req-stress",
        name: "Max von Mises stress",
        metric: "max_von_mises",
        operator: "<=",
        limit: { value: 20.0, unit: "MPa" },
      },
    ]);
    const ast = buildConstraintAst(requirements[0]);
    assertEquals(ast.id, "req-stress");
    assertEquals(ast.name, "Max von Mises stress");
    assertEquals(ast.expression.kind, "binary");
    assertEquals(ast.expression.op, "<=");
    assertEquals(ast.expression.left.kind, "ref");
    assertEquals(ast.expression.left.featurePath, ["max_von_mises"]);
    assertEquals(ast.expression.right.kind, "literal");
    assertEquals(ast.expression.right.value, 20.0);
    assertEquals(ast.expression.right.unit, "MPa");
  },
);

Deno.test(
  "buildConstraintAst preserves the operator direction for >= requirements",
  () => {
    const requirements = validateOracleRequirements([
      {
        id: "req-temp",
        name: "Water temperature reached",
        metric: "water_temperature_max",
        operator: ">=",
        limit: { value: 90, unit: "degC" },
      },
    ]);
    const ast = buildConstraintAst(requirements[0]);
    assertEquals(ast.expression.op, ">=");
    assertEquals(ast.expression.right.unit, "degC");
  },
);

Deno.test("buildConstraintAst places the metric in the featurePath single-element tuple", () => {
  const requirements = validateOracleRequirements([
    {
      id: "req-1",
      name: "Test",
      metric: "assembly_max_displacement",
      operator: "<=",
      limit: { value: 1, unit: "mm" },
    },
  ]);
  const ast = buildConstraintAst(requirements[0]);
  assertEquals(ast.expression.left.featurePath.length, 1);
  assertEquals(ast.expression.left.featurePath[0], "assembly_max_displacement");
});

Deno.test("buildConstraintAst returns a frozen immutable AST node", () => {
  const requirements = validateOracleRequirements([
    {
      id: "req-1",
      name: "Test",
      metric: "m",
      operator: ">=",
      limit: { value: 1, unit: "mm" },
    },
  ]);
  const ast = buildConstraintAst(requirements[0]);
  assertEquals(Object.isFrozen(ast), true);
  assertEquals(Object.isFrozen(ast.expression), true);
  assertEquals(Object.isFrozen(ast.expression.left), true);
  assertEquals(Object.isFrozen(ast.expression.right), true);
});

// ---------------------------------------------------------------------------
// renderOracleRequirementsSysml
// ---------------------------------------------------------------------------

// Shared fixture representing the two mechanical proof requirements.
const MECH_REQS = validateOracleRequirements([
  {
    id: "assembly_max_displacement",
    name: "DripTray maximum displacement limit",
    metric: "assembly_max_displacement",
    operator: "<=",
    limit: { value: 1, unit: "mm" },
  },
  {
    id: "assembly_max_von_mises",
    name: "DripTray maximum von Mises stress limit",
    metric: "assembly_max_von_mises",
    operator: "<=",
    limit: { value: 20000000, unit: "Pa" },
  },
]);

Deno.test("renderOracleRequirementsSysml render output is stable across two calls", () => {
  const first = renderOracleRequirementsSysml("DripTrayRequirements", MECH_REQS);
  const second = renderOracleRequirementsSysml("DripTrayRequirements", MECH_REQS);
  assertEquals(first, second);
});

Deno.test(
  "renderOracleRequirementsSysml output contains the confirmed SysML structure",
  () => {
    const text = renderOracleRequirementsSysml("DripTrayRequirements", MECH_REQS);
    // Part def wrapper
    assertEquals(text.startsWith("part def DripTrayRequirements {"), true);
    assertEquals(text.endsWith("}"), true);
    // SI import
    assertEquals(text.includes("private import SI::*;"), true);
    // Attribute declarations with confirmed types
    assertEquals(
      text.includes("attribute assembly_max_displacement : LengthValue;"),
      true,
    );
    assertEquals(
      text.includes("attribute assembly_max_von_mises : PressureValue;"),
      true,
    );
    // Constraint usages — attribute name in body must equal metric (featurePath invariant)
    assertEquals(
      text.includes(
        "constraint assembly_max_displacement_limit { assembly_max_displacement <= 1 [mm] }",
      ),
      true,
    );
    assertEquals(
      text.includes(
        "constraint assembly_max_von_mises_limit { assembly_max_von_mises <= 20000000 [Pa] }",
      ),
      true,
    );
  },
);

Deno.test(
  "renderTargetedOracleRequirementsSysml emits a native requirement subject and required constraints",
  () => {
    const text = renderTargetedOracleRequirementsSysml(
      "DripTrayRequirements",
      "DripTray",
      MECH_REQS,
    );
    assertEquals(text.startsWith("requirement DripTrayRequirements {"), true);
    assertEquals(text.includes("subject target : DripTray;"), true);
    assertEquals(
      text.includes(
        "require constraint assembly_max_displacement_limit { assembly_max_displacement <= 1 [mm] }",
      ),
      true,
    );
    assertEquals(text.includes("part def DripTrayRequirements"), false);
  },
);

Deno.test(
  "renderOracleRequirementsSysml is deterministic regardless of input order",
  () => {
    const reversed = validateOracleRequirements([
      {
        id: "assembly_max_von_mises",
        name: "DripTray maximum von Mises stress limit",
        metric: "assembly_max_von_mises",
        operator: "<=",
        limit: { value: 20000000, unit: "Pa" },
      },
      {
        id: "assembly_max_displacement",
        name: "DripTray maximum displacement limit",
        metric: "assembly_max_displacement",
        operator: "<=",
        limit: { value: 1, unit: "mm" },
      },
    ]);
    const normal = renderOracleRequirementsSysml("DripTrayRequirements", MECH_REQS);
    const rev = renderOracleRequirementsSysml("DripTrayRequirements", reversed);
    assertEquals(normal, rev);
  },
);

Deno.test(
  "renderOracleRequirementsSysml rejects a metric that is not a valid SysML identifier",
  () => {
    const reqs = validateOracleRequirements([
      {
        id: "req_1",
        name: "Test",
        metric: "maximum-displacement",
        operator: "<=",
        limit: { value: 1, unit: "mm" },
      },
    ]);
    assertThrows(
      () => renderOracleRequirementsSysml("TestDef", reqs),
      Error,
      "not a valid SysML identifier",
    );
  },
);

Deno.test(
  "renderOracleRequirementsSysml rejects an id that is not a valid SysML identifier",
  () => {
    const reqs = validateOracleRequirements([
      {
        id: "req-hyphenated",
        name: "Test",
        metric: "displacement",
        operator: "<=",
        limit: { value: 1, unit: "mm" },
      },
    ]);
    assertThrows(
      () => renderOracleRequirementsSysml("TestDef", reqs),
      Error,
      "not a valid SysML identifier",
    );
  },
);

Deno.test(
  "unit is a value not decoration: a requirement with an unsupported unit is rejected by the renderer",
  () => {
    const reqs = validateOracleRequirements([
      {
        id: "req_temp",
        name: "Temperature limit",
        metric: "water_temp",
        operator: ">=",
        limit: { value: 90, unit: "degC" },
      },
    ]);
    assertThrows(
      () => renderOracleRequirementsSysml("TestDef", reqs),
      Error,
      "no confirmed SysML attribute type mapping",
    );
  },
);

Deno.test(
  "renderOracleRequirementsSysml rejects a partDefName that is not a valid SysML identifier",
  () => {
    assertThrows(
      () => renderOracleRequirementsSysml("drip-tray-def", MECH_REQS),
      Error,
      "not a valid SysML identifier",
    );
  },
);

Deno.test("renderOracleRequirementsSysml rejects an empty requirements list", () => {
  // Empty array cannot pass validateOracleRequirements, but the renderer has
  // its own guard for callers that bypass validation.
  const empty: readonly OracleRequirement[] = [];
  assertThrows(
    () => renderOracleRequirementsSysml("TestDef", empty),
    Error,
    "must not be empty",
  );
});

// ---------------------------------------------------------------------------
// fingerprintOracleRequirements
// ---------------------------------------------------------------------------

Deno.test(
  "fingerprintOracleRequirements two requirements with different thresholds produce different fingerprints",
  async () => {
    const reqs1 = validateOracleRequirements([
      {
        id: "assembly_max_displacement",
        name: "Displacement limit",
        metric: "assembly_max_displacement",
        operator: "<=",
        limit: { value: 1, unit: "mm" },
      },
    ]);
    const reqs2 = validateOracleRequirements([
      {
        id: "assembly_max_displacement",
        name: "Displacement limit",
        metric: "assembly_max_displacement",
        operator: "<=",
        limit: { value: 2, unit: "mm" },
      },
    ]);
    const fp1 = await fingerprintOracleRequirements(reqs1);
    const fp2 = await fingerprintOracleRequirements(reqs2);
    assertNotEquals(fp1.digest, fp2.digest);
  },
);

Deno.test("fingerprintOracleRequirements is stable across two calls", async () => {
  const fp1 = await fingerprintOracleRequirements(MECH_REQS);
  const fp2 = await fingerprintOracleRequirements(MECH_REQS);
  assertEquals(fp1.digest, fp2.digest);
  assertEquals(fp1.algorithm, "sha256");
});
