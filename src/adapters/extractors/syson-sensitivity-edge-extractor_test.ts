import { assertEquals, assertRejects } from "@std/assert";
import {
  extractAndVerifySensitivityEdges,
  SensitivityEdgeExtractionError,
  verifyExtractedEdgeBound,
} from "./syson-sensitivity-edge-extractor.ts";
import { validateSensitivityEdgeSet } from "../../domain/sensitivity-edge.ts";
import { SENSITIVITY_EDGE_SCHEMA } from "../../domain/sensitivity-edge.ts";

// ---------------------------------------------------------------------------
// Fixtures — shapes copied from actual probe D response (2026-08-05)
// project probe-sensitivity-edge-2026-08-05 (deleted after probe)
//
// The probe inserted:
//   part def DripTraySensitivityEdges {
//     private import SI::*;
//     attribute sizeZ_base_assembly_max_displacement : LengthValue;
//     attribute d_assembly_max_displacement_mm_per_mm : DimensionOneValue;
//     attribute sizeZ_base_assembly_max_von_mises : LengthValue;
//     attribute d_assembly_max_von_mises_MPa_per_mm : PressureValue;
//     constraint assembly_max_displacement_validity_lower { sizeZ_base_assembly_max_displacement >= 29 [mm] }
//     constraint assembly_max_displacement_validity_upper { sizeZ_base_assembly_max_displacement <= 31 [mm] }
//     constraint assembly_max_von_mises_validity_lower { sizeZ_base_assembly_max_von_mises >= 29 [mm] }
//     constraint assembly_max_von_mises_validity_upper { sizeZ_base_assembly_max_von_mises <= 31 [mm] }
//   }
//
// syson_constraint_extract returned exactly these constraint rows (IDs
// anonymized; the extractor joins by name not ID).
// ---------------------------------------------------------------------------

const PROBE_CONSTRAINT_EXTRACT_RESPONSE = {
  constraints: [
    {
      id: "7b164a9c-8714-4a13-9f5f-7ee2cb230c10",
      name: "assembly_max_displacement_validity_lower",
      sourceId: "7b164a9c-8714-4a13-9f5f-7ee2cb230c10",
      expression: {
        kind: "binary",
        op: ">=",
        left: { kind: "ref", featurePath: ["sizeZ_base_assembly_max_displacement"] },
        right: { kind: "literal", value: 29, unit: "mm" },
      },
    },
    {
      id: "6b2b51c2-9f0e-4821-8b20-25769e4b1343",
      name: "assembly_max_displacement_validity_upper",
      sourceId: "6b2b51c2-9f0e-4821-8b20-25769e4b1343",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["sizeZ_base_assembly_max_displacement"] },
        right: { kind: "literal", value: 31, unit: "mm" },
      },
    },
    {
      id: "0094bc83-7c3b-4068-b204-e7a1c24227df",
      name: "assembly_max_von_mises_validity_lower",
      sourceId: "0094bc83-7c3b-4068-b204-e7a1c24227df",
      expression: {
        kind: "binary",
        op: ">=",
        left: { kind: "ref", featurePath: ["sizeZ_base_assembly_max_von_mises"] },
        right: { kind: "literal", value: 29, unit: "mm" },
      },
    },
    {
      id: "1e5e2d05-e19b-47c0-974c-b906bf83038b",
      name: "assembly_max_von_mises_validity_upper",
      sourceId: "1e5e2d05-e19b-47c0-974c-b906bf83038b",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["sizeZ_base_assembly_max_von_mises"] },
        right: { kind: "literal", value: 31, unit: "mm" },
      },
    },
  ],
};

// syson_element_children response — observed in probe D
const PROBE_CHILDREN_RESPONSE = {
  parentId: "fac84ff7-8040-4e3a-a3d3-438ed9c27f7b",
  count: 8,
  children: [
    {
      id: "aaa1",
      kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
      label: "sizeZ_base_assembly_max_displacement",
    },
    {
      id: "aaa2",
      kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
      label: "d_assembly_max_displacement_mm_per_mm",
    },
    {
      id: "aaa3",
      kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
      label: "sizeZ_base_assembly_max_von_mises",
    },
    {
      id: "aaa4",
      kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
      label: "d_assembly_max_von_mises_MPa_per_mm",
    },
    {
      id: "bbb1",
      kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
      label: "assembly_max_displacement_validity_lower",
    },
    {
      id: "bbb2",
      kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
      label: "assembly_max_displacement_validity_upper",
    },
    {
      id: "bbb3",
      kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
      label: "assembly_max_von_mises_validity_lower",
    },
    {
      id: "bbb4",
      kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
      label: "assembly_max_von_mises_validity_upper",
    },
  ],
};

