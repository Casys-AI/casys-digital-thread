import { assertEquals, assertThrows } from "@std/assert";
import {
  fingerprintSensitivityEdgeSet,
  renderSensitivityEdgeSetSysml,
  SENSITIVITY_EDGE_SCHEMA,
  validateSensitivityEdge,
  validateSensitivityEdgeSet,
} from "./sensitivity-edge.ts";

// ---------------------------------------------------------------------------
// Fixtures — forms observed in sandbox probe (2026-08-05)
// project probe-sensitivity-edge-2026-08-05, deleted after probe.
//
// The probe confirmed via syson_constraint_extract that:
//   - featurePath[0] == driver.sysmlAttrName (NOT "FeatureReferenceExpression")
//   - constraint names are preserved verbatim
//   - attribute names appear in syson_element_children with correct kinds
// ---------------------------------------------------------------------------

/**
 * Displacement sensitivity edge (∂(assembly_max_displacement)/∂(sizeZ)).
 * Driver attr observed as AttributeUsage, response attr as AttributeUsage,
 * constraints as ConstraintUsage in probe D children response.
 */
const DISP_EDGE_VALID: unknown = {
  schemaVersion: SENSITIVITY_EDGE_SCHEMA,
  driver: {
    sysmlAttrName: "sizeZ_for_assembly_max_displacement",
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
  provenance: {
    runId: "sensitivity-artifact-abc123",
    capturedAt: "2026-08-04T11:43:39.000Z",
  },
};

/**
 * Von Mises sensitivity edge (∂(assembly_max_von_mises)/∂(sizeZ)).
 * Units MPa/mm → PressureValue mapping confirmed by probe D.
 */
const VM_EDGE_VALID: unknown = {
  schemaVersion: SENSITIVITY_EDGE_SCHEMA,
  driver: {
    sysmlAttrName: "sizeZ_for_assembly_max_von_mises",
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
  provenance: {
    runId: "sensitivity-artifact-abc123",
    capturedAt: "2026-08-04T11:43:39.000Z",
  },
};

/**
 * Expected SysML output for the two-edge set.
 * Observed equivalent in probe D (project probe-sensitivity-edge-2026-08-05):
 *   - DripTraySensitivityEdges with 8 children: 4 AttributeUsage + 4 ConstraintUsage
 *   - syson_constraint_extract returned 4 constraints with correct featurePaths
 * Edges are sorted by driver.sysmlAttrName alphabetically ("sizeZ_for_assembly_max_displacement"
 * comes before "sizeZ_for_assembly_max_von_mises").
 */
const EXPECTED_SYSML = `part def DripTraySensitivityEdges {
  private import SI::*;
  attribute sizeZ_for_assembly_max_displacement : LengthValue;
  attribute sizeZ_for_assembly_max_von_mises : LengthValue;
  attribute d_assembly_max_displacement_mm_per_mm : DimensionOneValue;
  attribute d_assembly_max_von_mises_MPa_per_mm : PressureValue;
  constraint assembly_max_displacement_validity_lower { sizeZ_for_assembly_max_displacement >= 29 [mm] }
  constraint assembly_max_displacement_validity_upper { sizeZ_for_assembly_max_displacement <= 31 [mm] }
  constraint assembly_max_von_mises_validity_lower { sizeZ_for_assembly_max_von_mises >= 29 [mm] }
  constraint assembly_max_von_mises_validity_upper { sizeZ_for_assembly_max_von_mises <= 31 [mm] }
}`;

// ---------------------------------------------------------------------------
// validateSensitivityEdge — structural validation
// ---------------------------------------------------------------------------

Deno.test("validateSensitivityEdge accepts the displacement edge fixture", () => {
  const edge = validateSensitivityEdge(DISP_EDGE_VALID);
  assertEquals(edge.schemaVersion, SENSITIVITY_EDGE_SCHEMA);
  assertEquals(edge.driver.sysmlAttrName, "sizeZ_for_assembly_max_displacement");
  assertEquals(edge.driver.unit, "mm");
  assertEquals(edge.driver.basePoint.value, 30);
  assertEquals(edge.driver.validityNeighborhood.lower.value, 29);
  assertEquals(edge.driver.validityNeighborhood.upper.value, 31);
  assertEquals(edge.response.metric, "assembly_max_displacement");
  assertEquals(edge.response.sysmlAttrName, "d_assembly_max_displacement_mm_per_mm");
  assertEquals(edge.derivative.value, -0.008018);
  assertEquals(edge.derivative.unit, "mm/mm");
});

Deno.test("validateSensitivityEdge accepts the von Mises edge fixture", () => {
  const edge = validateSensitivityEdge(VM_EDGE_VALID);
  assertEquals(edge.response.unit, "MPa/mm");
  assertEquals(edge.response.sysmlAttrName, "d_assembly_max_von_mises_MPa_per_mm");
  assertEquals(edge.derivative.value, -0.036042);
});

Deno.test("validateSensitivityEdge rejects a missing schemaVersion", () => {
  const bad = { ...(DISP_EDGE_VALID as Record<string, unknown>) };
  delete bad.schemaVersion;
  assertThrows(() => validateSensitivityEdge(bad), Error);
});

Deno.test("validateSensitivityEdge rejects an unknown extra key at root", () => {
  const bad = { ...(DISP_EDGE_VALID as Record<string, unknown>), extra: "oops" };
  assertThrows(() => validateSensitivityEdge(bad), Error);
});

Deno.test("validateSensitivityEdge rejects a driver sysmlAttrName with a hyphen", () => {
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    driver: {
      ...(DISP_EDGE_VALID as Record<string, unknown>).driver as Record<string, unknown>,
      sysmlAttrName: "sizeZ-for-disp",
    },
  };
  assertThrows(() => validateSensitivityEdge(bad), Error, "valid SysML identifier");
});

Deno.test("validateSensitivityEdge rejects an unknown driver unit", () => {
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    driver: {
      ...(DISP_EDGE_VALID as Record<string, unknown>).driver as Record<string, unknown>,
      unit: "m",
    },
  };
  assertThrows(
    () => validateSensitivityEdge(bad),
    Error,
    "no confirmed SysML driver attribute type",
  );
});

