import { assertEquals, assertRejects } from "@std/assert";
import {
  SENSITIVITY_RELATIONS_SCHEMA,
  validateSensitivityRelationsDeclaration,
} from "../domain/sensitivity-relations.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "./http-mcp-tool-client.ts";
import {
  extractAndVerifySensitivityRelations,
  SensitivityRelationsExtractionError,
  verifyExtractedBound,
} from "./syson-sensitivity-relations-extractor.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DECL_VALUE: unknown = {
  schemaVersion: SENSITIVITY_RELATIONS_SCHEMA,
  paramAttrs: [
    { attrName: "sizeZ_base_mm", unit: "mm" },
    { attrName: "sizeZ_step_mm", unit: "mm" },
  ],
  derivativeAttrs: [
    { attrName: "dDisplacementDSizeZ_mm_per_mm", unit: "mm/mm" },
    { attrName: "dVonMisesDSizeZ_MPa_per_mm", unit: "MPa/mm" },
  ],
  validityBounds: [
    {
      constraintName: "sizeZ_validity_lower",
      paramAttrName: "sizeZ_base_mm",
      operator: ">=",
      boundValue: 29,
      boundUnit: "mm",
    },
    {
      constraintName: "sizeZ_validity_upper",
      paramAttrName: "sizeZ_base_mm",
      operator: "<=",
      boundValue: 31,
      boundUnit: "mm",
    },
  ],
  runId: "run-2026-08-04",
  capturedAt: "2026-08-04T11:43:39.000Z",
};

const DECL = validateSensitivityRelationsDeclaration(DECL_VALUE);

/**
 * Simulate a SysON response where constraint UUIDs differ from the reviewed
 * constraint names — the live-server evidence (2026-08-04) proved this.
 * The extractor must NOT join on UUID; it joins on featurePath[0].
 */
function makeSysonClient(
  constraintResponse: unknown,
  childrenResponse: unknown,
): McpToolClient {
  return {
    callTool(call: McpToolCall): Promise<McpToolResult> {
      if (call.name === "syson_constraint_extract") {
        return Promise.resolve({
          structuredContent: constraintResponse as Record<string, unknown>,
          text: "constraints",
        });
      }
      if (call.name === "syson_element_children") {
        return Promise.resolve({
          structuredContent: childrenResponse as Record<string, unknown>,
          text: "children",
        });
      }
      return Promise.reject(new Error(`Unexpected tool call: ${call.name}`));
    },
    callToolTextResult(_call: McpToolCall): Promise<Record<string, unknown>> {
      return Promise.reject(new Error("callToolTextResult not implemented by stub"));
    },
  };
}

const FAITHFUL_CONSTRAINTS = {
  constraints: [
    {
      // UUID is foreign (SysON-assigned) — must NOT be used for joining.
      id: "e20363c3-6b43-4fbd-98b2-c4f72fdb8b6b",
      name: "sizeZ_validity_lower",
      expression: {
        kind: "binary",
        op: ">=",
        left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
        right: { kind: "literal", value: 29, unit: "mm" },
      },
    },
    {
      id: "604fc986-662c-4a0f-9519-51b26b927c91",
      name: "sizeZ_validity_upper",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
        right: { kind: "literal", value: 31, unit: "mm" },
      },
    },
  ],
  errors: [],
};

const FAITHFUL_CHILDREN = {
  parentId: "element-abc",
  count: 6,
  children: [
    { id: "a1", kind: "AttributeUsage", label: "sizeZ_base_mm" },
    { id: "a2", kind: "AttributeUsage", label: "sizeZ_step_mm" },
    { id: "a3", kind: "AttributeUsage", label: "dDisplacementDSizeZ_mm_per_mm" },
    { id: "a4", kind: "AttributeUsage", label: "dVonMisesDSizeZ_MPa_per_mm" },
    { id: "c1", kind: "ConstraintUsage", label: "sizeZ_validity_lower" },
    { id: "c2", kind: "ConstraintUsage", label: "sizeZ_validity_upper" },
  ],
};

// ---------------------------------------------------------------------------
// Tests — successful extraction
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityRelations accepts a faithful extraction with foreign UUIDs",
  async () => {
    const syson = makeSysonClient(FAITHFUL_CONSTRAINTS, FAITHFUL_CHILDREN);
    const result = await extractAndVerifySensitivityRelations(
      syson,
      "ctx-id",
      "element-abc",
      DECL,
    );
    // Returns the declaration unchanged (model is the witness, not the authority).
    assertEquals(result.schemaVersion, SENSITIVITY_RELATIONS_SCHEMA);
    assertEquals(result.runId, "run-2026-08-04");
  },
);

