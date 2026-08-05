import { assertEquals, assertThrows } from "@std/assert";
import { validatePrintabilityCheckCase } from "../../domain/printability-case.ts";
import {
  createThreadSnapshot,
  validateThreadSnapshot,
} from "../../domain/thread-snapshot-validation.ts";
import { FileCm01DripTrayPrintabilityAttemptStore } from "../file-cm01-drip-tray-printability-attempt-store.ts";
import {
  materializePrintabilitySnapshot,
  parseBuild123dStepExport,
  parseDfmOverhangResult,
  parseDfmThicknessResult,
  type PrintabilityCaptureRecord,
} from "./coffee-machine-cm01-v3-printability-run-executor.ts";

const AT = "2026-08-05T10:00:00.000Z";
const CAPTURE_FP = { algorithm: "sha256" as const, digest: "c".repeat(64) };
const STEP_SHA = "e".repeat(64);
const STEP_SHA_OTHER = "f".repeat(64);

// ── Test 1 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintabilitySnapshot happy path produces a validateThreadSnapshot-passing snapshot",
  async () => {
    const record = captureRecord([]);
    const { snapshot } = await materializePrintabilitySnapshot(
      baseThreadSnapshot(),
      "run-printability-happy",
      validCase(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-printability-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    // Must not throw — validates provenance, observation invariants, etc.
    validateThreadSnapshot(snapshot);
  },
);

// ── Test 2 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintabilitySnapshot with not_checked items adds a count observation and still passes validateThreadSnapshot",
  async () => {
    const record = captureRecord(["bridging", "warping"]);
    const { snapshot } = await materializePrintabilitySnapshot(
      baseThreadSnapshot(),
      "run-printability-not-checked",
      validCase(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-printability-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    const countObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_printability_not_checked_count",
    );
    assertEquals(
      countObs?.quantity.value,
      2,
      "not_checked count must reflect the items list length",
    );
    assertEquals(countObs?.quantity.unit, "1");
  },
);

// ── Test 3 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintabilitySnapshot records three metric observations with the correct units",
  async () => {
    const record = captureRecord([]);
    const { snapshot } = await materializePrintabilitySnapshot(
      baseThreadSnapshot(),
      "run-printability-units",
      validCase(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-printability-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    const thicknessObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_min_wall_thickness_mm",
    );
    assertEquals(thicknessObs?.quantity.unit, "mm");
    assertEquals(
      thicknessObs?.quantity.value,
      record.thickness.measured.minThicknessMm,
    );
    const overhangAreaObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_overhang_area_mm2",
    );
    assertEquals(overhangAreaObs?.quantity.unit, "mm2");
    assertEquals(
      overhangAreaObs?.quantity.value,
      record.overhang.measured.overhangAreaMm2,
    );
    const totalAreaObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_total_surface_area_mm2",
    );
    assertEquals(totalAreaObs?.quantity.unit, "mm2");
    assertEquals(
      totalAreaObs?.quantity.value,
      record.overhang.measured.totalSurfaceAreaMm2,
    );
  },
);

// ── Test 3b ───────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintabilitySnapshot with DFM violations adds a violation count observation",
  async () => {
    const record = captureRecordWithViolations([
      { area_mm2: 14.5, centroid_mm: [0, 0, 0] },
      { area_mm2: 3.2, centroid_mm: [10, 0, 0] },
    ]);
    const { snapshot } = await materializePrintabilitySnapshot(
      baseThreadSnapshot(),
      "run-printability-violations",
      validCase(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-printability-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    const violationCountObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_dfm_violation_count",
    );
    assertEquals(
      violationCountObs?.quantity.value,
      2,
      "violation count must reflect the number of dfm violations",
    );
    assertEquals(violationCountObs?.quantity.unit, "1");
    // Must never appear in thread evaluations, requirements, or violations.
    assertEquals(snapshot.evaluations.length, 0);
    assertEquals(snapshot.requirements.length, 0);
    assertEquals(snapshot.violations.length, 0);
  },
);