// Domain edge set matching the probe fixture (using probe D names).
const PROBE_EDGES_VALID = validateSensitivityEdgeSet([
  {
    schemaVersion: SENSITIVITY_EDGE_SCHEMA,
    driver: {
      sysmlAttrName: "sizeZ_base_assembly_max_displacement",
      unit: "mm",
      basePoint: { value: 30, unit: "mm" },
      validityNeighborhood: {
        lower: { value: 29, unit: "mm" },
        upper: { value: 31, unit: "mm" },
        lowerConstraintName: "assembly_max_displacement_validity_lower",
        upperConstraintName: "assembly_max_displacement_validity_upper",
      },
    },
    response: {
      metric: "assembly_max_displacement",
      sysmlAttrName: "d_assembly_max_displacement_mm_per_mm",
      unit: "mm/mm",
    },
    derivative: { value: -0.008018, unit: "mm/mm" },
    provenance: { runId: "probe-run-id", capturedAt: "2026-08-05T10:00:00.000Z" },
  },
  {
    schemaVersion: SENSITIVITY_EDGE_SCHEMA,
    driver: {
      sysmlAttrName: "sizeZ_base_assembly_max_von_mises",
      unit: "mm",
      basePoint: { value: 30, unit: "mm" },
      validityNeighborhood: {
        lower: { value: 29, unit: "mm" },
        upper: { value: 31, unit: "mm" },
        lowerConstraintName: "assembly_max_von_mises_validity_lower",
        upperConstraintName: "assembly_max_von_mises_validity_upper",
      },
    },
    response: {
      metric: "assembly_max_von_mises",
      sysmlAttrName: "d_assembly_max_von_mises_MPa_per_mm",
      unit: "MPa/mm",
    },
    derivative: { value: -0.036042, unit: "MPa/mm" },
    provenance: { runId: "probe-run-id", capturedAt: "2026-08-05T10:00:00.000Z" },
  },
]);

// ---------------------------------------------------------------------------
// Stateful mock tool client
// ---------------------------------------------------------------------------

type CallOutcome =
  | { structuredContent: unknown }
  | { throw: Error };

function stubClient(
  responses: CallOutcome[],
): import("../http-mcp-tool-client.ts").McpToolClient {
  const queue = [...responses];
  return {
    callTool: (_args) => {
      const next = queue.shift();
      if (!next) throw new Error("Stub: no more responses queued.");
      if ("throw" in next) throw next.throw;
      return Promise.resolve(
        {
          structuredContent: next.structuredContent,
        } as import("../http-mcp-tool-client.ts").McpToolResult,
      );
    },
    callToolTextResult: (_args) =>
      Promise.reject(new Error("callToolTextResult not implemented by stubClient")),
  };
}

// ---------------------------------------------------------------------------
// extractAndVerifySensitivityEdges — happy path
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityEdges returns edges unchanged when model matches probe fixtures",
  async () => {
    const client = stubClient([
      { structuredContent: PROBE_CONSTRAINT_EXTRACT_RESPONSE },
      { structuredContent: PROBE_CHILDREN_RESPONSE },
    ]);
    const result = await extractAndVerifySensitivityEdges(
      client,
      "ec-id",
      "elem-id",
      PROBE_EDGES_VALID,
    );
    assertEquals(result.length, 2);
    assertEquals(result[0]!.response.metric, "assembly_max_displacement");
    assertEquals(result[1]!.response.metric, "assembly_max_von_mises");
  },
);

