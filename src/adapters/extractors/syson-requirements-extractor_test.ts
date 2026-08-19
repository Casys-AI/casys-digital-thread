import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { McpToolResult } from "../../application/ports/out/mcp-tool-client.ts";
import type { OracleRequirement } from "../../domain/kernel/proof-case.ts";
import {
  extractAndVerifyOracleRequirements,
  RequirementExtractionError,
  verifyExtractedConstraint,
} from "./syson-requirements-extractor.ts";

// ---------------------------------------------------------------------------
// Canonical requirements — the reviewed declaration the extractor verifies
// against.  These are never read from the model; the model is the witness.
// ---------------------------------------------------------------------------

const CANONICAL: readonly OracleRequirement[] = Object.freeze([
  Object.freeze({
    id: "assembly_max_displacement",
    name: "DripTray maximum displacement limit",
    metric: "assembly_max_displacement",
    operator: "<=" as const,
    limit: Object.freeze({ value: 1, unit: "mm" }),
  }),
  Object.freeze({
    id: "assembly_max_von_mises",
    name: "DripTray maximum von Mises stress limit",
    metric: "assembly_max_von_mises",
    operator: "<=" as const,
    limit: Object.freeze({ value: 20, unit: "MPa" }),
  }),
]);

// ---------------------------------------------------------------------------
// Helpers — build a faithful extracted-constraint row and mutate fields
// ---------------------------------------------------------------------------

function faithfulConstraint(index: 0 | 1): Record<string, unknown> {
  const req = CANONICAL[index]!;
  return {
    id: `constraint-usage-${index}`,
    name: req.name,
    sourceId: `constraint-usage-${index}`,
    expression: {
      kind: "binary",
      op: req.operator,
      left: { kind: "ref", featurePath: [req.metric] },
      right: { kind: "literal", value: req.limit.value, unit: req.limit.unit },
    },
  };
}

function faithfulConstraints(): unknown[] {
  return [faithfulConstraint(0), faithfulConstraint(1)];
}

// ---------------------------------------------------------------------------
// Mock clients
// ---------------------------------------------------------------------------

class SysonExtractClient {
  constructor(private readonly content: Record<string, unknown>) {}
  callTool(): Promise<McpToolResult> {
    return Promise.resolve({
      structuredContent: structuredClone(this.content),
      text: "",
    });
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("not implemented in test"));
  }
}

class FailingSysonClient {
  callTool(): Promise<McpToolResult> {
    return Promise.reject(new Error("SysON is unavailable"));
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("not implemented in test"));
  }
}

// ---------------------------------------------------------------------------
// extractAndVerifyOracleRequirements — integration tests with mock client
// ---------------------------------------------------------------------------

Deno.test(
  "faithful extraction returns the canonical requirements unchanged",
  async () => {
    const client = new SysonExtractClient({ constraints: faithfulConstraints() });
    const result = await extractAndVerifyOracleRequirements(
      client,
      "editing-context-id",
      "requirements-element-id",
      CANONICAL,
    );
    assertEquals(result.requirements, CANONICAL);
    assertEquals(result.constraintUsages, [{
      requirementId: "assembly_max_displacement",
      id: "constraint-usage-0",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage-0",
    }, {
      requirementId: "assembly_max_von_mises",
      id: "constraint-usage-1",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage-1",
    }]);
  },
);

Deno.test(
  "a network failure during extraction stops the run with code requirement_extraction_failed",
  async () => {
    const error = await assertRejects(
      () =>
        extractAndVerifyOracleRequirements(
          new FailingSysonClient(),
          "ctx",
          "elem",
          CANONICAL,
        ),
      RequirementExtractionError,
      "SysON is unavailable",
    );
    assertEquals(error.code, "requirement_extraction_failed");
  },
);

Deno.test(
  "a missing constraints array in the response stops the run with code requirement_extraction_failed",
  async () => {
    const client = new SysonExtractClient({ not_constraints: [] });
    const error = await assertRejects(
      () => extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL),
      RequirementExtractionError,
      "exact successful constraints response",
    );
    assertEquals(error.code, "requirement_extraction_failed");
    assertEquals(error.context.field, "constraints");
  },
);

Deno.test(
  "a count mismatch between model and canonical is rejected with code requirement_count_mismatch",
  async () => {
    const client = new SysonExtractClient({
      constraints: [faithfulConstraint(0)],
    });
    const error = await assertRejects(
      () => extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL),
      RequirementExtractionError,
      "expected 2",
    );
    assertEquals(error.code, "requirement_count_mismatch");
    assertEquals(error.context.expectedCount, 2);
    assertEquals(error.context.actualCount, 1);
  },
);