Deno.test("validateSensitivityEdge rejects an unknown response unit", () => {
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    response: {
      ...(DISP_EDGE_VALID as Record<string, unknown>).response as Record<
        string,
        unknown
      >,
      unit: "m/m",
    },
    derivative: { value: -0.008, unit: "m/m" },
  };
  assertThrows(
    () => validateSensitivityEdge(bad),
    Error,
    "no confirmed SysML response attribute type",
  );
});

Deno.test("validateSensitivityEdge rejects mismatched derivative and response units", () => {
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    derivative: { value: -0.008, unit: "MPa/mm" }, // mismatch: response is mm/mm
  };
  assertThrows(() => validateSensitivityEdge(bad), Error, "must equal");
});

Deno.test("validateSensitivityEdge rejects validity neighborhood where lower >= upper", () => {
  const driver = (DISP_EDGE_VALID as Record<string, unknown>).driver as Record<
    string,
    unknown
  >;
  const vn = driver.validityNeighborhood as Record<string, unknown>;
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    driver: {
      ...driver,
      validityNeighborhood: {
        ...vn,
        lower: { value: 31, unit: "mm" }, // lower >= upper → invalid
        upper: { value: 29, unit: "mm" },
      },
    },
  };
  assertThrows(() => validateSensitivityEdge(bad), Error);
});

Deno.test("validateSensitivityEdge rejects identical lower and upper constraint names", () => {
  const driver = (DISP_EDGE_VALID as Record<string, unknown>).driver as Record<
    string,
    unknown
  >;
  const vn = driver.validityNeighborhood as Record<string, unknown>;
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    driver: {
      ...driver,
      validityNeighborhood: {
        ...vn,
        lowerConstraintName: "same_name",
        upperConstraintName: "same_name",
      },
    },
  };
  assertThrows(() => validateSensitivityEdge(bad), Error, "must be distinct");
});

Deno.test("validateSensitivityEdge rejects a non-finite derivative value", () => {
  const bad = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    derivative: { value: NaN, unit: "mm/mm" },
  };
  assertThrows(() => validateSensitivityEdge(bad), Error, "finite number");
});

// ---------------------------------------------------------------------------
// validateSensitivityEdgeSet — set-level uniqueness
// ---------------------------------------------------------------------------

Deno.test("validateSensitivityEdgeSet accepts the two-edge fixture set", () => {
  const edges = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
  assertEquals(edges.length, 2);
  assertEquals(edges[0]!.response.metric, "assembly_max_displacement");
  assertEquals(edges[1]!.response.metric, "assembly_max_von_mises");
});

Deno.test("validateSensitivityEdgeSet rejects an empty array", () => {
  assertThrows(() => validateSensitivityEdgeSet([]), Error, "must not be empty");
});

