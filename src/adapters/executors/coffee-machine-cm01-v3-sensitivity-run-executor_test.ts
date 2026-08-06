import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { validateSensitivityStudyCase } from "../../domain/analysis/sensitivity-study.ts";
import {
  createThreadSnapshot,
  validateThreadSnapshot,
} from "../../domain/thread-snapshot-validation.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { FileSensitivityRunAttemptStore } from "../wal/file-sensitivity-run-attempt-store.ts";
import {
  COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION,
  CoffeeMachineCm01V3SensitivityRunExecutor,
  materializeSensitivitySnapshot,
  parseBuild123dSensitivityExport,
  parseCalculixSensitivitySolve,
} from "./coffee-machine-cm01-v3-sensitivity-run-executor.ts";

const AT = "2026-08-04T00:00:00.000Z";
const BASE_SHA = "a".repeat(64);
const CAPTURE_FP = { algorithm: "sha256" as const, digest: "c".repeat(64) };

// ── Test 1 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializeSensitivitySnapshot happy path produces a validateThreadSnapshot-passing snapshot",
  async () => {
    const baseMetrics = new Map([
      ["assembly_max_displacement", { value: 0.1, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.5, unit: "MPa" }],
    ]);
    const steppedMetrics = new Map([
      ["assembly_max_displacement", { value: 0.2, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.6, unit: "MPa" }],
    ]);
    const { snapshot } = await materializeSensitivitySnapshot(
      baseThreadSnapshot(),
      "run-sensitivity-happy",
      validCase(),
      CAPTURE_FP,
      "casys://sensitivity-study-capture/sha256/" + "c".repeat(64),
      BASE_SHA,
      "b".repeat(64),
      baseMetrics,
      steppedMetrics,
      AT,
    );
    validateThreadSnapshot(snapshot);
  },
);

// ── Test 2 ────────────────────────────────────────────────────────────────────

Deno.test(
  "materializeSensitivitySnapshot displacement derivative equals (stepped - base) / step",
  async () => {
    const base = 0.10;
    const stepped = 0.30;
    const step = 1; // mm — must equal validCase().step.value
    const baseMetrics = new Map([
      ["assembly_max_displacement", { value: base, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.5, unit: "MPa" }],
    ]);
    const steppedMetrics = new Map([
      ["assembly_max_displacement", { value: stepped, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.6, unit: "MPa" }],
    ]);
    const { snapshot } = await materializeSensitivitySnapshot(
      baseThreadSnapshot(),
      "run-sensitivity-deriv",
      validCase(),
      CAPTURE_FP,
      "casys://sensitivity-study-capture/sha256/" + "c".repeat(64),
      BASE_SHA,
      "b".repeat(64),
      baseMetrics,
      steppedMetrics,
      AT,
    );
    const derivObs = snapshot.observations.find(
      (o) => o.metric === "sensitivity_derivative_assembly_max_displacement",
    );
    assertEquals(
      derivObs?.quantity.value,
      (stepped - base) / step,
      "derivative must equal (stepped − base) / step",
    );
    assertEquals(derivObs?.quantity.unit, "mm/mm");
  },
);

// ── Test 3 ────────────────────────────────────────────────────────────────────

Deno.test(
  "completed WAL entry causes begin() to return action:completed, skipping provider dispatch",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const store = new FileSensitivityRunAttemptStore(dir);
      const caseDigest = "d".repeat(64);
      // First begin() → dispatched (providers would be called by the executor).
      const first = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: AT,
      });
      assertEquals(first.action, "dispatch");
      // Simulate a completed capture.
      await store.complete({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: AT,
        completedAt: "2026-08-04T00:01:00.000Z",
        captureFingerprint: CAPTURE_FP,
      });
      // Second begin() → completed; the executor reads the CAS and skips providers.
      const second = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: "2026-08-04T01:00:00.000Z",
      });
      assertEquals(second, { action: "completed", captureFingerprint: CAPTURE_FP });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// ── Test 4 ────────────────────────────────────────────────────────────────────

