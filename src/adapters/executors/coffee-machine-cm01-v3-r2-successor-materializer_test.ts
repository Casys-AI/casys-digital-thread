import { assertEquals } from "@std/assert";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import type { Cm01DripTrayMechanicalProofR2 } from "../../domain/cm01-drip-tray-mechanical-proof.ts";
import type { Cm01DripTrayMechanicalR2Capture } from "../cm01-drip-tray-mechanical-capture-r2.ts";
import type { ParsedOracleResult } from "../cm01-drip-tray-mechanical-oracle.ts";
import { CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer } from "./coffee-machine-cm01-v3-r2-successor-materializer.ts";

const AT = "2026-08-04T10:00:00.000Z";
const RUN_ID = "test-run-r2-001";
const CAPTURE_URI = "state/local/test-r2-capture.json";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function fp(seed: string): ContentFingerprint {
  // Map seed to a valid hex character (0-9, a-f) for a deterministic 64-char digest.
  const HEX = "0123456789abcdef";
  const char = HEX[seed.charCodeAt(0) % 16]!;
  return { algorithm: "sha256", digest: char.repeat(64) };
}

function freshness() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function stale() {
  return {
    status: "stale" as const,
    changedAt: AT,
    reason: "Superseded by the 28 mm to 30 mm correction.",
    invalidatedByChangeIds: [],
  };
}

/**
 * Minimal valid base snapshot for the R2 mechanical materializer.
 *
 * Requires exactly the artifacts the materializer looks up:
 *   - fresh correction record (id = CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID)
 *   - stale proof / isolated STEP / solve (V3 predecessor names)
 *   - fresh R2 assembly STEP
 *
 * All artifacts have empty inputArtifactIds and no consumptions, so no
 * derived_from or uses provenance links are needed.  No changeSet changes,
 * so no `changes` links are needed either.  The root freshness is "stale"
 * because three predecessor artifacts are stale.
 */
