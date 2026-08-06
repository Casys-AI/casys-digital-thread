import { assertEquals, assertThrows } from "@std/assert";
import {
  fingerprintSensitivityRelations,
  renderSensitivityRelationsSysml,
  SENSITIVITY_RELATIONS_SCHEMA,
  type SensitivityRelationsDeclaration,
  validateSensitivityRelationsDeclaration,
} from "./sensitivity-relations.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_VALID: unknown = {
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

const EXPECTED_SYSML = `part def DripTraySensitivityRelations {
  private import SI::*;
  attribute sizeZ_base_mm : LengthValue;
  attribute sizeZ_step_mm : LengthValue;
  attribute dDisplacementDSizeZ_mm_per_mm : DimensionOneValue;
  attribute dVonMisesDSizeZ_MPa_per_mm : PressureValue;
  constraint sizeZ_validity_lower { sizeZ_base_mm >= 29 [mm] }
  constraint sizeZ_validity_upper { sizeZ_base_mm <= 31 [mm] }
}`;

// ---------------------------------------------------------------------------
// validateSensitivityRelationsDeclaration — structural validation
// ---------------------------------------------------------------------------

Deno.test("validateSensitivityRelationsDeclaration accepts a minimal valid declaration", () => {
  const result = validateSensitivityRelationsDeclaration(MINIMAL_VALID);
  assertEquals(result.schemaVersion, SENSITIVITY_RELATIONS_SCHEMA);
  assertEquals(result.paramAttrs.length, 2);
  assertEquals(result.derivativeAttrs.length, 2);
  assertEquals(result.validityBounds.length, 2);
  assertEquals(result.runId, "run-2026-08-04");
});

Deno.test("validateSensitivityRelationsDeclaration rejects a missing unit on paramAttr", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    paramAttrs: [{ attrName: "sizeZ_base_mm" }], // unit missing
    derivativeAttrs: [],
    validityBounds: [],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects an unknown unit on derivativeAttr", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    derivativeAttrs: [
      { attrName: "dSomething", unit: "kg/mm" }, // "kg/mm" not in derivative map
    ],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "kg/mm",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects an extra key on the root", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    unexpectedKey: "should-be-rejected",
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "unexpectedKey",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects duplicate attribute names", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    paramAttrs: [
      { attrName: "sizeZ_base_mm", unit: "mm" },
      { attrName: "sizeZ_base_mm", unit: "mm" }, // duplicate
    ],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "duplicates",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects a param and derivative sharing the same attrName", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    paramAttrs: [{ attrName: "sharedName", unit: "mm" }],
    derivativeAttrs: [{ attrName: "sharedName", unit: "mm/mm" }],
    validityBounds: [{
      constraintName: "c1",
      paramAttrName: "sharedName",
      operator: ">=",
      boundValue: 1,
      boundUnit: "mm",
    }],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "duplicates",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects a bound that references an undeclared paramAttrName", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    validityBounds: [
      {
        constraintName: "bad_ref",
        paramAttrName: "undeclared_attr",
        operator: ">=",
        boundValue: 1,
        boundUnit: "mm",
      },
    ],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "not declared in paramAttrs",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects an unknown bound unit", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    validityBounds: [
      {
        constraintName: "bad_unit",
        paramAttrName: "sizeZ_base_mm",
        operator: ">=",
        boundValue: 1,
        boundUnit: "kg", // not a confirmed param unit
      },
    ],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "kg",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects a non-ISO capturedAt", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    capturedAt: "not-a-date",
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "ISO timestamp",
  );
});

Deno.test("validateSensitivityRelationsDeclaration rejects an invalid SysML identifier in attrName", () => {
  const bad = {
    ...(MINIMAL_VALID as Record<string, unknown>),
    paramAttrs: [{ attrName: "has-hyphen", unit: "mm" }],
    validityBounds: [{
      constraintName: "c1",
      paramAttrName: "has-hyphen",
      operator: ">=",
      boundValue: 1,
      boundUnit: "mm",
    }],
  };
  assertThrows(
    () => validateSensitivityRelationsDeclaration(bad),
    Error,
    "valid SysML identifier",
  );
});

// ---------------------------------------------------------------------------
// renderSensitivityRelationsSysml — determinism and output shape
// ---------------------------------------------------------------------------

Deno.test("renderSensitivityRelationsSysml produces the expected canonical SysML text", () => {
  const decl = validateSensitivityRelationsDeclaration(MINIMAL_VALID);
  const sysml = renderSensitivityRelationsSysml("DripTraySensitivityRelations", decl);
  assertEquals(sysml, EXPECTED_SYSML);
});

Deno.test("renderSensitivityRelationsSysml is deterministic: same inputs produce identical bytes", () => {
  const decl = validateSensitivityRelationsDeclaration(MINIMAL_VALID);
  const first = renderSensitivityRelationsSysml("DripTraySensitivityRelations", decl);
  const second = renderSensitivityRelationsSysml("DripTraySensitivityRelations", decl);
  assertEquals(first, second);
});

Deno.test("renderSensitivityRelationsSysml sorts attributes and bounds alphabetically", () => {
  // Provide inputs in reverse alphabetical order; output must be sorted.
  const declValue: unknown = {
    schemaVersion: SENSITIVITY_RELATIONS_SCHEMA,
    paramAttrs: [
      { attrName: "sizeZ_step_mm", unit: "mm" }, // 'z' comes after 'b' alphabetically
      { attrName: "sizeZ_base_mm", unit: "mm" },
    ],
    derivativeAttrs: [
      { attrName: "dVonMisesDSizeZ_MPa_per_mm", unit: "MPa/mm" }, // 'V' after 'D'
      { attrName: "dDisplacementDSizeZ_mm_per_mm", unit: "mm/mm" },
    ],
    validityBounds: [
      {
        constraintName: "sizeZ_validity_upper",
        paramAttrName: "sizeZ_base_mm",
        operator: "<=",
        boundValue: 31,
        boundUnit: "mm",
      },
      {
        constraintName: "sizeZ_validity_lower",
        paramAttrName: "sizeZ_base_mm",
        operator: ">=",
        boundValue: 29,
        boundUnit: "mm",
      },
    ],
    runId: "run-2026-08-04",
    capturedAt: "2026-08-04T11:43:39.000Z",
  };
  const decl = validateSensitivityRelationsDeclaration(declValue);
  const sysml = renderSensitivityRelationsSysml("DripTraySensitivityRelations", decl);
  assertEquals(sysml, EXPECTED_SYSML);
});

Deno.test("renderSensitivityRelationsSysml rejects an invalid partDefName", () => {
  const decl = validateSensitivityRelationsDeclaration(MINIMAL_VALID);
  assertThrows(
    () => renderSensitivityRelationsSysml("has-hyphen", decl),
    Error,
    "valid SysML identifier",
  );
});

// ---------------------------------------------------------------------------
// fingerprintSensitivityRelations — stability
// ---------------------------------------------------------------------------

Deno.test(
  "fingerprintSensitivityRelations produces a stable sha256 hex digest",
  async () => {
    const decl = validateSensitivityRelationsDeclaration(
      MINIMAL_VALID,
    ) as SensitivityRelationsDeclaration;
    const fp = await fingerprintSensitivityRelations(decl);
    assertEquals(fp.algorithm, "sha256");
    assertEquals(fp.digest.length, 64);
    // Second call must produce the same digest.
    const fp2 = await fingerprintSensitivityRelations(decl);
    assertEquals(fp.digest, fp2.digest);
  },
);
