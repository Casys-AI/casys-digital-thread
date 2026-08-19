import { assertEquals, assertThrows } from "@std/assert";
import { SENSITIVITY_EDGE_SCHEMA } from "../../../domain/sensitivity/edges/sensitivity-edge.ts";
import {
  SENSITIVITY_EDGES_CAPTURE_SCHEMA,
  validateSensitivityEdgesCapture,
} from "./sensitivity-edges-capture.ts";

const EDGE_VALID = {
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

const CAPTURE_VALID = {
  schemaVersion: SENSITIVITY_EDGES_CAPTURE_SCHEMA,
  operation: { id: "model.write-sensitivity-edges", version: "1" },
  trustedRunId: "run:cmd-example",
  studyCaptureId: "sensitivity-study-abc",
  partDefName: "LampSensitivityEdges",
  sysml: "part def LampSensitivityEdges {}",
  edges: [EDGE_VALID],
  capturedAt: "2026-08-14T22:00:00.000Z",
};

Deno.test("a sensitivity-edges capture round-trips through its fail-closed validator", () => {
  const parsed = validateSensitivityEdgesCapture(CAPTURE_VALID);
  assertEquals(parsed.edges.length, 1);
  assertEquals(parsed.partDefName, "LampSensitivityEdges");
});

Deno.test("a sensitivity-edges capture with an extra root key is rejected", () => {
  assertThrows(() =>
    validateSensitivityEdgesCapture({ ...CAPTURE_VALID, verdict: "pass" })
  );
});

Deno.test("a sensitivity-edges capture missing its edges is rejected", () => {
  const { edges: _edges, ...withoutEdges } = CAPTURE_VALID;
  assertThrows(() => validateSensitivityEdgesCapture(withoutEdges));
  assertThrows(() => validateSensitivityEdgesCapture({ ...CAPTURE_VALID, edges: [] }));
});

Deno.test("a sensitivity-edges capture for another operation identity is rejected", () => {
  assertThrows(() =>
    validateSensitivityEdgesCapture({
      ...CAPTURE_VALID,
      operation: { id: "model.write-architecture", version: "1" },
    })
  );
});

Deno.test("a sensitivity-edges capture with a non-canonical instant is rejected", () => {
  assertThrows(() =>
    validateSensitivityEdgesCapture({
      ...CAPTURE_VALID,
      capturedAt: "2026-08-14 22:00:00",
    })
  );
});
