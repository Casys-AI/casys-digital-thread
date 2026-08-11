import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { validateSensitivityStudyCase } from "../../../domain/analysis/sensitivity-study.ts";
import {
  createThreadSnapshot,
  validateThreadSnapshot,
} from "../../../domain/thread/thread-snapshot-validation.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import { FileSensitivityRunAttemptStore } from "../../wal/file-sensitivity-run-attempt-store.ts";
import {
  COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION,
  CoffeeMachineCm01V3SensitivityRunExecutor,
  materializeSensitivitySnapshot,
  parseBuild123dSensitivityExport,
  parseCalculixSensitivitySolve,
  readValidatedSensitivityCapture,
} from "./coffee-machine-cm01-v3-sensitivity-run-executor.ts";
import { FileCaptureStore } from "../../captures/file-capture-store.ts";

const AT = "2026-08-04T00:00:00.000Z";
const BASE_SHA = "a".repeat(64);
const CASE_FP = { algorithm: "sha256" as const, digest: "d".repeat(64) };
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
      CASE_FP,
      CAPTURE_FP,
      "casys://sensitivity-study-capture/sha256/" + "c".repeat(64),
      baseMetrics,
      steppedMetrics,
      AT,
    );
    validateThreadSnapshot(snapshot);
    assertEquals(snapshot.schemaVersion, "1.1");
    const graph = snapshot.analysisGraph;
    if (!graph) throw new Error("Sensitivity snapshot must carry its analysis graph.");
    assertEquals(graph.relations.length, validCase().metrics.length);
    assertEquals(graph.nodes.some((node) => node.kind === "component"), false);
    const displacement = graph.relations.find((relation) =>
      relation.assertion.to.id.endsWith(":assembly_max_displacement")
    )?.assertion;
    assertEquals(displacement?.measurement, {
      method: "forward-finite-difference",
      basePoint: { value: 30, unit: "mm" },
      perturbationStep: { value: 1, unit: "mm" },
      responseAtBase: { value: 0.1, unit: "mm" },
      responseAtPerturbed: { value: 0.2, unit: "mm" },
      derivative: { value: 0.1, unit: "mm/mm" },
    });
    assertEquals(displacement?.evidence.map((evidence) => evidence.id), [
      "drip-tray-sensitivity-" + "c".repeat(64) + "-capture",
    ]);
    const sensitivityArtifacts = snapshot.artifacts.filter((artifact) =>
      artifact.id.startsWith("drip-tray-sensitivity-")
    );
    assertEquals(sensitivityArtifacts.map((artifact) => artifact.kind), ["document"]);
    assertEquals(sensitivityArtifacts[0]?.uri?.includes("#"), false);
    assertEquals(snapshot.consumptions, []);
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
      CASE_FP,
      CAPTURE_FP,
      "casys://sensitivity-study-capture/sha256/" + "c".repeat(64),
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

