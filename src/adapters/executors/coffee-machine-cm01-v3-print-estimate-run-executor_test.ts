/**
 * Tests for the CM-01 DripTray FFF print-estimate executor — isolated to pure
 * parsing, materialisation, and WAL behaviour without live providers.
 *
 * Fixture values come from the live probe conducted 2026-08-05:
 *   - DripTray STL sha256  : cf442050dbe461456f72a9fc0f46393d86b1a3c3a0c5ed79e517fa538dd9c0c8
 *   - Committed profile sha256 : 15856bc88409c4130da6b700e95c86a0b232a879e593fda537a7f6fcfc1ad89f
 *   - print_time_s         : 38188
 *   - filament_length_mm   : 87369.37
 *   - filament_volume_mm3  : 210150
 *   - filament_mass_g      : 260.58  (density 1.24 g/cm³ override)
 *   - not_checked          : 8 items
 *
 * The tests verify:
 *   1. materializePrintEstimateSnapshot → validateThreadSnapshot
 *   2. Observations carry explicit units; metric names are exact.
 *   3. filament_mass_g observation absent when density is absent from case.
 *   4. not_checked items produce a count observation.
 *   5. No evaluations, requirements, or violations are emitted.
 *   6. WAL: completed attempt causes begin() to skip providers.
 *   7. parseBuild123dStlExport parser contract.
 *   8. parsePrusaslicerEstimateResult parser contract.
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { validatePrintEstimateCase } from "../../domain/analysis/print-estimate-case.ts";
import {
  createThreadSnapshot,
  validateThreadSnapshot,
} from "../../domain/thread-snapshot-validation.ts";
import { FileCm01DripTrayPrintEstimateAttemptStore } from "../wal/file-cm01-drip-tray-print-estimate-attempt-store.ts";
import {
  materializePrintEstimateSnapshot,
  parseBuild123dStlExport,
  parsePrusaslicerEstimateResult,
  type PrintEstimateCaptureRecord,
} from "./coffee-machine-cm01-v3-print-estimate-run-executor.ts";

const AT = "2026-08-05T12:00:00.000Z";
const CAPTURE_FP = { algorithm: "sha256" as const, digest: "c".repeat(64) };

// Real sha256 values from the live probe.
const STL_SHA = "cf442050dbe461456f72a9fc0f46393d86b1a3c3a0c5ed79e517fa538dd9c0c8";
const PROFILE_SHA = "15856bc88409c4130da6b700e95c86a0b232a879e593fda537a7f6fcfc1ad89f";
const GCODE_SHA = "7d336c5d7fdcc1537246146d1ea4cb3bcb8f6b83378e752e9259cc5db571adab";

const STL_SHA_OTHER = "e".repeat(64);
const PROFILE_SHA_OTHER = "a".repeat(64);

// ── Test 1 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintEstimateSnapshot happy path produces a validateThreadSnapshot-passing snapshot",
  () => {
    const record = captureRecord("10h 36m 28s", []);
    const { snapshot } = materializePrintEstimateSnapshot(
      baseThreadSnapshot(),
      "run-print-estimate-happy",
      validCaseWithDensity(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
  },
);

// ── Test 2 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintEstimateSnapshot emits four observations with units when density is declared",
  () => {
    const record = captureRecord("10h 36m 28s", []);
    const { snapshot } = materializePrintEstimateSnapshot(
      baseThreadSnapshot(),
      "run-print-estimate-four-obs",
      validCaseWithDensity(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);

    const printTimeObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_print_time_s",
    );
    assertExists(printTimeObs, "drip_tray_print_time_s observation must exist");
    assertEquals(printTimeObs.quantity.unit, "s");
    assertEquals(printTimeObs.quantity.value, record.estimate.printTimeS);

    const volumeObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_filament_volume_mm3",
    );
    assertExists(volumeObs, "drip_tray_filament_volume_mm3 observation must exist");
    assertEquals(volumeObs.quantity.unit, "mm3");
    assertEquals(volumeObs.quantity.value, record.estimate.filamentVolumeMm3);

    const lengthObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_filament_length_mm",
    );
    assertExists(lengthObs, "drip_tray_filament_length_mm observation must exist");
    assertEquals(lengthObs.quantity.unit, "mm");
    assertEquals(lengthObs.quantity.value, record.estimate.filamentLengthMm);

    const massObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_filament_mass_g",
    );
    assertExists(massObs, "drip_tray_filament_mass_g observation must exist");
    assertEquals(massObs.quantity.unit, "g");
    assertEquals(massObs.quantity.value, record.estimate.filamentMassG);
  },
);

// ── Test 3 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintEstimateSnapshot emits no mass observation when density is absent from case",
  () => {
    const record = captureRecordNoDensity("10h 36m 28s", []);
    const { snapshot } = materializePrintEstimateSnapshot(
      baseThreadSnapshot(),
      "run-print-estimate-no-density",
      validCaseNoDensity(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    const massObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_filament_mass_g",
    );
    assertEquals(massObs, undefined, "mass observation must be absent when no density");
  },
);

// ── Test 4 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintEstimateSnapshot with not_checked items adds a count observation with unit 1",
  () => {
    const record = captureRecord("10h 36m 28s", [
      "Bed adhesion (first-layer adhesion to build plate) is not verified.",
      "Warping risk is not assessed.",
    ]);
    const { snapshot } = materializePrintEstimateSnapshot(
      baseThreadSnapshot(),
      "run-print-estimate-not-checked",
      validCaseWithDensity(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    const countObs = snapshot.observations.find(
      (o) => o.metric === "drip_tray_print_estimate_not_checked_count",
    );
    assertExists(countObs, "not_checked count observation must exist");
    assertEquals(countObs.quantity.value, 2);
    assertEquals(countObs.quantity.unit, "1");
  },
);

// ── Test 5 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializePrintEstimateSnapshot never emits evaluations, requirements, or violations",
  () => {
    const record = captureRecord("10h 36m 28s", []);
    const { snapshot } = materializePrintEstimateSnapshot(
      baseThreadSnapshot(),
      "run-print-estimate-no-verdict",
      validCaseWithDensity(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    assertEquals(
      snapshot.evaluations.length,
      0,
      "no evaluations — not a verification run",
    );
    assertEquals(
      snapshot.requirements.length,
      0,
      "no requirements — not a model-anchor run",
    );
    assertEquals(
      snapshot.violations.length,
      0,
      "no violations — not a verification run",
    );
  },
);

// ── Test 6 ────────────────────────────────────────────────────────────────────

Deno.test(
  "completed WAL entry causes begin() to return action:completed, skipping provider dispatch",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const store = new FileCm01DripTrayPrintEstimateAttemptStore(dir);
      const caseDigest = "d".repeat(64);
      const first = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-print-estimate-skip",
        caseDigest,
        dispatchedAt: AT,
      });
      assertEquals(first.action, "dispatch");
      await store.complete({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-print-estimate-skip",
        caseDigest,
        dispatchedAt: AT,
        completedAt: "2026-08-05T12:01:00.000Z",
        captureFingerprint: CAPTURE_FP,
      });
      const second = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-print-estimate-skip",
        caseDigest,
        dispatchedAt: "2026-08-05T13:00:00.000Z",
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

// ── Test 7 — parseBuild123dStlExport ─────────────────────────────────────────

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
              bytes: 684,
              sha256: STL_SHA,
            }],
          },
          "cm01-drip-tray-print-estimate",
        ),
      Error,
      "expected export name",
    );
  },
);

Deno.test("parseBuild123dStlExport rejects null structuredContent", () => {
  assertThrows(
    () => parseBuild123dStlExport(null, "any-name"),
    TypeError,
    "object",
  );
});

Deno.test("parseBuild123dStlExport rejects step format when stl is expected", () => {
  const exportName = "cm01-drip-tray-print-estimate";
  assertThrows(
    () =>
      parseBuild123dStlExport(
        {
          schemaVersion: "1.0",
          kind: "export",
          files: [{
            format: "step",
            path: `/exports/${exportName}.step`,
            bytes: 8192,
            sha256: STL_SHA,
          }],
        },
        exportName,
      ),
    Error,
    "expected export name",
  );
});

Deno.test("parseBuild123dStlExport accepts a valid STL export response", () => {
  const exportName = "cm01-drip-tray-print-estimate";
  const result = parseBuild123dStlExport(
    {
      schemaVersion: "1.0",
      kind: "export",
      files: [{
        format: "stl",
        path: `/exports/${exportName}.stl`,
        bytes: 684,
        sha256: STL_SHA,
      }],
    },
    exportName,
  );
  assertEquals(result.sha256, STL_SHA);
  assertEquals(result.bytes, 684);
  assertEquals(result.path, `/exports/${exportName}.stl`);
});

// ── Test 8 — parsePrusaslicerEstimateResult ───────────────────────────────────

/**
 * Fixture built from the live probe response observed 2026-08-05 with the
 * committed profile (15856bc8...) and the DripTray probe STL (cf442050...).
 *
 * Density override 1.24 g/cm³ was passed, enabling filament_mass_g in the
 * response. The 8 not_checked items are verbatim from the server contract.
 */