// ── Test 4 ────────────────────────────────────────────────────────────────────

Deno.test(
  "completed WAL entry causes begin() to return action:completed, skipping provider dispatch",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const store = new FileCm01DripTrayPrintabilityAttemptStore(dir);
      const caseDigest = "d".repeat(64);
      const first = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-printability-skip",
        caseDigest,
        dispatchedAt: AT,
      });
      assertEquals(first.action, "dispatch");
      await store.complete({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-printability-skip",
        caseDigest,
        dispatchedAt: AT,
        completedAt: "2026-08-05T10:01:00.000Z",
        captureFingerprint: CAPTURE_FP,
      });
      const second = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-printability-skip",
        caseDigest,
        dispatchedAt: "2026-08-05T11:00:00.000Z",
      });
      assertEquals(second, {
        action: "completed",
        captureFingerprint: CAPTURE_FP,
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// ── Test 5 ────────────────────────────────────────────────────────────────────

Deno.test(
  "parseBuild123dStepExport rejects a response that does not contain the expected export name",
  () => {
    assertThrows(
      () =>
        parseBuild123dStepExport(
          {
            schemaVersion: "1.0",
            kind: "export",
            files: [{
              format: "step",
              path: "/exports/wrong-name.step",
              bytes: 100,
              sha256: STEP_SHA,
            }],
          },
          "coffee-machine-cm01-v3-drip-tray-printability",
        ),
      Error,
      "expected export name",
    );
  },
);

Deno.test("parseBuild123dStepExport rejects a null structuredContent", () => {
  assertThrows(
    () => parseBuild123dStepExport(null, "any-name"),
    TypeError,
    "object",
  );
});

Deno.test("parseBuild123dStepExport rejects an stl format instead of step", () => {
  const exportName = "coffee-machine-cm01-v3-drip-tray-printability";
  assertThrows(
    () =>
      parseBuild123dStepExport(
        {
          schemaVersion: "1.0",
          kind: "export",
          files: [{
            format: "stl",
            path: `/exports/${exportName}.stl`,
            bytes: 1024,
            sha256: STEP_SHA,
          }],
        },
        exportName,
      ),
    Error,
    "expected export name",
  );
});

Deno.test("parseBuild123dStepExport accepts a valid STEP export response", () => {
  const exportName = "coffee-machine-cm01-v3-drip-tray-printability";
  const result = parseBuild123dStepExport(
    {
      schemaVersion: "1.0",
      kind: "export",
      files: [{
        format: "step",
        path: `/exports/${exportName}.step`,
        bytes: 1024,
        sha256: STEP_SHA,
      }],
    },
    exportName,
  );
  assertEquals(result.sha256, STEP_SHA);
  assertEquals(result.bytes, 1024);
});

// ── Test 6 ────────────────────────────────────────────────────────────────────

Deno.test("parseDfmThicknessResult rejects a missing violations array", () => {
  assertThrows(
    () =>
      parseDfmThicknessResult(
        {
          measured: validThicknessMeasured(),
          limits_declared: { min_thickness_mm: 1.2 },
          not_checked: [],
          input_artifact: {
            sha256: STEP_SHA,
            bytes: 1024,
            source_path: "/exports/x.step",
          },
        },
        STEP_SHA,
      ),
    Error,
    "violations must be an array",
  );
});

Deno.test(
  "parseDfmThicknessResult rejects a missing not_checked array",
  () => {
    assertThrows(
      () =>
        parseDfmThicknessResult(
          {
            violations: [],
            measured: validThicknessMeasured(),
            limits_declared: { min_thickness_mm: 1.2 },
            input_artifact: {
              sha256: STEP_SHA,
              bytes: 1024,
              source_path: "/exports/x.step",
            },
          },
          STEP_SHA,
        ),
      Error,
      "not_checked must be an array",
    );
  },
);

Deno.test("parseDfmThicknessResult rejects a missing measured object", () => {
  assertThrows(
    () =>
      parseDfmThicknessResult(
        {
          violations: [],
          limits_declared: { min_thickness_mm: 1.2 },
          not_checked: [],
          input_artifact: {
            sha256: STEP_SHA,
            bytes: 1024,
            source_path: "/exports/x.step",
          },
        },
        STEP_SHA,
      ),
    TypeError,
    "measured",
  );
});

Deno.test(
  "parseDfmThicknessResult rejects input_artifact.sha256 mismatch",
  () => {
    assertThrows(
      () =>
        parseDfmThicknessResult(
          {
            violations: [],
            measured: validThicknessMeasured(),
            limits_declared: { min_thickness_mm: 1.2 },
            not_checked: [],
            input_artifact: {
              sha256: STEP_SHA_OTHER,
              bytes: 1024,
              source_path: "/exports/x.step",
            },
          },
          STEP_SHA,
        ),
      Error,
      "mismatch",
    );
  },
);

Deno.test("parseDfmThicknessResult accepts a valid thickness result", () => {
  const result = parseDfmThicknessResult(
    {
      violations: [],
      measured: validThicknessMeasured(),
      limits_declared: { min_thickness_mm: 1.2 },
      not_checked: ["bridging"],
      input_artifact: { sha256: STEP_SHA, bytes: 1024, source_path: "/exports/x.step" },
    },
    STEP_SHA,
  );
  assertEquals(result.measured.minThicknessMm, 29.999);
  assertEquals(result.notChecked, ["bridging"]);
  assertEquals(result.inputArtifactSha256, STEP_SHA);
  assertEquals(result.violations, []);
});

// ── Test 7 ────────────────────────────────────────────────────────────────────

Deno.test("parseDfmOverhangResult rejects a missing violations array", () => {
  assertThrows(
    () =>
      parseDfmOverhangResult(
        {
          measured: validOverhangMeasured(),
          limits_declared: { max_overhang_deg: 45 },
          not_checked: [],
          input_artifact: {
            sha256: STEP_SHA,
            bytes: 1024,
            source_path: "/exports/x.step",
          },
        },
        STEP_SHA,
      ),
    Error,
    "violations must be an array",
  );
});

Deno.test(
  "parseDfmOverhangResult rejects a missing not_checked array",
  () => {
    assertThrows(
      () =>
        parseDfmOverhangResult(
          {
            violations: [],
            measured: validOverhangMeasured(),
            limits_declared: { max_overhang_deg: 45 },
            input_artifact: {
              sha256: STEP_SHA,
              bytes: 1024,
              source_path: "/exports/x.step",
            },
          },
          STEP_SHA,
        ),
      Error,
      "not_checked must be an array",
    );
  },
);

Deno.test("parseDfmOverhangResult rejects input_artifact.sha256 mismatch", () => {
  assertThrows(
    () =>
      parseDfmOverhangResult(
        {
          violations: [],
          measured: validOverhangMeasured(),
          limits_declared: { max_overhang_deg: 45 },
          not_checked: [],
          input_artifact: {
            sha256: STEP_SHA_OTHER,
            bytes: 1024,
            source_path: "/exports/x.step",
          },
        },
        STEP_SHA,
      ),
    Error,
    "mismatch",
  );
});

Deno.test("parseDfmOverhangResult accepts a valid overhang result", () => {
  const result = parseDfmOverhangResult(
    {
      violations: [],
      measured: validOverhangMeasured(),
      limits_declared: { max_overhang_deg: 45 },
      not_checked: [],
      input_artifact: { sha256: STEP_SHA, bytes: 1024, source_path: "/exports/x.step" },
    },
    STEP_SHA,
  );
  assertEquals(result.measured.overhangAreaMm2, 420.5);
  assertEquals(result.measured.totalSurfaceAreaMm2, 102300.0);
  assertEquals(result.notChecked, []);
  assertEquals(result.inputArtifactSha256, STEP_SHA);
  assertEquals(result.violations, []);
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validCase() {
  return validatePrintabilityCheckCase({
    schemaVersion: "printability-check-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-fdm-v1",
    revision: 2,
    scope: "FDM printability check for the isolated CM-01 DripTray.",
    evidenceBoundary: "Observations only; not a verdict or certification.",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    target: { componentKey: "drip-tray" },
    thresholds: {
      minWallThicknessMm: { value: 1.2, unit: "mm" },
      maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
      maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
    },
    meshSizeMm: { value: 2.0, unit: "mm" },
    buildDirection: [0, 0, 1],
    provider: {
      build123dTool: "build123d_export",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: [
      "Thresholds are provisional FDM candidate values, not confirmed manufacturer data.",
      "This check covers only min wall thickness and max overhang angle.",
    ],
    provenance: {
      status: "provisional",
      note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
    },
  });
}

function captureRecord(
  allNotChecked: string[],
): PrintabilityCaptureRecord {
  return {
    schemaVersion: "printability-check-capture/2.0",
    caseId: "coffee-machine-cm01-v3-drip-tray-fdm-v1",
    caseRevision: 2,
    caseDigest: "d".repeat(64),
    capturedAt: AT,
    step: {
      exportName: "coffee-machine-cm01-v3-drip-tray-printability",
      stepPath: "/exports/coffee-machine-cm01-v3-drip-tray-printability.step",
      stepSha256: STEP_SHA,
      stepBytes: 8192,
    },
    callParams: {
      meshSizeMm: 2.0,
      buildDirection: [0, 0, 1],
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: {
        minThicknessMm: 29.999999999999993,
        minPositionMm: [0.0, 0.0, 15.0],
        sampleCount: 1200,
        validRayCount: 1150,
      },
      violations: [],
      notChecked: allNotChecked.slice(0, 1),
      inputArtifactSha256: STEP_SHA,
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: {
        totalSurfaceAreaMm2: 102300.0,
        overhangAreaMm2: 420.5,
        overhangTriangleCount: 42,
        totalTriangleCount: 10230,
      },
      violations: [],
      notChecked: allNotChecked.slice(1),
      inputArtifactSha256: STEP_SHA,
    },
    limitations: [
      "Thresholds are provisional FDM candidate values, not confirmed manufacturer data.",
      "This check covers only min wall thickness and max overhang angle.",
    ],
  };
}

function captureRecordWithViolations(
  thicknessViolations: { area_mm2: number; centroid_mm: number[] }[],
): PrintabilityCaptureRecord {
  return {
    ...captureRecord([]),
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: {
        minThicknessMm: 0.8,
        minPositionMm: [0.0, 0.0, 0.0],
        sampleCount: 1200,
        validRayCount: 1150,
      },
      violations: thicknessViolations,
      notChecked: [],
      inputArtifactSha256: STEP_SHA,
    },
  };
}

function validThicknessMeasured() {
  return {
    min_thickness_mm: 29.999,
    min_position_mm: [0.0, 0.0, 15.0],
    sample_count: 1200,
    valid_ray_count: 1150,
  };
}

function validOverhangMeasured() {
  return {
    total_surface_area_mm2: 102300.0,
    overhang_area_mm2: 420.5,
    overhang_triangle_count: 42,
    total_triangle_count: 10230,
  };
}

function baseThreadSnapshot() {
  const at = "2026-08-05T09:00:00.000Z";
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return createThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r1:printability-test-base",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      kind: "system",
      version: "test",
      modelArtifactId: "test-model",
    },
    freshness: {
      status: "fresh" as const,
      changedAt: at,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "test-printability-base",
      name: "Test printability baseline",
      status: "applied" as const,
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "test-model-printability-created",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: "test-model" },
        summary: "Create test model for printability executor test.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: "test-model",
      name: "Test CM-01 SysML model",
      kind: "sysml-model" as const,
      version: "test",
      fingerprint,
      producer: { serverId: "syson", tool: "test", runId: "test" },
      inputArtifactIds: [],
      freshness: {
        status: "fresh" as const,
        changedAt: at,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "test-model-printability-change",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "test-model-printability-created" },
      to: { kind: "artifact" as const, id: "test-model" },
      rationale: "Test baseline created the SysML model artifact.",
    }],
    proposedActions: [],
  });
}