// ---------------------------------------------------------------------------
// Phase 1 failures
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_constraint_count_mismatch when constraint count differs",
  async () => {
    const reduced = {
      ...PROBE_CONSTRAINT_EXTRACT_RESPONSE,
      constraints: PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints.slice(0, 2), // only 2 of 4
    };
    const client = stubClient([{ structuredContent: reduced }]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_constraint_missing when a named constraint is absent",
  async () => {
    // Replace the lower constraint name to something unexpected
    const tampered = {
      constraints: PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints.map((c, i) =>
        i === 0 ? { ...c, name: "wrong_name" } : c
      ),
    };
    const client = stubClient([{ structuredContent: tampered }]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_constraint_tampered when featurePath is wrong",
  async () => {
    // Simulate what would happen with 'specializes' (probe observed this): featurePath = ["FeatureReferenceExpression"]
    const tampered = {
      constraints: PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints.map((c, i) =>
        i === 0
          ? {
            ...c,
            expression: {
              ...c.expression,
              left: { kind: "ref", featurePath: ["FeatureReferenceExpression"] },
            },
          }
          : c
      ),
    };
    const client = stubClient([{ structuredContent: tampered }]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_constraint_tampered when bound value differs",
  async () => {
    const tampered = {
      constraints: PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints.map((c, i) =>
        i === 0
          ? {
            ...c,
            expression: {
              ...c.expression,
              right: { kind: "literal", value: 28, unit: "mm" }, // 28 ≠ 29
            },
          }
          : c
      ),
    };
    const client = stubClient([{ structuredContent: tampered }]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_constraint_tampered when operator is wrong",
  async () => {
    const tampered = {
      constraints: PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints.map((c, i) =>
        i === 0
          ? {
            ...c,
            expression: { ...c.expression, op: "<=" }, // lower bound changed to <=
          }
          : c
      ),
    };
    const client = stubClient([{ structuredContent: tampered }]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_constraint_tampered when bound unit differs",
  async () => {
    const tampered = {
      constraints: PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints.map((c, i) =>
        i === 0
          ? {
            ...c,
            expression: {
              ...c.expression,
              right: { kind: "literal", value: 29, unit: "m" }, // wrong unit
            },
          }
          : c
      ),
    };
    const client = stubClient([{ structuredContent: tampered }]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

// ---------------------------------------------------------------------------
// Phase 2 failures
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_attribute_missing when a driver attr is absent",
  async () => {
    const missingDriverAttr = {
      ...PROBE_CHILDREN_RESPONSE,
      children: PROBE_CHILDREN_RESPONSE.children.filter(
        (c) => c.label !== "sizeZ_base_assembly_max_displacement",
      ),
    };
    const client = stubClient([
      { structuredContent: PROBE_CONSTRAINT_EXTRACT_RESPONSE },
      { structuredContent: missingDriverAttr },
    ]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_attribute_missing when a response attr is absent",
  async () => {
    const missingResponseAttr = {
      ...PROBE_CHILDREN_RESPONSE,
      children: PROBE_CHILDREN_RESPONSE.children.filter(
        (c) => c.label !== "d_assembly_max_displacement_mm_per_mm",
      ),
    };
    const client = stubClient([
      { structuredContent: PROBE_CONSTRAINT_EXTRACT_RESPONSE },
      { structuredContent: missingResponseAttr },
    ]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

// ---------------------------------------------------------------------------
// SysON tool failure propagation
// ---------------------------------------------------------------------------

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_extraction_failed when syson_constraint_extract throws",
  async () => {
    const client = stubClient([
      { throw: new Error("SysON unreachable") },
    ]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

Deno.test(
  "extractAndVerifySensitivityEdges raises edge_extraction_failed when syson_element_children throws",
  async () => {
    const client = stubClient([
      { structuredContent: PROBE_CONSTRAINT_EXTRACT_RESPONSE },
      { throw: new Error("SysON unreachable") },
    ]);
    await assertRejects(
      () => extractAndVerifySensitivityEdges(client, "ec", "el", PROBE_EDGES_VALID),
      SensitivityEdgeExtractionError,
    );
  },
);

// ---------------------------------------------------------------------------
// verifyExtractedEdgeBound — unit test of the bound verifier
// ---------------------------------------------------------------------------

Deno.test(
  "verifyExtractedEdgeBound accepts a well-formed lower bound row from probe D",
  () => {
    // No throw expected.
    verifyExtractedEdgeBound(
      PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints[0],
      "assembly_max_displacement_validity_lower",
      ">=",
      "sizeZ_base_assembly_max_displacement",
      29,
      "mm",
    );
  },
);

Deno.test(
  "verifyExtractedEdgeBound accepts a well-formed upper bound row from probe D",
  () => {
    verifyExtractedEdgeBound(
      PROBE_CONSTRAINT_EXTRACT_RESPONSE.constraints[1],
      "assembly_max_displacement_validity_upper",
      "<=",
      "sizeZ_base_assembly_max_displacement",
      31,
      "mm",
    );
  },
);
