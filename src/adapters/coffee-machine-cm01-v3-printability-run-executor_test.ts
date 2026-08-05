import { assertEquals, assertThrows } from "@std/assert";
import { validatePrintabilityCheckCase } from "../domain/printability-case.ts";
import {
  createThreadSnapshot,
  validateThreadSnapshot,
} from "../domain/thread-snapshot-validation.ts";
import { FileCm01DripTrayPrintabilityAttemptStore } from "./file-cm01-drip-tray-printability-attempt-store.ts";
import {
  materializePrintabilitySnapshot,
  parseBuild123dStlExport,
  parseDfmOverhangResult,
  parseDfmThicknessResult,
  type PrintabilityCaptureRecord,
} from "./coffee-machine-cm01-v3-printability-run-executor.ts";

const AT = "2026-08-05T10:00:00.000Z";
const CAPTURE_FP = { algorithm: "sha256" as const, digest: "c".repeat(64) };
const STL_SHA = "e".repeat(64);

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
    assertEquals(thicknessObs?.quantity.value, record.thickness.minThicknessMm);
    const angleObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_max_overhang_angle_deg",
    );
    assertEquals(angleObs?.quantity.unit, "deg");
    const areaObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_max_unsupported_area_mm2",
    );
    assertEquals(areaObs?.quantity.unit, "mm2");
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
  "parseBuild123dStlExport rejects a response that does not contain the expected export name",
  () => {
    assertThrows(
      () =>
        parseBuild123dStlExport(
          {
            schemaVersion: "1.0",
            kind: "export",
            files: [{
              format: "stl",
              path: "/exports/wrong-name.stl",
              bytes: 100,
              sha256: STL_SHA,
            }],
          },
          "coffee-machine-cm01-v3-drip-tray-printability",
        ),
      Error,
      "expected export name",
    );
  },
);

Deno.test("parseBuild123dStlExport rejects a null structuredContent", () => {
  assertThrows(
    () => parseBuild123dStlExport(null, "any-name"),
    TypeError,
    "object",
  );
});

Deno.test("parseBuild123dStlExport accepts a valid STL export response", () => {
  const exportName = "coffee-machine-cm01-v3-drip-tray-printability";
  const result = parseBuild123dStlExport(
    {
      schemaVersion: "1.0",
      kind: "export",
      files: [{
        format: "stl",
        path: `/exports/${exportName}.stl`,
        bytes: 1024,
        sha256: STL_SHA,
      }],
    },
    exportName,
  );
  assertEquals(result.sha256, STL_SHA);
  assertEquals(result.bytes, 1024);
});

// ── Test 6 ────────────────────────────────────────────────────────────────────

Deno.test("parseDfmThicknessResult rejects a wrong kind in the response", () => {
  assertThrows(
    () =>
      parseDfmThicknessResult({
        schemaVersion: "1.0",
        kind: "dfm-overhangs",
        minThicknessMm: 1.5,
        not_checked: [],
      }),
    Error,
    "unsupported contract schema",
  );
});

Deno.test(
  "parseDfmThicknessResult rejects a missing not_checked array",
  () => {
    assertThrows(
      () =>
        parseDfmThicknessResult({
          schemaVersion: "1.0",
          kind: "dfm-min-thickness",
          minThicknessMm: 1.5,
        }),
      Error,
      "not_checked must be an array",
    );
  },
);

Deno.test("parseDfmThicknessResult accepts a valid thickness result", () => {
  const result = parseDfmThicknessResult({
    schemaVersion: "1.0",
    kind: "dfm-min-thickness",
    minThicknessMm: 1.5,
    not_checked: ["bridging"],
  });
  assertEquals(result.minThicknessMm, 1.5);
  assertEquals(result.notChecked, ["bridging"]);
});

// ── Test 7 ────────────────────────────────────────────────────────────────────

Deno.test("parseDfmOverhangResult rejects a wrong kind in the response", () => {
  assertThrows(
    () =>
      parseDfmOverhangResult({
        schemaVersion: "1.0",
        kind: "dfm-min-thickness",
        maxOverhangAngleDeg: 35,
        maxUnsupportedAreaMm2: 400,
        not_checked: [],
      }),
    Error,
    "unsupported contract schema",
  );
});

Deno.test(
  "parseDfmOverhangResult rejects a missing not_checked array",
  () => {
    assertThrows(
      () =>
        parseDfmOverhangResult({
          schemaVersion: "1.0",
          kind: "dfm-overhangs",
          maxOverhangAngleDeg: 35,
          maxUnsupportedAreaMm2: 400,
        }),
      Error,
      "not_checked must be an array",
    );
  },
);

Deno.test("parseDfmOverhangResult accepts a valid overhang result", () => {
  const result = parseDfmOverhangResult({
    schemaVersion: "1.0",
    kind: "dfm-overhangs",
    maxOverhangAngleDeg: 38.5,
    maxUnsupportedAreaMm2: 550.0,
    not_checked: [],
  });
  assertEquals(result.maxOverhangAngleDeg, 38.5);
  assertEquals(result.maxUnsupportedAreaMm2, 550.0);
  assertEquals(result.notChecked, []);
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validCase() {
  return validatePrintabilityCheckCase({
    schemaVersion: "printability-check-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-fdm-v1",
    revision: 1,
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
    schemaVersion: "printability-check-capture/1.0",
    caseId: "coffee-machine-cm01-v3-drip-tray-fdm-v1",
    caseRevision: 1,
    caseDigest: "d".repeat(64),
    capturedAt: AT,
    stl: {
      exportName: "coffee-machine-cm01-v3-drip-tray-printability",
      stlPath: "/exports/coffee-machine-cm01-v3-drip-tray-printability.stl",
      stlSha256: STL_SHA,
      stlBytes: 2048,
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      minThicknessMm: 1.8,
      thresholdMm: 1.2,
      notChecked: allNotChecked.slice(0, 1),
    },
    overhang: {
      tool: "dfm_check_overhangs",
      maxOverhangAngleDeg: 38.0,
      maxUnsupportedAreaMm2: 420.0,
      thresholdAngleDeg: 45.0,
      thresholdAreaMm2: 600.0,
      notChecked: allNotChecked.slice(1),
    },
    limitations: [
      "Thresholds are provisional FDM candidate values, not confirmed manufacturer data.",
      "This check covers only min wall thickness and max overhang angle.",
    ],
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