Deno.test(
  "executor with divergent base value rejects with TypeError before any provider call",
  async () => {
    const calls = { count: 0 };
    const countingProvider = {
      callTool(): Promise<never> {
        calls.count++;
        return Promise.reject(new Error("provider must not be called"));
      },
      callToolTextResult(): Promise<never> {
        calls.count++;
        return Promise.reject(new Error("provider must not be called"));
      },
    };
    const executor = new CoffeeMachineCm01V3SensitivityRunExecutor({
      ...minimalStubs(),
      sensitivityCase: divergentCase(),
      build123d: countingProvider,
      calculix: countingProvider,
      projects: {
        get(): Promise<EngineeringProjectSnapshot> {
          return Promise.resolve(minimalQueuedProject("run-divergent"));
        },
        getRevision(): Promise<undefined> {
          return Promise.resolve(undefined);
        },
        createInitial(): Promise<never> {
          return Promise.reject(new Error("stub must not be called"));
        },
        commit(): Promise<never> {
          return Promise.reject(new Error("stub must not be called"));
        },
      },
    });
    await assertRejects(
      () =>
        executor.execute(
          { kind: "agent", actorId: "agent-test" },
          {
            commandId: "cmd-divergent",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: 1,
            issuedAt: AT,
            runId: "run-divergent",
          },
        ),
      TypeError,
      "30 mm",
    );
    assertEquals(calls.count, 0, "no provider must have been called");
  },
);

// ── Test 5 ────────────────────────────────────────────────────────────────────

Deno.test(
  "parseBuild123dSensitivityExport rejects a response that does not preserve the exact export name",
  () => {
    // The STEP path must include the export name — a wrong name simulates a
    // build123d failure in the stepped run that stops capture recording.
    assertThrows(
      () =>
        parseBuild123dSensitivityExport(
          {
            schemaVersion: "1.0",
            kind: "export",
            files: [{
              format: "step",
              path: "/exports/wrong-name.step",
              bytes: 100,
              sha256: BASE_SHA,
            }],
          },
          "coffee-machine-cm01-v3-drip-tray-sensitivity-stepped",
        ),
      Error,
      "expected export name",
    );
  },
);

Deno.test(
  "parseBuild123dSensitivityExport rejects a null structuredContent",
  () => {
    assertThrows(
      () => parseBuild123dSensitivityExport(null, "any-name"),
      TypeError,
      "object",
    );
  },
);

// ── Test 6 ────────────────────────────────────────────────────────────────────

Deno.test(
  "parseCalculixSensitivitySolve rejects a displacement unit inconsistent with the declared metric unit",
  () => {
    const sc = validCase();
    // The case declares assembly_max_displacement in "mm"; returning "m" must reject.
    assertThrows(
      () =>
        parseCalculixSensitivitySolve(
          solveResultWithUnit("m", "MPa"),
          sc,
          "/exports/test.step",
          12345,
        ),
      TypeError,
      '"mm"',
    );
  },
);

Deno.test(
  "parseCalculixSensitivitySolve rejects a von Mises unit inconsistent with the declared metric unit",
  () => {
    const sc = validCase();
    // The case declares assembly_max_von_mises in "MPa"; returning "Pa" must reject.
    assertThrows(
      () =>
        parseCalculixSensitivitySolve(
          solveResultWithUnit("mm", "Pa"),
          sc,
          "/exports/test.step",
          12345,
        ),
      TypeError,
      '"MPa"',
    );
  },
);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validCase() {
  return validateSensitivityStudyCase({
    schemaVersion: "sensitivity-study-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-size-z-sensitivity-v1",
    revision: 1,
    scope: "DripTray size-z sensitivity test case.",
    evidenceBoundary: "Test boundary.",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    target: { componentKey: "drip-tray", semanticKey: "size-z" },
    recipeSource: {
      schemaVersion: "coffee-machine-semantic-recipe/2.0",
      key: "cm01-drip-tray-height-30",
    },
    baseValue: { value: 30, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [
      { id: "assembly_max_displacement", unit: "mm" },
      { id: "assembly_max_von_mises", unit: "MPa" },
    ],
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 5 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 2200,
        nu: 0.35,
        basis: "test",
      },
      supports: [{
        id: "drip-tray-rear-wall",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: { min: [-96, 66.5, -16], max: [96, 68.5, 16], unit: "mm" },
        },
      }],
      loads: [{
        id: "drip-tray-front-face",
        kind: "force",
        selection: {
          name: "LOADED",
          box: { min: [-96, -68.5, -16], max: [96, -66.5, 16], unit: "mm" },
        },
        force: { value: [0, 0, -100], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "Linear approximation near the 30 mm base.",
      limitations: ["Test limitation."],
    },
  });
}

function divergentCase() {
  return validateSensitivityStudyCase({
    schemaVersion: "sensitivity-study-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-size-z-sensitivity-v1",
    revision: 1,
    scope: "Divergent base case for negative tests.",
    evidenceBoundary: "Test boundary.",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    target: { componentKey: "drip-tray", semanticKey: "size-z" },
    recipeSource: {
      schemaVersion: "coffee-machine-semantic-recipe/2.0",
      key: "cm01-drip-tray-height-30",
    },
    // 28 ≠ DRIP_TRAY_SIZE_Z_R2_BASE_MM (30) → assertBaseValueMatchesDripTrayRecipeR2 throws.
    baseValue: { value: 28, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [
      { id: "assembly_max_displacement", unit: "mm" },
      { id: "assembly_max_von_mises", unit: "MPa" },
    ],
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 5 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 2200,
        nu: 0.35,
        basis: "test",
      },
      supports: [{
        id: "drip-tray-rear-wall",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: { min: [-96, 66.5, -16], max: [96, 68.5, 16], unit: "mm" },
        },
      }],
      loads: [{
        id: "drip-tray-front-face",
        kind: "force",
        selection: {
          name: "LOADED",
          box: { min: [-96, -68.5, -16], max: [96, -66.5, 16], unit: "mm" },
        },
        force: { value: [0, 0, -100], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "Test validity.",
      limitations: ["Test limitation."],
    },
  });
}

function baseThreadSnapshot() {
  const at = "2026-08-03T15:00:00.000Z";
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return createThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r1:test-base",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      kind: "system",
      version: "test",
      modelArtifactId: "test-model",
    },
    freshness: { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "test-base",
      name: "Test V3 baseline",
      status: "applied" as const,
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "test-model-created",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: "test-model" },
        summary: "Create test model.",
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
      id: "test-model-change",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "test-model-created" },
      to: { kind: "artifact" as const, id: "test-model" },
      rationale: "Test baseline created the SysML model artifact.",
    }],
    proposedActions: [],
  });
}