Deno.test(
  "a SysON element id never stands in for the reviewed requirement identity",
  async () => {
    // SysON assigns its own UUIDs to inserted constraints; the live server
    // proved on 2026-08-04 that the id field can never equal the reviewed id.
    // The join is the metric named by the feature path, so a foreign id with a
    // faithful expression must still verify.
    const constraints = faithfulConstraints();
    (constraints[0] as Record<string, unknown>).id = "e20363c3-uuid-from-syson";
    (constraints[0] as Record<string, unknown>).sourceId = "e20363c3-uuid-from-syson";
    const client = new SysonExtractClient({ constraints });
    await extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL);
  },
);

Deno.test(
  "a ConstraintUsage whose sourceId differs from its native id is rejected",
  async () => {
    const constraints = faithfulConstraints();
    (constraints[0] as Record<string, unknown>).sourceId = "foreign-source";
    const error = await assertRejects(
      () =>
        extractAndVerifyOracleRequirements(
          new SysonExtractClient({ constraints }),
          "ctx",
          "elem",
          CANONICAL,
        ),
      RequirementExtractionError,
      "id and sourceId diverge",
    );
    assertEquals(error.code, "requirement_extraction_failed");
  },
);

Deno.test(
  "a successful response without exact ConstraintUsage identities is rejected",
  async () => {
    const constraints = faithfulConstraints();
    delete (constraints[0] as Record<string, unknown>).sourceId;
    const error = await assertRejects(
      () =>
        extractAndVerifyOracleRequirements(
          new SysonExtractClient({ constraints }),
          "ctx",
          "elem",
          CANONICAL,
        ),
      RequirementExtractionError,
      "non-exact fields",
    );
    assertEquals(error.code, "requirement_extraction_failed");
  },
);

Deno.test(
  "duplicate native ConstraintUsage identities cannot satisfy two requirements",
  async () => {
    const constraints = faithfulConstraints();
    const first = constraints[0] as Record<string, unknown>;
    const second = constraints[1] as Record<string, unknown>;
    second.id = first.id;
    second.sourceId = first.sourceId;
    const error = await assertRejects(
      () =>
        extractAndVerifyOracleRequirements(
          new SysonExtractClient({ constraints }),
          "ctx",
          "elem",
          CANONICAL,
        ),
      RequirementExtractionError,
      "duplicate native ConstraintUsage identity",
    );
    assertEquals(error.code, "requirement_extraction_failed");
  },
);

Deno.test(
  "a constraint whose metric is absent from the model is rejected with code requirement_missing",
  async () => {
    const constraints = faithfulConstraints();
    const expr = (constraints[0] as Record<string, unknown>)
      .expression as Record<string, unknown>;
    (expr.left as Record<string, unknown>).featurePath = ["some_other_metric"];
    const client = new SysonExtractClient({ constraints });
    const error = await assertRejects(
      () => extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL),
      RequirementExtractionError,
    );
    assertEquals(error.code, "requirement_missing");
  },
);

Deno.test(
  "a divergent threshold is rejected with code requirement_tampered",
  async () => {
    const constraints = faithfulConstraints();
    const disp = constraints[0] as Record<string, unknown>;
    const expr = disp.expression as Record<string, unknown>;
    const right = expr.right as Record<string, unknown>;
    right.value = 0.5; // tampered: 1 mm → 0.5 mm
    const client = new SysonExtractClient({ constraints });
    const error = await assertRejects(
      () => extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL),
      RequirementExtractionError,
      "threshold",
    );
    assertEquals(error.code, "requirement_tampered");
    assertEquals(error.context.requirementId, "assembly_max_displacement");
    assertEquals(error.context.field, "limit.value");
    assertEquals(error.context.expected, 1);
    assertEquals(error.context.actual, 0.5);
  },
);

Deno.test(
  "a divergent unit is rejected with code requirement_tampered",
  async () => {
    const constraints = faithfulConstraints();
    const disp = constraints[0] as Record<string, unknown>;
    const expr = disp.expression as Record<string, unknown>;
    const right = expr.right as Record<string, unknown>;
    right.unit = "m"; // tampered: mm → m
    const client = new SysonExtractClient({ constraints });
    const error = await assertRejects(
      () => extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL),
      RequirementExtractionError,
      "unit",
    );
    assertEquals(error.code, "requirement_tampered");
    assertEquals(error.context.requirementId, "assembly_max_displacement");
    assertEquals(error.context.field, "limit.unit");
    assertEquals(error.context.expected, "mm");
    assertEquals(error.context.actual, "m");
  },
);