function buildBaseSnapshot(): ThreadSnapshot {
  const sysmlId = "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record";
  const op = { serverId: "digital-thread", tool: "seed", runId: "seed-001" };

  const candidate = {
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r5:test-base",
    revision: 5,
    previous: {
      snapshotId: "project:coffee-machine-cm01-v3:r4:test-base",
      revision: 4,
    },
    generatedAt: AT,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 V3 DripTray",
      kind: "assembly" as const,
      version: "v3",
      modelArtifactId: sysmlId,
    },
    freshness: {
      status: "stale" as const,
      changedAt: AT,
      reason: "Retained stale predecessor evidence awaits the mechanical R2 successor.",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "cm01-v3-r5-test-base",
      name: "Establish test base with stale predecessors",
      status: "applied" as const,
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [
      {
        id: sysmlId,
        name: "CM-01 28 mm to 30 mm height correction record",
        kind: "document" as const,
        version: "a",
        fingerprint: fp("a"),
        producer: op,
        inputArtifactIds: [],
        freshness: freshness(),
      },
      {
        id: "predecessor-proof",
        name: "CM-01 V3 reviewed DripTray proof case",
        kind: "document" as const,
        version: "b",
        fingerprint: fp("b"),
        producer: op,
        inputArtifactIds: [],
        freshness: stale(),
      },
      {
        id: "predecessor-step",
        name: "CM-01 V3 isolated DripTray STEP",
        kind: "step" as const,
        version: "c",
        fingerprint: fp("c"),
        producer: op,
        inputArtifactIds: [],
        freshness: stale(),
      },
      {
        id: "predecessor-solve",
        name: "CM-01 V3 CalculiX static result",
        kind: "solver-result" as const,
        version: "d",
        fingerprint: fp("d"),
        producer: op,
        inputArtifactIds: [],
        freshness: stale(),
      },
      {
        id: "r2-assembly-step",
        name: "CM-01 30 mm DripTray assembly STEP export",
        kind: "step" as const,
        version: "e",
        fingerprint: fp("e"),
        producer: op,
        inputArtifactIds: [],
        freshness: freshness(),
      },
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  return validateThreadSnapshot(candidate);
}

function buildProof(): Cm01DripTrayMechanicalProofR2 {
  return {
    schemaVersion: "cm01-v3-drip-tray-static-proof/2.0",
    id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    evidenceBoundary: "test-boundary",
    geometry: { widthMm: 190, depthMm: 135, heightMm: 30 },
    material: { eMpa: 2200, nu: 0.35 },
    meshSizeMm: 5,
    fixed: {
      name: "FIXED",
      box: { min: [0, 0, 0] as const, max: [190, 5, 30] as const },
    },
    loaded: {
      name: "LOADED",
      box: { min: [0, 30, 25] as const, max: [190, 135, 30] as const },
      forceN: [0, 0, -100] as const,
    },
    limits: { maximumDisplacementMm: 1, maximumVonMisesMpa: 20 },
  };
}

function buildCapture(): Cm01DripTrayMechanicalR2Capture {
  const stepFp = fp("f");
  return {
    schemaVersion: "cm01-v3-drip-tray-mechanical-capture/2.0",
    kind: "cm01-drip-tray-static-solve",
    capturedAt: AT,
    proofId: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof",
    producer: {
      cad: { serverId: "build123d", tool: "build123d_export" },
      solver: { serverId: "calculix", tool: "calculix_solve_static" },
    },
    step: {
      name: "coffee-machine-cm01-v3-drip-tray-height-30.step",
      bytes: 1024,
      fingerprint: stepFp,
    },
    handoff: { fingerprint: stepFp, bytes: 1024 },
    mesh: { nodes: 100, elements: 80, nodesPerSelection: { FIXED: 10, LOADED: 20 } },
    metrics: {
      maximumDisplacement: {
        value: 0.5,
        unit: "mm",
        nodeId: 42,
        vectorMm: [0.1, 0.2, 0.4],
      },
      maximumVonMises: { value: 12.0, unit: "MPa", elementId: 7 },
    },
    fingerprint: fp("g"),
  };
}

function passOracle(): ReadonlyMap<string, ParsedOracleResult> {
  return new Map<string, ParsedOracleResult>([
    ["assembly_max_displacement", {
      status: "pass",
      computedValue: 0.5,
      threshold: 1,
      margin: 0.5,
      marginPercent: 50,
      unit: "mm",
    }],
    ["assembly_max_von_mises", {
      status: "pass",
      computedValue: 12.0,
      threshold: 20,
      margin: 8.0,
      marginPercent: 40,
      unit: "MPa",
    }],
  ]);
}

function failOracle(): ReadonlyMap<string, ParsedOracleResult> {
  return new Map<string, ParsedOracleResult>([
    ["assembly_max_displacement", {
      status: "fail",
      computedValue: 2.0,
      threshold: 1,
      margin: -1.0,
      marginPercent: -100,
      unit: "mm",
    }],
    ["assembly_max_von_mises", {
      status: "pass",
      computedValue: 12.0,
      threshold: 20,
      margin: 8.0,
      marginPercent: 40,
      unit: "MPa",
    }],
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer fail verdict produces a validated snapshot with a named violation and a proposed action",
  async () => {
    const materializer = new CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer();
    const { snapshot } = await materializer.materialize(
      buildBaseSnapshot(),
      RUN_ID,
      buildCapture(),
      CAPTURE_URI,
      buildProof(),
      failOracle(),
    );

    // Must not throw — the validator enforces every invariant, including the
    // fail→violation and violation→proposedAction symmetry rules.
    validateThreadSnapshot(snapshot);

    assertEquals(snapshot.violations.length, 1);
    const v = snapshot.violations[0]!;
    assertEquals(v.status, "open");

    // The proposed action must address the violation.
    const addressed = snapshot.proposedActions.some((a) =>
      a.addressesViolationIds.includes(v.id)
    );
    assertEquals(addressed, true, "open violation must have a proposed action");

    // Provenance: caused_by link must exist from violation to its evaluation.
    const causeLink = snapshot.provenance.some(
      (link) =>
        link.relation === "caused_by" &&
        link.from.kind === "violation" &&
        link.from.id === v.id &&
        link.to.kind === "evaluation" &&
        link.to.id === v.evaluationId,
    );
    assertEquals(causeLink, true, "violation must have a caused_by provenance link");
  },
);

Deno.test(
  "CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer pass verdict produces a validated snapshot with no violations",
  async () => {
    const materializer = new CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer();
    const { snapshot } = await materializer.materialize(
      buildBaseSnapshot(),
      RUN_ID,
      buildCapture(),
      CAPTURE_URI,
      buildProof(),
      passOracle(),
    );

    validateThreadSnapshot(snapshot);
    assertEquals(snapshot.violations.length, 0);
    assertEquals(snapshot.proposedActions.length, 0);
  },
);