Deno.test(
  "two sensitivity captures for one case merge stable semantic nodes with parallel evidence occurrences",
  () => {
    const baseMetrics = new Map([
      ["assembly_max_displacement", { value: 0.1, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.5, unit: "MPa" }],
    ]);
    const steppedMetrics = new Map([
      ["assembly_max_displacement", { value: 0.2, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.6, unit: "MPa" }],
    ]);
    const first = materializeSensitivitySnapshot(
      baseThreadSnapshot(),
      "run-sensitivity-seal-1",
      validCase(),
      CASE_FP,
      CAPTURE_FP,
      "casys://sensitivity-study-capture/sha256/" + "c".repeat(64),
      baseMetrics,
      steppedMetrics,
      AT,
    );
    const secondFingerprint = {
      algorithm: "sha256" as const,
      digest: "e".repeat(64),
    };
    const second = materializeSensitivitySnapshot(
      first.snapshot,
      "run-sensitivity-seal-2",
      validCase(),
      CASE_FP,
      secondFingerprint,
      "casys://sensitivity-study-capture/sha256/" + "e".repeat(64),
      baseMetrics,
      steppedMetrics,
      "2026-08-04T00:02:00.000Z",
    );

    validateThreadSnapshot(second.snapshot);
    assertEquals(second.snapshot.analysisGraph?.nodes.length, 3);
    assertEquals(second.snapshot.analysisGraph?.relations.length, 4);
    assertEquals(
      new Set(
        second.snapshot.analysisGraph?.relations.map((relation) =>
          relation.assertion.evidence[0]?.fingerprint.digest
        ),
      ),
      new Set([CAPTURE_FP.digest, secondFingerprint.digest]),
    );
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
      const canonicalCaptureText = deterministicJson({ test: "capture" });
      const captureFingerprint = await sha256Fingerprint(
        JSON.parse(canonicalCaptureText),
      );
      // First begin() → dispatched (providers would be called by the executor).
      const first = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: AT,
      });
      assertEquals(first.action, "dispatch");
      // Simulate a durably recorded then completed capture.
      await store.recordCapture({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: AT,
        recordedAt: "2026-08-04T00:00:30.000Z",
        captureFingerprint,
        canonicalCaptureText,
      });
      await store.complete({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: AT,
        completedAt: "2026-08-04T00:01:00.000Z",
        captureFingerprint,
      });
      // Second begin() → completed; the executor reads the CAS and skips providers.
      const second = await store.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run-wal-skip",
        caseDigest,
        dispatchedAt: AT,
      });
      assertEquals(second, {
        action: "completed",
        captureFingerprint,
        canonicalCaptureText,
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "completed WAL replay rejects CAS captures substituted from another case or another run",
  async () => {
    const current = validCase();
    const currentDigest = "d".repeat(64);
    const currentRunId = "run-current";
    const alternate = validateSensitivityStudyCase({
      ...current,
      id: "coffee-machine-cm01-v3-drip-tray-size-z-sensitivity-alternate",
    });
    const alternateDigest = "e".repeat(64);
    const foreignCaseCapture = captureFor(alternate, alternateDigest, "run-other");
    const foreignRunCapture = captureFor(current, currentDigest, "run-other");
    const legacyCapture = {
      ...captureFor(current, currentDigest, currentRunId),
      schemaVersion: "sensitivity-study-capture/1.0" as const,
    };
    delete (legacyCapture as { trustedRunId?: string }).trustedRunId;
    const undeclaredMetricCapture = structuredClone(
      captureFor(current, currentDigest, currentRunId),
    );
    (undeclaredMetricCapture.base.metrics as Record<
      string,
      { value: number; unit: string }
    >).undeclared_metric = { value: 42, unit: "mm" };
    const directory = await Deno.makeTempDir();
    try {
      const captures = new FileCaptureStore({
        kind: "sensitivity-study" as const,
        directory,
        uriNamespace: "test-sensitivity-study",
        label: "Test sensitivity study",
      });
      const foreignCaseFingerprint = await sha256Fingerprint(foreignCaseCapture);
      const foreignRunFingerprint = await sha256Fingerprint(foreignRunCapture);
      const legacyFingerprint = await sha256Fingerprint(legacyCapture);
      const undeclaredMetricFingerprint = await sha256Fingerprint(
        undeclaredMetricCapture,
      );
      await captures.save(
        foreignCaseFingerprint,
        deterministicJson(foreignCaseCapture),
      );
      await captures.save(
        foreignRunFingerprint,
        deterministicJson(foreignRunCapture),
      );
      await captures.save(legacyFingerprint, deterministicJson(legacyCapture));
      await captures.save(
        undeclaredMetricFingerprint,
        deterministicJson(undeclaredMetricCapture),
      );

      // Both CAS entries are exact and internally valid for their own seals.
      await readValidatedSensitivityCapture(
        captures,
        foreignCaseFingerprint,
        alternate,
        alternateDigest,
        "run-other",
        AT,
      );
      await readValidatedSensitivityCapture(
        captures,
        foreignRunFingerprint,
        current,
        currentDigest,
        "run-other",
        AT,
      );

      await assertRejects(
        () =>
          readValidatedSensitivityCapture(
            captures,
            foreignCaseFingerprint,
            current,
            currentDigest,
            currentRunId,
            AT,
          ),
        Error,
        "exact reviewed case, run, and start instant",
      );
      await assertRejects(
        () =>
          readValidatedSensitivityCapture(
            captures,
            legacyFingerprint,
            current,
            currentDigest,
            currentRunId,
            AT,
          ),
        Error,
        "has no sealed run identity and cannot be replayed",
      );
      await assertRejects(
        () =>
          readValidatedSensitivityCapture(
            captures,
            undeclaredMetricFingerprint,
            current,
            currentDigest,
            currentRunId,
            AT,
          ),
        Error,
        "undeclared_metric",
      );
      await assertRejects(
        () =>
          readValidatedSensitivityCapture(
            captures,
            foreignRunFingerprint,
            current,
            currentDigest,
            currentRunId,
            AT,
          ),
        Error,
        "exact reviewed case, run, and start instant",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "validated sensitivity capture rejects pretty JSON despite a matching raw-byte fingerprint",
  async () => {
    const sensitivityCase = validCase();
    const caseDigest = "d".repeat(64);
    const record = captureFor(sensitivityCase, caseDigest, "run-pretty-json");
    const prettyText = JSON.stringify(record, null, 2);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(prettyText),
    );
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: [...new Uint8Array(digest)].map((byte) =>
        byte.toString(16).padStart(2, "0")
      ).join(""),
    };
    const directory = await Deno.makeTempDir();
    try {
      const captures = new FileCaptureStore({
        kind: "sensitivity-study" as const,
        directory,
        uriNamespace: "test-sensitivity-study",
        label: "Test sensitivity study",
      });
      await captures.save(fingerprint, prettyText);
      await assertRejects(
        () =>
          readValidatedSensitivityCapture(
            captures,
            fingerprint,
            sensitivityCase,
            caseDigest,
            "run-pretty-json",
            AT,
          ),
        Error,
        "not canonical deterministic JSON",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "a crash after CAS readback and capture-recorded resumes without provider redispatch",
  async () => {
    const directory = await Deno.makeTempDir();
    try {
      const attempts = new CompleteOnceBeforeWriteSensitivityStore(
        `${directory}/attempts`,
      );
      const captures = new CountingSensitivityCaptureStore(
        `${directory}/captures`,
      );
      const providers = sensitivityProviders();
      const executor = new CoffeeMachineCm01V3SensitivityRunExecutor({
        ...minimalStubs(),
        attempts,
        captures,
        build123d: providers.build123d,
        calculix: providers.calculix,
      });
      const project = minimalQueuedProject("run-crash-recovery");
      const run = project.agentRuns[0]!;
      const caseDigest = (await sha256Fingerprint(
        JSON.parse(deterministicJson(validCase())),
      )).digest;
      const captureOnce = (executor as unknown as {
        captureOnce(
          project: EngineeringProjectSnapshot,
          run: EngineeringAgentRun,
          dispatchedAt: string,
          caseDigest: string,
        ): Promise<{ record: { trustedRunId: string } }>;
      }).captureOnce.bind(executor);

      await assertRejects(
        () => captureOnce(project, run, AT, caseDigest),
        Error,
        "capture is durable in CAS and WAL",
      );
      assertEquals(providers.calls, { build123d: 2, calculix: 2 });
      const readbacksAfterFreshPath = captures.readCount;
      assertEquals(readbacksAfterFreshPath >= 1, true);

      const recovered = await captureOnce(project, run, AT, caseDigest);
      assertEquals(recovered.record.trustedRunId, run.id);
      assertEquals(providers.calls, { build123d: 2, calculix: 2 });
      assertEquals(captures.readCount > readbacksAfterFreshPath, true);
    } finally {
      await Deno.remove(directory, { recursive: true });
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

function captureFor(
  sensitivityCase: ReturnType<typeof validCase>,
  caseDigest: string,
  trustedRunId: string,
) {
  return {
    schemaVersion: "sensitivity-study-capture/1.1" as const,
    caseId: sensitivityCase.id,
    caseRevision: sensitivityCase.revision,
    caseDigest,
    trustedRunId,
    capturedAt: AT,
    base: {
      heightMm: sensitivityCase.baseValue.value,
      exportName: "coffee-machine-cm01-v3-drip-tray-sensitivity-base",
      stepSha256: BASE_SHA,
      metrics: {
        assembly_max_displacement: { value: 0.1, unit: "mm" },
        assembly_max_von_mises: { value: 0.5, unit: "MPa" },
      },
    },
    stepped: {
      heightMm: sensitivityCase.baseValue.value + sensitivityCase.step.value,
      exportName: "coffee-machine-cm01-v3-drip-tray-sensitivity-stepped",
      stepSha256: "b".repeat(64),
      metrics: {
        assembly_max_displacement: { value: 0.2, unit: "mm" },
        assembly_max_von_mises: { value: 0.6, unit: "MPa" },
      },
    },
    derivatives: [
      { metric: "assembly_max_displacement", value: 0.1, unit: "mm/mm" },
      {
        metric: "assembly_max_von_mises",
        value: 0.09999999999999998,
        unit: "MPa/mm",
      },
    ],
    domain: {
      approximationOrder: sensitivityCase.domain.approximationOrder,
      base: sensitivityCase.baseValue.value,
      step: sensitivityCase.step.value,
      parameterUnit: sensitivityCase.baseValue.unit,
      localValidityNote: sensitivityCase.domain.localValidityNote,
      limitations: [...sensitivityCase.domain.limitations],
    },
  };
}

class CompleteOnceBeforeWriteSensitivityStore extends FileSensitivityRunAttemptStore {
  #mustFail = true;

  override complete(
    input: Parameters<FileSensitivityRunAttemptStore["complete"]>[0],
  ): Promise<void> {
    if (this.#mustFail) {
      this.#mustFail = false;
      return Promise.reject(new Error("simulated crash before WAL completion"));
    }
    return super.complete(input);
  }
}

class CountingSensitivityCaptureStore extends FileCaptureStore<"sensitivity-study"> {
  readCount = 0;

  constructor(directory: string) {
    super({
      kind: "sensitivity-study",
      directory,
      uriNamespace: "test-sensitivity-study",
      label: "Test sensitivity study",
    });
  }

  override read(
    fingerprint: Parameters<FileCaptureStore<"sensitivity-study">["read"]>[0],
  ): ReturnType<FileCaptureStore<"sensitivity-study">["read"]> {
    this.readCount++;
    return super.read(fingerprint);
  }
}

function sensitivityProviders() {
  const calls = { build123d: 0, calculix: 0 };
  const build123d = {
    callTool(call: { arguments?: Readonly<Record<string, unknown>> }) {
      calls.build123d++;
      const name = String(call.arguments?.name);
      const digest = name.endsWith("-base") ? "a".repeat(64) : "b".repeat(64);
      return Promise.resolve({
        structuredContent: {
          schemaVersion: "1.0",
          kind: "export",
          files: [{
            format: "step",
            path: `/exports/${name}.step`,
            bytes: 12345,
            sha256: digest,
          }],
        },
        text: "",
      });
    },
    callToolTextResult(): Promise<never> {
      return Promise.reject(new Error("unused"));
    },
  };
  const calculix = {
    callTool(call: { arguments?: Readonly<Record<string, unknown>> }) {
      calls.calculix++;
      const sourcePath = String(call.arguments?.step_path);
      const isBase = sourcePath.includes("sensitivity-base");
      return Promise.resolve({
        structuredContent: {
          schemaVersion: "2.0",
          kind: "static-solve",
          inputArtifact: {
            sourcePath,
            sha256: String(call.arguments?.expected_step_sha256),
            bytes: 12345,
          },
          metrics: {
            maxDisplacement: { value: isBase ? 0.1 : 0.2, unit: "mm" },
            maxVonMises: { value: isBase ? 0.5 : 0.6, unit: "MPa" },
          },
        },
        text: "",
      });
    },
    callToolTextResult(): Promise<never> {
      return Promise.reject(new Error("unused"));
    },
  };
  return { calls, build123d, calculix };
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
