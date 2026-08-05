import { assertEquals } from "@std/assert";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import type { Cm01DripTrayMechanicalProofR3 } from "../../domain/cm01-drip-tray-mechanical-proof.ts";
import type { Cm01DripTrayMechanicalR3Capture } from "../cm01-drip-tray-mechanical-capture-r3.ts";
import type { ParsedOracleResult } from "../cm01-drip-tray-mechanical-oracle.ts";
import { CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer } from "./coffee-machine-cm01-v3-r3-successor-materializer.ts";

const AT = "2026-08-04T11:00:00.000Z";
const RUN_ID = "test-run-r3-001";
const CAPTURE_URI = "state/local/test-r3-capture.json";

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
    reason: "Superseded by the R3 correction path.",
    invalidatedByChangeIds: [],
  };
}

/**
 * Minimal valid base snapshot for the R3 mechanical materializer (normal path).
 *
 * The materializer's `stalePredecessors()` requires the same predecessor names
 * as the R2 materializer (the V1 stale proof, step, and solve).  The R3
 * correction record ID and the fresh assembly STEP are also identical to R2.
 */
function buildBaseSnapshot(): ThreadSnapshot {
  const correctionId = "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record";
  const op = { serverId: "digital-thread", tool: "seed", runId: "seed-r3-001" };

  const candidate = {
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r5:test-base-r3",
    revision: 5,
    previous: {
      snapshotId: "project:coffee-machine-cm01-v3:r4:test-base-r3",
      revision: 4,
    },
    generatedAt: AT,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 V3 DripTray",
      kind: "assembly" as const,
      version: "v3",
      modelArtifactId: correctionId,
    },
    freshness: {
      status: "stale" as const,
      changedAt: AT,
      reason: "Retained stale predecessor evidence awaits the mechanical R3 successor.",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "cm01-v3-r5-test-base-r3",
      name: "Establish test base with stale predecessors for R3",
      status: "applied" as const,
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [
      {
        id: correctionId,
        name: "CM-01 28 mm to 30 mm height correction record",
        kind: "document" as const,
        version: "a",
        fingerprint: fp("a"),
        producer: op,
        inputArtifactIds: [],
        freshness: freshness(),
      },
      {
        id: "predecessor-proof-r3",
        name: "CM-01 V3 reviewed DripTray proof case",
        kind: "document" as const,
        version: "b",
        fingerprint: fp("b"),
        producer: op,
        inputArtifactIds: [],
        freshness: stale(),
      },
      {
        id: "predecessor-step-r3",
        name: "CM-01 V3 isolated DripTray STEP",
        kind: "step" as const,
        version: "c",
        fingerprint: fp("c"),
        producer: op,
        inputArtifactIds: [],
        freshness: stale(),
      },
      {
        id: "predecessor-solve-r3",
        name: "CM-01 V3 CalculiX static result",
        kind: "solver-result" as const,
        version: "d",
        fingerprint: fp("d"),
        producer: op,
        inputArtifactIds: [],
        freshness: stale(),
      },
      {
        id: "r3-assembly-step",
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

function buildProof(): Cm01DripTrayMechanicalProofR3 {
  return {
    schemaVersion: "cm01-v3-drip-tray-static-proof/3.0",
    id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof-r3",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    evidenceBoundary: "test-boundary-r3",
    geometry: { widthMm: 190, depthMm: 135, heightMm: 30 },
    material: { eMpa: 2200, nu: 0.35 },
    meshSizeMm: 5,
    fixed: {
      name: "FIXED",
      box: { min: [0, 0, 0] as const, max: [190, 6, 31] as const },
    },
    loaded: {
      name: "LOADED",
      box: { min: [0, 30, 24] as const, max: [190, 135, 31] as const },
      forceN: [0, 0, -100] as const,
    },
    limits: { maximumDisplacementMm: 1, maximumVonMisesMpa: 20 },
  };
}

function buildCapture(): Cm01DripTrayMechanicalR3Capture {
  const stepFp = fp("f");
  return {
    schemaVersion: "cm01-v3-drip-tray-mechanical-capture/3.0",
    kind: "cm01-drip-tray-static-solve",
    capturedAt: AT,
    proofId: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof-r3",
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
    mesh: { nodes: 110, elements: 90, nodesPerSelection: { FIXED: 12, LOADED: 22 } },
    metrics: {
      maximumDisplacement: {
        value: 0.4,
        unit: "mm",
        nodeId: 55,
        vectorMm: [0.1, 0.1, 0.3],
      },
      maximumVonMises: { value: 10.0, unit: "MPa", elementId: 9 },
    },
    fingerprint: fp("h"),
  };
}

function passOracle(): ReadonlyMap<string, ParsedOracleResult> {
  return new Map<string, ParsedOracleResult>([
    ["assembly_max_displacement", {
      status: "pass",
      computedValue: 0.4,
      threshold: 1,
      margin: 0.6,
      marginPercent: 60,
      unit: "mm",
    }],
    ["assembly_max_von_mises", {
      status: "pass",
      computedValue: 10.0,
      threshold: 20,
      margin: 10.0,
      marginPercent: 50,
      unit: "MPa",
    }],
  ]);
}

function failOracle(): ReadonlyMap<string, ParsedOracleResult> {
  return new Map<string, ParsedOracleResult>([
    ["assembly_max_displacement", {
      status: "pass",
      computedValue: 0.4,
      threshold: 1,
      margin: 0.6,
      marginPercent: 60,
      unit: "mm",
    }],
    ["assembly_max_von_mises", {
      status: "fail",
      computedValue: 25.0,
      threshold: 20,
      margin: -5.0,
      marginPercent: -25,
      unit: "MPa",
    }],
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer fail verdict produces a validated snapshot with a named violation and a proposed action",
  async () => {
    const materializer = new CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer();
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
  "CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer pass verdict produces a validated snapshot with no violations",
  async () => {
    const materializer = new CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer();
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