function minimalQueuedProject(runId: string): EngineeringProjectSnapshot {
  const workItemId = "wi-sensitivity-test";
  return {
    schemaVersion: "3.0",
    id: "coffee-machine-cm01-v3:r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: "coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      subjectId: "project:coffee-machine-cm01-v3",
      objective: {
        title: "Sensitivity study test",
        statement:
          "Test that assertBaseValueMatchesDripTrayRecipeR2 fires before providers.",
      },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [{
      id: workItemId,
      phaseId: "phase-test",
      title: "DripTray size-z sensitivity study",
      description: "Local first-order FEA sensitivity.",
      kind: "verify",
      operation: {
        id: COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION.id,
        version: COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION.version,
        bindings: [],
      },
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: runId,
      workItemId,
      status: "queued",
      summary: "DripTray size-z sensitivity run",
      queuedAt: AT,
      basis: {
        kind: "thread-snapshot",
        snapshotId: "project:coffee-machine-cm01-v3:r1:test-base",
        revision: 1,
        subjectId: "project:coffee-machine-cm01-v3",
      },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function solveResultWithUnit(
  dispUnit: string,
  vmUnit: string,
): Record<string, unknown> {
  return {
    schemaVersion: "2.0",
    kind: "static-solve",
    inputArtifact: {
      path: "/tmp/input.step",
      sourcePath: "/exports/test.step",
      sha256: BASE_SHA,
      bytes: 12345,
    },
    mesh: { nodes: 10, elements: 5, nodesPerSelection: {} },
    constraints: { fixedSelections: ["FIXED"], loads: [] },
    metrics: {
      maxDisplacement: { value: 0.1, unit: dispUnit },
      maxVonMises: { value: 0.5, unit: vmUnit },
    },
  };
}

/** Minimal stub dependencies — only used for paths that should not be reached. */
function minimalStubs() {
  return {
    projects: {
      get(): Promise<undefined> {
        return Promise.resolve(undefined);
      },
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    sensitivityCase: validCase(),
    build123d: {
      callTool(): Promise<never> {
        return Promise.reject(new Error("stub provider must not be called"));
      },
      callToolTextResult(): Promise<never> {
        return Promise.reject(new Error("stub provider must not be called"));
      },
    },
    calculix: {
      callTool(): Promise<never> {
        return Promise.reject(new Error("stub provider must not be called"));
      },
      callToolTextResult(): Promise<never> {
        return Promise.reject(new Error("stub provider must not be called"));
      },
    },
    attempts: {} as never,
    captures: {} as never,
    lease: {
      async withLease(
        _projectId: string,
        _runId: string,
        fn: () => Promise<unknown>,
      ): Promise<unknown> {
        return await fn();
      },
    } as never,
  };
}
