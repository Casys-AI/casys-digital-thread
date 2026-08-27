import { assertEquals } from "@std/assert";
import {
  sensitivityEdgesFromStudy,
  sensitivityPartDefName,
} from "./sensitivity-edge-from-study.ts";
import { renderSensitivityEdgeSetSysml } from "./sensitivity-edge.ts";
import { validateSensitivityStudyCaseV2 } from "../study/sensitivity-study-v2.ts";

const STUDY = validateSensitivityStudyCaseV2({
  schemaVersion: "sensitivity-study-case/2.0",
  id: "dl04-size-z-sensitivity",
  revision: 1,
  scope: "mechanical-structural",
  evidenceBoundary: "fea-static",
  project: { id: "desk-lamp-dl04", subjectId: "lamp-arm" },
  target: { componentKey: "arm", semanticKey: "size_z" },
  cadSource: {
    artifactUri: "thread-artifact://desk-lamp-dl04/compile-admission-abc123",
    sha256: "a".repeat(64),
  },
  baseValue: { value: 50, unit: "mm" },
  step: { value: 1, unit: "mm" },
  metrics: [
    { id: "assembly_max_displacement", unit: "mm" },
    { id: "assembly_max_von_mises", unit: "MPa" },
  ],
  solver: {
    provider: "calculix",
    tool: "calculix_solve_static",
    resultSchemaVersion: "2.0",
    mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
    material: {
      model: "isotropic-linear-elastic",
      eMpa: 70000,
      nu: 0.33,
      basis: "dl04-aluminium-reviewed",
    },
    supports: [{
      id: "wall-mount",
      kind: "fixed",
      selection: {
        name: "Wall",
        box: { min: [0, 0, 0], max: [5, 5, 5], unit: "mm" },
      },
    }],
    loads: [{
      id: "tip-load",
      kind: "force",
      selection: {
        name: "Tip",
        box: { min: [10, 10, 10], max: [15, 15, 15], unit: "mm" },
      },
      force: { value: [0, 0, -10], unit: "N" },
    }],
  },
  domain: {
    approximationOrder: "first-order-forward",
    remeshingVariationIncluded: true,
    localValidityNote: "Valid for size_z in [50, 51] mm.",
    limitations: ["Remeshing variation is included."],
  },
});

Deno.test(
  "sensitivityEdgesFromStudy derives validity neighborhood from base and step only",
  () => {
    const edges = sensitivityEdgesFromStudy(
      STUDY,
      new Map([
        ["assembly_max_displacement", { value: 0.5, unit: "mm" }],
        ["assembly_max_von_mises", { value: 10, unit: "MPa" }],
      ]),
      new Map([
        ["assembly_max_displacement", { value: 1.5, unit: "mm" }],
        ["assembly_max_von_mises", { value: 8, unit: "MPa" }],
      ]),
      { runId: "run:study", capturedAt: "2026-08-14T00:00:00.000Z" },
    );
    assertEquals(edges[0]?.driver.validityNeighborhood.lower, {
      value: 50,
      unit: "mm",
    });
    assertEquals(edges[0]?.driver.validityNeighborhood.upper, {
      value: 51,
      unit: "mm",
    });
  },
);

Deno.test(
  "sensitivityEdgesFromStudy uses server-fixed SysML names and never agent text",
  () => {
    const edges = sensitivityEdgesFromStudy(
      STUDY,
      new Map([
        ["assembly_max_displacement", { value: 0.5, unit: "mm" }],
        ["assembly_max_von_mises", { value: 10, unit: "MPa" }],
      ]),
      new Map([
        ["assembly_max_displacement", { value: 1.5, unit: "mm" }],
        ["assembly_max_von_mises", { value: 8, unit: "MPa" }],
      ]),
      { runId: "run:study", capturedAt: "2026-08-14T00:00:00.000Z" },
    );
    assertEquals(
      edges.map((edge) => edge.driver.sysmlAttrName).sort(),
      [
        "sizeZ_for_assembly_max_displacement",
        "sizeZ_for_assembly_max_von_mises",
      ],
    );
    assertEquals(
      edges.map((edge) => edge.response.sysmlAttrName).sort(),
      [
        "d_assembly_max_displacement_mm_per_mm",
        "d_assembly_max_von_mises_MPa_per_mm",
      ],
    );
    const sysml = renderSensitivityEdgeSetSysml(
      sensitivityPartDefName(STUDY.id),
      edges,
    );
    assertEquals(sysml.includes("part def Dl04SizeZSensitivityEdges"), true);
    assertEquals(sysml.includes("agent"), false);
  },
);