Deno.test(
  "a unit expressed in Pa instead of MPa is rejected even when the quantity is equivalent",
  async () => {
    // The model must store the exact unit declared in the canonical list.
    // Normalizing 20000000 Pa ≡ 20 MPa would mask a tampered threshold like 19000000 Pa.
    const constraints = faithfulConstraints();
    const vm = constraints[1] as Record<string, unknown>;
    const expr = vm.expression as Record<string, unknown>;
    const right = expr.right as Record<string, unknown>;
    right.value = 20_000_000;
    right.unit = "Pa"; // canonical has MPa
    const client = new SysonExtractClient({ constraints });
    const error = await assertRejects(
      () => extractAndVerifyOracleRequirements(client, "ctx", "elem", CANONICAL),
      RequirementExtractionError,
    );
    // Either "limit.value" or "limit.unit" diverges; both are tampered codes.
    assertEquals(error.code, "requirement_tampered");
    assertEquals(error.context.requirementId, "assembly_max_von_mises");
  },
);

// ---------------------------------------------------------------------------
// verifyExtractedConstraint — pure verification, unit-testable without I/O
// ---------------------------------------------------------------------------

Deno.test("verifyExtractedConstraint accepts a row that matches the canonical requirement", () => {
  const req = CANONICAL[0]!;
  // Must not throw.
  verifyExtractedConstraint(faithfulConstraint(0), req);
});

Deno.test("verifyExtractedConstraint rejects wrong AST discriminants", () => {
  const req = CANONICAL[0]!;
  const cases: readonly {
    mutate: (row: Record<string, unknown>) => void;
    field: string;
    expected: string;
    actual: string;
  }[] = [
    {
      mutate: (row) => {
        (row.expression as Record<string, unknown>).kind = "unary";
      },
      field: "expression.kind",
      expected: "binary",
      actual: "unary",
    },
    {
      mutate: (row) => {
        const expression = row.expression as Record<string, unknown>;
        (expression.left as Record<string, unknown>).kind = "literal";
      },
      field: "expression.left.kind",
      expected: "ref",
      actual: "literal",
    },
    {
      mutate: (row) => {
        const expression = row.expression as Record<string, unknown>;
        (expression.right as Record<string, unknown>).kind = "ref";
      },
      field: "expression.right.kind",
      expected: "literal",
      actual: "ref",
    },
  ];

  for (const testCase of cases) {
    const row = faithfulConstraint(0);
    testCase.mutate(row);
    const error = assertThrows(
      () => verifyExtractedConstraint(row, req),
      RequirementExtractionError,
    );
    assertEquals(error.code, "requirement_tampered");
    assertEquals(error.context.field, testCase.field);
    assertEquals(error.context.expected, testCase.expected);
    assertEquals(error.context.actual, testCase.actual);
  }
});

Deno.test("verifyExtractedConstraint rejects an extra feature-path segment", () => {
  const req = CANONICAL[0]!;
  const row = faithfulConstraint(0);
  const expression = row.expression as Record<string, unknown>;
  (expression.left as Record<string, unknown>).featurePath = [
    req.metric,
    "nested_feature",
  ];

  const error = assertThrows(
    () => verifyExtractedConstraint(row, req),
    RequirementExtractionError,
  );
  assertEquals(error.code, "requirement_tampered");
  assertEquals(error.context.field, "expression.left.featurePath");
  assertEquals(error.context.expected, [req.metric]);
  assertEquals(error.context.actual, [req.metric, "nested_feature"]);
});

Deno.test("verifyExtractedConstraint rejects a divergent operator with code requirement_tampered", () => {
  const req = CANONICAL[0]!;
  const row = faithfulConstraint(0);
  (row.expression as Record<string, unknown>).op = ">=";
  try {
    verifyExtractedConstraint(row, req);
    throw new Error("expected RequirementExtractionError");
  } catch (error) {
    if (!(error instanceof RequirementExtractionError)) throw error;
    assertEquals(error.code, "requirement_tampered");
    assertEquals(error.context.field, "operator");
    assertEquals(error.context.expected, "<=");
    assertEquals(error.context.actual, ">=");
  }
});

Deno.test("verifyExtractedConstraint rejects a divergent metric with code requirement_tampered", () => {
  const req = CANONICAL[0]!;
  const row = faithfulConstraint(0);
  const expr = row.expression as Record<string, unknown>;
  (expr.left as Record<string, unknown>).featurePath = ["other_metric"];
  try {
    verifyExtractedConstraint(row, req);
    throw new Error("expected RequirementExtractionError");
  } catch (error) {
    if (!(error instanceof RequirementExtractionError)) throw error;
    assertEquals(error.code, "requirement_tampered");
    assertEquals(error.context.field, "metric");
    assertEquals(error.context.expected, "assembly_max_displacement");
    assertEquals(error.context.actual, "other_metric");
  }
});

Deno.test("verifyExtractedConstraint rejects a missing expression object with code requirement_extraction_failed", () => {
  const req = CANONICAL[0]!;
  const row = faithfulConstraint(0);
  delete (row as Record<string, unknown>).expression;
  try {
    verifyExtractedConstraint(row, req);
    throw new Error("expected RequirementExtractionError");
  } catch (error) {
    if (!(error instanceof RequirementExtractionError)) throw error;
    assertEquals(error.code, "requirement_extraction_failed");
  }
});