// ---------------------------------------------------------------------------
// Tests — constraint extraction failures
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityRelations rejects when constraint count mismatches",
  async () => {
    const constraints = {
      constraints: [FAITHFUL_CONSTRAINTS.constraints[0]],
      errors: [],
    };
    const syson = makeSysonClient(constraints, FAITHFUL_CHILDREN);
    await assertRejects(
      () => extractAndVerifySensitivityRelations(syson, "ctx", "elem", DECL),
      SensitivityRelationsExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityRelations rejects when a bound operator is altered",
  async () => {
    const tampered = {
      constraints: [
        {
          ...FAITHFUL_CONSTRAINTS.constraints[0],
          expression: {
            ...FAITHFUL_CONSTRAINTS.constraints[0]!.expression,
            op: "<=", // wrong: should be ">="
          },
        },
        FAITHFUL_CONSTRAINTS.constraints[1],
      ],
      errors: [],
    };
    const syson = makeSysonClient(tampered, FAITHFUL_CHILDREN);
    await assertRejects(
      () => extractAndVerifySensitivityRelations(syson, "ctx", "elem", DECL),
      SensitivityRelationsExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityRelations rejects when a bound value is altered",
  async () => {
    const tampered = {
      constraints: [
        {
          ...FAITHFUL_CONSTRAINTS.constraints[0],
          expression: {
            kind: "binary",
            op: ">=",
            left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
            right: { kind: "literal", value: 28, unit: "mm" }, // wrong: should be 29
          },
        },
        FAITHFUL_CONSTRAINTS.constraints[1],
      ],
      errors: [],
    };
    const syson = makeSysonClient(tampered, FAITHFUL_CHILDREN);
    await assertRejects(
      () => extractAndVerifySensitivityRelations(syson, "ctx", "elem", DECL),
      SensitivityRelationsExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityRelations rejects when a bound unit is altered",
  async () => {
    const tampered = {
      constraints: [
        {
          ...FAITHFUL_CONSTRAINTS.constraints[0],
          expression: {
            kind: "binary",
            op: ">=",
            left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
            right: { kind: "literal", value: 29, unit: "m" }, // wrong unit
          },
        },
        FAITHFUL_CONSTRAINTS.constraints[1],
      ],
      errors: [],
    };
    const syson = makeSysonClient(tampered, FAITHFUL_CHILDREN);
    await assertRejects(
      () => extractAndVerifySensitivityRelations(syson, "ctx", "elem", DECL),
      SensitivityRelationsExtractionError,
    );
  },
);

// ---------------------------------------------------------------------------
// Tests — attribute name verification failures
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityRelations rejects when a derivative attribute is missing from children",
  async () => {
    const childrenMissingDerivative = {
      ...FAITHFUL_CHILDREN,
      children: FAITHFUL_CHILDREN.children.filter(
        (c) => c.label !== "dDisplacementDSizeZ_mm_per_mm",
      ),
    };
    const syson = makeSysonClient(FAITHFUL_CONSTRAINTS, childrenMissingDerivative);
    await assertRejects(
      () => extractAndVerifySensitivityRelations(syson, "ctx", "elem", DECL),
      SensitivityRelationsExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityRelations rejects when a param attribute is missing from children",
  async () => {
    const childrenMissingParam = {
      ...FAITHFUL_CHILDREN,
      children: FAITHFUL_CHILDREN.children.filter(
        (c) => c.label !== "sizeZ_step_mm",
      ),
    };
    const syson = makeSysonClient(FAITHFUL_CONSTRAINTS, childrenMissingParam);
    await assertRejects(
      () => extractAndVerifySensitivityRelations(syson, "ctx", "elem", DECL),
      SensitivityRelationsExtractionError,
    );
  },
);

// ---------------------------------------------------------------------------
// Tests — verifyExtractedBound (unit tested without network)
// ---------------------------------------------------------------------------

Deno.test("verifyExtractedBound passes for a faithful lower bound row", () => {
  verifyExtractedBound(FAITHFUL_CONSTRAINTS.constraints[0], DECL.validityBounds[0]!);
  // No throw = pass.
});

Deno.test("verifyExtractedBound rejects a divergent operator", () => {
  const tampered = {
    ...FAITHFUL_CONSTRAINTS.constraints[0],
    expression: {
      ...FAITHFUL_CONSTRAINTS.constraints[0]!.expression,
      op: "<=",
    },
  };
  try {
    verifyExtractedBound(tampered, DECL.validityBounds[0]!);
    throw new Error("Expected SensitivityRelationsExtractionError");
  } catch (error) {
    if (!(error instanceof SensitivityRelationsExtractionError)) {
      throw error;
    }
    assertEquals(error.code, "sensitivity_constraint_tampered");
    assertEquals(error.context.field, "operator");
  }
});

Deno.test("verifyExtractedBound rejects a divergent paramAttrName (featurePath[0] drift)", () => {
  // The constraint has the right name, operator, value, and unit — but the
  // expression.left.featurePath[0] references a different attribute. This covers
  // the case where SysON silently re-wires the constraint to a different parameter.
  const tampered = {
    ...FAITHFUL_CONSTRAINTS.constraints[0],
    expression: {
      kind: "binary",
      op: ">=",
      left: { kind: "ref", featurePath: ["sizeZ_step_mm"] }, // wrong: should be sizeZ_base_mm
      right: { kind: "literal", value: 29, unit: "mm" },
    },
  };
  try {
    verifyExtractedBound(tampered, DECL.validityBounds[0]!);
    throw new Error("Expected SensitivityRelationsExtractionError");
  } catch (error) {
    if (!(error instanceof SensitivityRelationsExtractionError)) {
      throw error;
    }
    assertEquals(error.code, "sensitivity_constraint_tampered");
    assertEquals(error.context.field, "paramAttrName");
    assertEquals(error.context.expected, "sizeZ_base_mm");
    assertEquals(error.context.actual, "sizeZ_step_mm");
  }
});