Deno.test("validateSensitivityEdgeSet rejects duplicate driver.sysmlAttrName across edges", () => {
  const duplicated = {
    ...(VM_EDGE_VALID as Record<string, unknown>),
    driver: {
      ...(VM_EDGE_VALID as Record<string, unknown>).driver as Record<string, unknown>,
      sysmlAttrName: "sizeZ_for_assembly_max_displacement", // same as DISP_EDGE_VALID
    },
  };
  assertThrows(
    () => validateSensitivityEdgeSet([DISP_EDGE_VALID, duplicated]),
    Error,
    "must not contain duplicates",
  );
});

Deno.test("validateSensitivityEdgeSet rejects duplicate response.sysmlAttrName across edges", () => {
  // response.unit and derivative.unit must agree; we match the DISP_EDGE_VALID
  // unit ("mm/mm") so validation reaches the duplicate-sysmlAttrName check.
  const duplicated = {
    ...(VM_EDGE_VALID as Record<string, unknown>),
    response: {
      ...(VM_EDGE_VALID as Record<string, unknown>).response as Record<string, unknown>,
      sysmlAttrName: "d_assembly_max_displacement_mm_per_mm", // same as DISP_EDGE_VALID
      unit: "mm/mm", // must equal derivative.unit for validation to proceed past unit check
    },
    derivative: { value: -0.036, unit: "mm/mm" },
  };
  assertThrows(
    () => validateSensitivityEdgeSet([DISP_EDGE_VALID, duplicated]),
    Error,
    "must not contain duplicates",
  );
});

// ---------------------------------------------------------------------------
// renderSensitivityEdgeSetSysml — deterministic output
// ---------------------------------------------------------------------------

Deno.test(
  "renderSensitivityEdgeSetSysml produces the expected SysML for the two-edge fixture",
  () => {
    const edges = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
    const sysml = renderSensitivityEdgeSetSysml("DripTraySensitivityEdges", edges);
    assertEquals(sysml, EXPECTED_SYSML);
  },
);

Deno.test(
  "renderSensitivityEdgeSetSysml is deterministic regardless of input order",
  () => {
    const fwd = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
    const rev = validateSensitivityEdgeSet([VM_EDGE_VALID, DISP_EDGE_VALID]);
    assertEquals(
      renderSensitivityEdgeSetSysml("DripTraySensitivityEdges", fwd),
      renderSensitivityEdgeSetSysml("DripTraySensitivityEdges", rev),
    );
  },
);

Deno.test("renderSensitivityEdgeSetSysml rejects a partDefName with a hyphen", () => {
  const edges = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
  assertThrows(
    () => renderSensitivityEdgeSetSysml("bad-name", edges),
    Error,
    "valid SysML identifier",
  );
});

Deno.test("renderSensitivityEdgeSetSysml rejects an empty edge array", () => {
  assertThrows(
    () => renderSensitivityEdgeSetSysml("AnyName", []),
    Error,
    "must not be empty",
  );
});

// ---------------------------------------------------------------------------
// fingerprintSensitivityEdgeSet — determinism and sensitivity
// ---------------------------------------------------------------------------

Deno.test("fingerprintSensitivityEdgeSet returns a sha256 fingerprint", async () => {
  const edges = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
  const fp = await fingerprintSensitivityEdgeSet(edges);
  assertEquals(fp.algorithm, "sha256");
  assertEquals(fp.digest.length, 64);
});

Deno.test("fingerprintSensitivityEdgeSet is stable for the same inputs", async () => {
  const edges = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
  const fp1 = await fingerprintSensitivityEdgeSet(edges);
  const fp2 = await fingerprintSensitivityEdgeSet(edges);
  assertEquals(fp1.digest, fp2.digest);
});

Deno.test("fingerprintSensitivityEdgeSet differs when derivative value changes", async () => {
  const edges1 = validateSensitivityEdgeSet([DISP_EDGE_VALID, VM_EDGE_VALID]);
  const modified: unknown = {
    ...(DISP_EDGE_VALID as Record<string, unknown>),
    derivative: { value: -0.009999, unit: "mm/mm" },
  };
  const edges2 = validateSensitivityEdgeSet([modified, VM_EDGE_VALID]);
  const fp1 = await fingerprintSensitivityEdgeSet(edges1);
  const fp2 = await fingerprintSensitivityEdgeSet(edges2);
  assertEquals(fp1.digest !== fp2.digest, true);
});