Deno.test(
  "parsePrusaslicerEstimateResult accepts a valid live-contract response with density override",
  () => {
    const result = parsePrusaslicerEstimateResult(
      validPrusaslicerResponse(STL_SHA, PROFILE_SHA),
      STL_SHA,
      PROFILE_SHA,
      true,
    );
    assertEquals(result.printTimeS, 38188);
    assertEquals(result.printTimeNormalMode, "10h 36m 28s");
    assertEquals(result.printTimeSilentMode, null);
    assertEquals(result.filamentLengthMm, 87369.37);
    assertEquals(result.filamentVolumeMm3, 210150);
    assertEquals(result.filamentMassG, 260.58);
    assertEquals(result.gcodeSha256, GCODE_SHA);
    assertEquals(result.notChecked.length, 8);
    assertEquals(result.stlArtifactSha256, STL_SHA);
    assertEquals(result.profileArtifactSha256, PROFILE_SHA);
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult rejects stl_artifact.sha256 mismatch",
  () => {
    assertThrows(
      () =>
        parsePrusaslicerEstimateResult(
          validPrusaslicerResponse(STL_SHA_OTHER, PROFILE_SHA),
          STL_SHA,
          PROFILE_SHA,
          true,
        ),
      Error,
      "mismatch",
    );
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult rejects profile_artifact.sha256 mismatch",
  () => {
    assertThrows(
      () =>
        parsePrusaslicerEstimateResult(
          validPrusaslicerResponse(STL_SHA, PROFILE_SHA_OTHER),
          STL_SHA,
          PROFILE_SHA,
          true,
        ),
      Error,
      "mismatch",
    );
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult rejects a response missing the not_checked array",
  () => {
    const resp = { ...validPrusaslicerResponse(STL_SHA, PROFILE_SHA) };
    delete (resp as Record<string, unknown>).not_checked;
    assertThrows(
      () => parsePrusaslicerEstimateResult(resp, STL_SHA, PROFILE_SHA, true),
      Error,
      "not_checked must be an array",
    );
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult rejects absent filament_mass_g when density is declared",
  () => {
    const resp = { ...validPrusaslicerResponse(STL_SHA, PROFILE_SHA) };
    delete (resp as Record<string, unknown>).filament_mass_g;
    assertThrows(
      () => parsePrusaslicerEstimateResult(resp, STL_SHA, PROFILE_SHA, true),
      Error,
      "absent",
    );
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult omits filamentMassG when density is not declared",
  () => {
    const resp = { ...validPrusaslicerResponse(STL_SHA, PROFILE_SHA) };
    delete (resp as Record<string, unknown>).filament_mass_g;
    const result = parsePrusaslicerEstimateResult(
      resp,
      STL_SHA,
      PROFILE_SHA,
      false,
    );
    assertEquals(result.filamentMassG, undefined);
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult rejects negative filament_length_mm",
  () => {
    const resp = {
      ...validPrusaslicerResponse(STL_SHA, PROFILE_SHA),
      filament_length_mm: -1,
    };
    assertThrows(
      () => parsePrusaslicerEstimateResult(resp, STL_SHA, PROFILE_SHA, true),
      TypeError,
      "non-negative",
    );
  },
);

Deno.test(
  "parsePrusaslicerEstimateResult rejects negative filament_volume_mm3",
  () => {
    const resp = {
      ...validPrusaslicerResponse(STL_SHA, PROFILE_SHA),
      filament_volume_mm3: -0.001,
    };
    assertThrows(
      () => parsePrusaslicerEstimateResult(resp, STL_SHA, PROFILE_SHA, true),
      TypeError,
      "non-negative",
    );
  },
);

Deno.test(
  "materializePrintEstimateSnapshot throws when capture has filamentMassG but case declares no density",
  () => {
    // Build a capture record that includes filamentMassG (as would be written
    // by a code path that called the slicer with density) but paired with a
    // case that declares no filamentDensityGCm3. This is an integrity violation.
    const record = captureRecord("10h 36m 28s", []);
    assertThrows(
      () =>
        materializePrintEstimateSnapshot(
          baseThreadSnapshot(),
          "run-print-estimate-integrity-check",
          validCaseNoDensity(), // no density in case
          CAPTURE_FP,
          `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
          record, // but record has filamentMassG
        ),
      Error,
      "inconsistent",
    );
  },
);

Deno.test(
  "materializePrintEstimateSnapshot STL artifact uses mesh kind not step",
  () => {
    const record = captureRecord("10h 36m 28s", []);
    const { snapshot } = materializePrintEstimateSnapshot(
      baseThreadSnapshot(),
      "run-print-estimate-artifact-kind",
      validCaseWithDensity(),
      CAPTURE_FP,
      `casys://cm01-drip-tray-print-estimate-capture/sha256/${"c".repeat(64)}`,
      record,
    );
    validateThreadSnapshot(snapshot);
    const stlArtifact = snapshot.artifacts.find((a) => a.name.includes("STL"));
    assertExists(stlArtifact, "STL artifact must exist in snapshot");
    assertEquals(
      stlArtifact.kind,
      "mesh",
      "STL is a triangular-mesh format — kind must be mesh, not step",
    );
  },
);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validCaseWithDensity() {
  return validatePrintEstimateCase({
    schemaVersion: "print-estimate-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-fff-v1",
    revision: 1,
    scope:
      "FFF print-time-and-material estimate for the isolated CM-01 DripTray STL at the reviewed 30 mm R2 geometry.",
    evidenceBoundary:
      "Observations only — not a verdict, cost estimate, certification, or manufacturing approval.",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    target: { componentKey: "drip-tray" },
    profile: {
      repoPath: "config/print-estimate-cases/cm01-drip-tray-fff-0.2-pla.ini",
      exportName: "cm01-drip-tray-fff-0.2-pla",
      sha256: PROFILE_SHA,
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    filamentDensityGCm3: { value: 1.24, unit: "g/cm3" },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: [
      "Profile is a generic estimate, not validated against a specific printer.",
      "gcode_sha256 is non-deterministic and stored for audit only.",
    ],
    provenance: {
      status: "provisional",
      note: "Profile values are reviewed engineering candidates.",
    },
  });
}

function validCaseNoDensity() {
  return validatePrintEstimateCase({
    schemaVersion: "print-estimate-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-fff-v1",
    revision: 1,
    scope:
      "FFF print-time-and-material estimate for the isolated CM-01 DripTray STL at the reviewed 30 mm R2 geometry.",
    evidenceBoundary:
      "Observations only — not a verdict, cost estimate, certification, or manufacturing approval.",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    target: { componentKey: "drip-tray" },
    profile: {
      repoPath: "config/print-estimate-cases/cm01-drip-tray-fff-0.2-pla.ini",
      exportName: "cm01-drip-tray-fff-0.2-pla",
      sha256: PROFILE_SHA,
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: [
      "Profile is a generic estimate, not validated against a specific printer.",
      "gcode_sha256 is non-deterministic and stored for audit only.",
    ],
    provenance: {
      status: "provisional",
      note: "Profile values are reviewed engineering candidates.",
    },
  });
}

/**
 * Capture record built from values observed in the live probe (2026-08-05).
 * STL sha256: cf442050..., profile sha256: 15856bc8..., print_time_s: 38188.
 */
function captureRecord(
  printTimeNormalMode: string,
  notChecked: string[],
): PrintEstimateCaptureRecord {
  return {
    schemaVersion: "print-estimate-capture/1.0",
    caseId: "coffee-machine-cm01-v3-drip-tray-fff-v1",
    caseRevision: 1,
    caseDigest: "d".repeat(64),
    capturedAt: AT,
    stl: {
      exportName: "cm01-drip-tray-print-estimate",
      stlPath: "/exports/cm01-drip-tray-print-estimate.stl",
      stlSha256: STL_SHA,
      stlBytes: 684,
    },
    profile: {
      exportName: "cm01-drip-tray-fff-0.2-pla",
      profilePath: "/exports/cm01-drip-tray-fff-0.2-pla.ini",
      profileSha256: PROFILE_SHA,
      profileBytes: 692,
    },
    estimate: {
      printTimeS: 38188,
      printTimeNormalMode,
      printTimeSilentMode: null,
      filamentLengthMm: 87369.37,
      filamentVolumeMm3: 210150,
      filamentMassG: 260.58,
      gcodeSha256: GCODE_SHA,
      notChecked,
    },
    limitations: [
      "Profile is a generic estimate, not validated against a specific printer.",
      "gcode_sha256 is non-deterministic and stored for audit only.",
    ],
  };
}

function captureRecordNoDensity(
  printTimeNormalMode: string,
  notChecked: string[],
): PrintEstimateCaptureRecord {
  const { estimate, ...rest } = captureRecord(printTimeNormalMode, notChecked);
  const { filamentMassG: _mass, ...estimateNoDensity } = estimate as {
    printTimeS: number;
    printTimeNormalMode: string;
    printTimeSilentMode: null;
    filamentLengthMm: number;
    filamentVolumeMm3: number;
    filamentMassG?: number;
    gcodeSha256: string;
    notChecked: string[];
  };
  return { ...rest, estimate: estimateNoDensity };
}

/**
 * Valid prusaslicer_estimate_fff structuredContent response.
 * Values are from the live probe conducted 2026-08-05 with the committed
 * profile (15856bc8...) and the DripTray probe STL (cf442050...) with
 * filament_density_g_cm3 = 1.24 override.
 */
function validPrusaslicerResponse(
  stlSha256: string,
  profileSha256: string,
): Record<string, unknown> {
  return {
    print_time_s: 38188,
    print_time_normal_mode: "10h 36m 28s",
    print_time_silent_mode: null,
    filament_length_mm: 87369.37,
    filament_volume_mm3: 210150,
    filament_mass_g: 260.58,
    gcode_sha256: GCODE_SHA,
    not_checked: [
      "Bed adhesion (first-layer adhesion to build plate) is not verified.",
      "Warping risk is not assessed; use a brim or enclosure settings in the profile if needed.",
      "Dimensional tolerances of the printed part are not estimated; shrinkage is not modelled.",
      "Print-time accuracy depends on printer firmware and acceleration settings; the estimate is PrusaSlicer's own heuristic and may differ from actual print time by 5-20%.",
      "Support volume is not included in the material estimate when supports are disabled in the profile.",
      "Multi-material or multi-extruder configurations are not tested; use a single-extruder profile.",
      "filament_mass_g is absent (not null) when filament_density is not set in the profile or override.",
      "gcode_sha256 includes a build timestamp emitted by PrusaSlicer; identical inputs on different dates produce different G-code hashes.",
    ],
    stl_artifact: {
      sha256: stlSha256,
      bytes: 684,
      source_path: "/exports/cm01-drip-tray-print-estimate.stl",
    },
    profile_artifact: {
      sha256: profileSha256,
      bytes: 692,
      source_path: "/exports/cm01-drip-tray-fff-0.2-pla.ini",
    },
  };
}

function baseThreadSnapshot() {
  const at = "2026-08-05T11:00:00.000Z";
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return createThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r1:print-estimate-test-base",
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
      id: "test-print-estimate-base",
      name: "Test print-estimate baseline",
      status: "applied" as const,
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "test-model-print-estimate-created",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: "test-model" },
        summary: "Create test model for print-estimate executor test.",
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
      id: "test-model-print-estimate-change",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "test-model-print-estimate-created" },
      to: { kind: "artifact" as const, id: "test-model" },
      rationale: "Test baseline created the SysML model artifact.",
    }],
    proposedActions: [],
  });
}
