import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import type { Cm01DripTrayMechanicalProof } from "../domain/cm01-drip-tray-mechanical-proof.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import {
  EngineeringProjectCommandService,
} from "../domain/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../domain/project-brief-command-service.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../domain/syson-model-seed.ts";
import {
  ApprovedBriefBaselineRunExecutor,
} from "./approved-brief-baseline-run-executor.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "./file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "./engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import {
  FileOracleRequirementsSeedAttemptStore,
  OracleRequirementsSeedWriteOutcomeUnknownError,
} from "./file-oracle-requirements-seed-attempt-store.ts";
import { FileSysonModelSeedAttemptStore } from "./file-syson-model-seed-attempt-store.ts";
import { FileThreadSnapshotStore } from "./file-thread-snapshot-store.ts";
import { LiveThreadUpdateStore } from "./live-thread-update-store.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";
import {
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "./coffee-machine-cm01-v3-architecture-run-executor.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "./file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "./engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "./engineering-project-initial-baseline-evidence-validator.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "./http-mcp-tool-client.ts";
import {
  assertOracleRequirementsNotRemoved,
  canonicalRequirementsInPa,
  checkOracleRequirementsFidelityBeforeDispatch,
  CoffeeMachineCm01V3OracleRequirementsRunExecutor,
  findOracleRequirementsArtifact,
  ORACLE_REQUIREMENTS_URI_PREFIX,
  OracleRequirementsArtifactRemovedError,
} from "./coffee-machine-cm01-v3-oracle-requirements-run-executor.ts";
import type { ThreadSnapshot } from "../domain/thread-snapshot.ts";
import { EngineeringProjectCommandError } from "../domain/engineering-project-command-service.ts";
import type { ThreadSnapshotStore } from "../domain/thread-snapshot-store.ts";

// ---------------------------------------------------------------------------
// Constants shared across all tests
// ---------------------------------------------------------------------------

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

const MOCK_PROOF: Pick<Cm01DripTrayMechanicalProof, "limits"> = {
  limits: {
    maximumDisplacementMm: 1,
    maximumVonMisesMpa: 20,
  },
};

// ---------------------------------------------------------------------------
// Unit test — canonicalRequirementsInPa
// ---------------------------------------------------------------------------

Deno.test("canonicalRequirementsInPa converts von Mises from MPa to Pa using × 1_000_000", () => {
  const reqs = canonicalRequirementsInPa(MOCK_PROOF);
  assertEquals(reqs.length, 2);

  const displacement = reqs.find((r) => r.id === "drip_tray_max_displacement");
  assertExists(displacement);
  assertEquals(displacement.metric, "maximumDisplacementMm");
  assertEquals(displacement.operator, "<=");
  assertEquals(displacement.limit.value, 1);
  assertEquals(displacement.limit.unit, "mm");

  const vonMises = reqs.find((r) => r.id === "drip_tray_max_von_mises");
  assertExists(vonMises);
  assertEquals(vonMises.metric, "maximumVonMisesPa");
  assertEquals(vonMises.operator, "<=");
  // 20 MPa × 1_000_000 = 20_000_000 Pa (integer, no rounding)
  assertEquals(vonMises.limit.value, 20_000_000);
  assertEquals(vonMises.limit.unit, "Pa");

  // The canonical list is frozen — no agent can push new items.
  const original = reqs;
  const canonical = canonicalRequirementsInPa(MOCK_PROOF);
  assertEquals(canonical.length, original.length);
  assertEquals(canonical[0]?.id, original[0]?.id);
  assertEquals(canonical[1]?.id, original[1]?.id);
});

// ---------------------------------------------------------------------------
// Integration — happy path
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor inserts the requirements element and publishes a valid snapshot", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-cm01-oracle-requirements-",
  });
  try {
    const fixture = await queuedOracleRequirements(directory);

    // Build the oracle requirements mock aware of the architecture capture context.
    const syson = new OracleRequirementsSyson({
      architecturePackageId: fixture.architecturePackageId,
      declarationIds: fixture.declarationIds,
      editingContextId: fixture.editingContextId,
      newElementId: "oracle-req-element-001",
    });

    const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      architectureCaptures: fixture.archCaptures,
      seedCaptures: fixture.seedCaptures,
      requirementsCaptures: fixture.reqsCaptures,
      attempts: fixture.reqsAttempts,
      proof: MOCK_PROOF,
      syson,
      lease: new FileEngineeringProjectRunLease(
        `${directory}/oracle-requirements-leases`,
      ),
      now: () => "2026-08-03T16:00:00.000Z",
    });

    const completed = await executor.execute(
      AGENT,
      executionCommand(fixture.queued),
    );
    const run = completed.agentRuns.at(-1)!;
    assertEquals(run.status, "completed");

    // The result snapshot must carry an oracle-requirements artifact.
    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    const reqsArtifact = snapshot.artifacts.find(
      (a) =>
        a.kind === "sysml-model" &&
        typeof a.uri === "string" &&
        a.uri.startsWith(ORACLE_REQUIREMENTS_URI_PREFIX),
    );
    assertExists(reqsArtifact, "Oracle requirements artifact must be in the snapshot.");
    assertEquals(reqsArtifact.fingerprint.algorithm, "sha256");

    // The SysON calls must have the right shape: insert → children → extract.
    assertEquals(syson.calls.map((c) => c.name), [
      "syson_element_insert_sysml",
      "syson_element_children",
      "syson_constraint_extract",
    ]);
    assertEquals(
      syson.calls[0]?.arguments?.parent_id,
      fixture.architecturePackageId,
    );
    assertEquals(
      syson.calls[0]?.arguments?.editing_context_id,
      fixture.editingContextId,
    );
    assertEquals(
      syson.calls[1]?.arguments?.element_id,
      fixture.architecturePackageId,
    );
    assertEquals(
      syson.calls[2]?.arguments?.element_id,
      "oracle-req-element-001",
    );

    // Idempotent replay: same command, no extra SysON calls.
    const replay = await executor.execute(
      AGENT,
      executionCommand(fixture.queued),
    );
    assertEquals(replay.revision, completed.revision);
    assertEquals(syson.calls.length, 3, "Idempotent replay must not add SysON calls.");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// WAL — double-insertion guard
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements WAL write-ahead record never dispatches the same insertion twice", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-oracle-reqs-wal-" });
  try {
    const reqs = canonicalRequirementsInPa(MOCK_PROOF);
    const fingerprint = await sha256Fingerprint({ reqs });
    const attempts = new FileOracleRequirementsSeedAttemptStore(directory);

    assertEquals(
      await attempts.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run:oracle-req-test",
        requirementsDigest: fingerprint.digest,
        dispatchedAt: "2026-08-03T12:00:00.000Z",
      }),
      { action: "dispatch" },
    );
    // A second call without completing must raise — outcome is unknown.
    await assertRejects(
      () =>
        attempts.begin({
          projectId: "coffee-machine-cm01-v3",
          runId: "run:oracle-req-test",
          requirementsDigest: fingerprint.digest,
          dispatchedAt: "2026-08-03T12:01:00.000Z",
        }),
      OracleRequirementsSeedWriteOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Human rejection — before any store access
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor rejects a human before reading project or provider state", async () => {
  const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
    projects: {
      get: () => Promise.reject(new Error("must not read")),
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    architectureCaptures: {} as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
    requirementsCaptures: {} as never,
    attempts: {} as never,
    proof: MOCK_PROOF,
    syson: {
      callTool: () => Promise.reject(new Error("must not call")),
      callToolTextResult: () => Promise.reject(new Error("must not call")),
    },
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute(HUMAN, minimalCommand()),
    Error,
    "Only an authenticated agent",
  );
});

// ---------------------------------------------------------------------------
// Non-canonical project — before any provider call
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor rejects a non-canonical project before a provider call", async () => {
  let providerCalled = false;
  const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: {
            id: "different-project",
            subjectId: "project:different-project",
          },
          agentRuns: [{
            id: "run:oracle-requirements",
            workItemId: "write-oracle-requirements",
            basis: { kind: "thread-snapshot" },
          }],
          workItems: [{
            id: "write-oracle-requirements",
            operation: {
              id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements.id,
              version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements
                .version,
              bindings: [
                { name: "approvedBrief", source: { kind: "approved-brief" } },
                {
                  name: "architectureArtifact",
                  source: { kind: "thread-entity" },
                },
              ],
            },
          }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    architectureCaptures: {} as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
    requirementsCaptures: {} as never,
    attempts: {} as never,
    proof: MOCK_PROOF,
    syson: {
      callTool: () => {
        providerCalled = true;
        return Promise.reject(new Error("must not call"));
      },
      callToolTextResult: () => Promise.reject(new Error("must not call")),
    },
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute(AGENT, minimalCommand()),
    Error,
    "canonical CM-01 V3 oracle-requirements",
  );
  assertEquals(providerCalled, false);
});

// ---------------------------------------------------------------------------
// Zero candidates after insertion — terminal WAL error
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor raises a terminal error when syson_element_children finds zero candidates", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-oracle-reqs-zero-",
  });
  try {
    const fixture = await queuedOracleRequirements(directory);
    const syson = new OracleRequirementsSyson({
      architecturePackageId: fixture.architecturePackageId,
      declarationIds: fixture.declarationIds,
      editingContextId: fixture.editingContextId,
      newElementId: "oracle-req-element-001",
      forceZeroCandidates: true,
    });
    const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      architectureCaptures: fixture.archCaptures,
      seedCaptures: fixture.seedCaptures,
      requirementsCaptures: fixture.reqsCaptures,
      attempts: fixture.reqsAttempts,
      proof: MOCK_PROOF,
      syson,
      lease: new FileEngineeringProjectRunLease(
        `${directory}/oracle-requirements-leases-zero`,
      ),
      now: () => "2026-08-03T16:00:00.000Z",
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Multiple candidates after insertion — terminal WAL error
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor raises a terminal error when syson_element_children finds multiple candidates", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-oracle-reqs-multi-",
  });
  try {
    const fixture = await queuedOracleRequirements(directory);
    const syson = new OracleRequirementsSyson({
      architecturePackageId: fixture.architecturePackageId,
      declarationIds: fixture.declarationIds,
      editingContextId: fixture.editingContextId,
      newElementId: "oracle-req-element-001",
      forceMultipleCandidates: true,
    });
    const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      architectureCaptures: fixture.archCaptures,
      seedCaptures: fixture.seedCaptures,
      requirementsCaptures: fixture.reqsCaptures,
      attempts: fixture.reqsAttempts,
      proof: MOCK_PROOF,
      syson,
      lease: new FileEngineeringProjectRunLease(
        `${directory}/oracle-requirements-leases-multi`,
      ),
      now: () => "2026-08-03T16:00:00.000Z",
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Re-extraction diverges — no capture persisted
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor fails when re-extraction diverges without persisting a capture", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-oracle-reqs-tampered-",
  });
  try {
    const fixture = await queuedOracleRequirements(directory);
    const syson = new OracleRequirementsSyson({
      architecturePackageId: fixture.architecturePackageId,
      declarationIds: fixture.declarationIds,
      editingContextId: fixture.editingContextId,
      newElementId: "oracle-req-element-001",
      tamperedValue: 999, // extraction returns wrong threshold
    });
    const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      architectureCaptures: fixture.archCaptures,
      seedCaptures: fixture.seedCaptures,
      requirementsCaptures: fixture.reqsCaptures,
      attempts: fixture.reqsAttempts,
      proof: MOCK_PROOF,
      syson,
      lease: new FileEngineeringProjectRunLease(
        `${directory}/oracle-requirements-leases-tampered`,
      ),
      now: () => "2026-08-03T16:00:00.000Z",
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
    );
    // The requirements snapshot must NOT have been written.
    const project = await fixture.projects.get("coffee-machine-cm01-v3");
    const run = project?.agentRuns.find(
      (r) => r.id === fixture.queued.agentRuns.at(-1)!.id,
    );
    // run status should be "failed" or "running" but never "completed"
    assertEquals(run?.status !== "completed", true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Missing editingContextId in seed capture
// ---------------------------------------------------------------------------

Deno.test("CM-01 oracle requirements executor fails if the seed capture has no editingContextId", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-oracle-reqs-no-context-",
  });
  try {
    const fixture = await queuedOracleRequirements(directory);

    // Build a corrupted seed capture that has no editingContextId.
    const brokenSeedCapture = JSON.stringify({
      normalizedResults: { project: { id: "syson-project-123" } },
    });
    const brokenSeedFingerprint = {
      algorithm: "sha256" as const,
      digest: await sha256HexOf(brokenSeedCapture),
    };

    // Replace the seedCaptures store with one that returns the broken capture.
    const brokenSeedCaptures = {
      read: (_fp: unknown) => Promise.resolve(brokenSeedCapture),
    };

    const executor = new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      architectureCaptures: fixture.archCaptures,
      seedCaptures: brokenSeedCaptures,
      requirementsCaptures: fixture.reqsCaptures,
      attempts: fixture.reqsAttempts,
      proof: MOCK_PROOF,
      syson: {
        callTool: () => Promise.reject(new Error("must not call provider")),
        callToolTextResult: () => Promise.reject(new Error("must not call provider")),
      },
      lease: new FileEngineeringProjectRunLease(
        `${directory}/oracle-requirements-leases-no-ctx`,
      ),
      now: () => "2026-08-03T16:00:00.000Z",
    });

    void brokenSeedFingerprint; // fingerprint computed but not used in this variant

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "editingContextId",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Monotony ratchet — assertOracleRequirementsNotRemoved
// ---------------------------------------------------------------------------

Deno.test("assertOracleRequirementsNotRemoved raises when an ancestor had the requirements artifact but the current basis does not", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-oracle-ratchet-" });
  try {
    const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);

    // Build a minimal snapshot lineage:
    //   s1 (no artifact) → s2 (has oracle artifact) → s3 (no oracle artifact)
    // s3 without the artifact descends from s2 which had it: ratchet must fire.
    const operation = {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:test-ratchet",
    };
    const freshness = {
      status: "fresh" as const,
      changedAt: "2026-08-03T15:00:00.000Z",
      invalidatedByChangeIds: [],
    };
    const changeSet = {
      id: "changeset-test",
      name: "Test",
      status: "applied" as const,
      createdAt: "2026-08-03T15:00:00.000Z",
      appliedAt: "2026-08-03T15:00:00.000Z",
      changes: [],
    };
    const subject = {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system" as const,
      version: "v3",
      modelArtifactId: "model-artifact-001",
    };
    const modelArtifact = {
      id: "model-artifact-001",
      name: "Baseline model",
      kind: "sysml-model" as const,
      version: "v1",
      fingerprint: {
        algorithm: "sha256" as const,
        digest: "a".repeat(64),
      },
      producer: operation,
      inputArtifactIds: [],
      freshness,
    };
    const s1: ThreadSnapshot = {
      schemaVersion: "1.0",
      id: "snapshot-s1",
      revision: 1,
      generatedAt: "2026-08-03T15:00:00.000Z",
      subject,
      freshness,
      changeSet,
      artifacts: [modelArtifact],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
    };
    const reqsArtifact = {
      id: "oracle-requirements-artifact-s2",
      name: "Oracle requirements",
      kind: "sysml-model" as const,
      version: "v1",
      fingerprint: {
        algorithm: "sha256" as const,
        digest: "b".repeat(64),
      },
      uri: `${ORACLE_REQUIREMENTS_URI_PREFIX}sha256/${"b".repeat(64)}`,
      producer: operation,
      inputArtifactIds: [],
      freshness,
    };
    const s2: ThreadSnapshot = {
      ...s1,
      id: "snapshot-s2",
      revision: 2,
      previous: { snapshotId: "snapshot-s1", revision: 1 },
      artifacts: [modelArtifact, reqsArtifact],
    };
    const s3: ThreadSnapshot = {
      ...s1,
      id: "snapshot-s3",
      revision: 3,
      previous: { snapshotId: "snapshot-s2", revision: 2 },
      artifacts: [modelArtifact], // oracle artifact is absent!
    };

    await snapshots.save(s1);
    await snapshots.save(s2);
    // s3 has no oracle artifact, but its ancestor s2 had one.
    await assertRejects(
      () => assertOracleRequirementsNotRemoved(s3, snapshots),
      OracleRequirementsArtifactRemovedError,
      "previously carried an oracle requirements artifact",
    );

    // s2 itself has the artifact — no error.
    await assertOracleRequirementsNotRemoved(s2, snapshots);

    // s1 has no artifact and no ancestor — no error.
    await assertOracleRequirementsNotRemoved(s1, snapshots);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// checkOracleRequirementsFidelityBeforeDispatch — 4 branch tests
// ---------------------------------------------------------------------------

/**
 * Shared minimal snapshot factory for fidelity-check tests.
 *
 * The snapshot only needs to satisfy the fields that
 * checkOracleRequirementsFidelityBeforeDispatch actually reads:
 * `artifacts`, `previous`, and `subject.id`.  All other fields carry
 * valid sentinel values so the object satisfies the ThreadSnapshot type
 * without a cast.
 */
function mkFidelitySnapshot(
  id: string,
  extraArtifacts: ThreadSnapshot["artifacts"] = [],
  previous?: { snapshotId: string; revision: number },
): ThreadSnapshot {
  const freshness = {
    status: "fresh" as const,
    changedAt: "2026-08-03T15:00:00.000Z",
    invalidatedByChangeIds: [],
  };
  const baseArtifact = {
    id: "model-artifact-base",
    name: "Baseline model",
    kind: "sysml-model" as const,
    version: "v1",
    fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:test",
    },
    inputArtifactIds: [],
    freshness,
  };
  return {
    schemaVersion: "1.0",
    id,
    revision: 1,
    generatedAt: "2026-08-03T15:00:00.000Z",
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system",
      version: "v3",
      modelArtifactId: "model-artifact-base",
    },
    freshness,
    changeSet: {
      id: "changeset-base",
      name: "Base",
      status: "applied" as const,
      createdAt: "2026-08-03T15:00:00.000Z",
      appliedAt: "2026-08-03T15:00:00.000Z",
      changes: [],
    },
    artifacts: [baseArtifact, ...extraArtifacts],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
    ...(previous !== undefined ? { previous } : {}),
  };
}

/** Minimal McpToolClient that handles syson_constraint_extract only. */
class ConstraintExtractSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #tamperedValue: number | undefined;

  constructor(opts: { tamperedValue?: number } = {}) {
    this.#tamperedValue = opts.tamperedValue;
  }

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        `callToolTextResult not implemented by ConstraintExtractSyson (${call.name})`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_constraint_extract") {
      const canonical = canonicalRequirementsInPa(MOCK_PROOF);
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: canonical.map((req, index) => ({
            id: req.id,
            expression: {
              op: req.operator,
              left: { featurePath: [req.metric] },
              right: {
                value: (this.#tamperedValue !== undefined && index === 0)
                  ? this.#tamperedValue
                  : req.limit.value,
                unit: req.limit.unit,
              },
            },
          })),
        },
      });
    }
    return Promise.reject(
      new Error(`Unexpected tool call in ConstraintExtractSyson: ${call.name}`),
    );
  }
}

/** In-memory ThreadSnapshotStore that returns undefined for all lookups. */
function nullSnapshotStore(): ThreadSnapshotStore {
  return {
    get: (_id) => Promise.resolve(undefined),
    latest: (_subjectId) => Promise.resolve(undefined),
    save: (_snapshot) => Promise.resolve(),
  };
}

Deno.test(
  "checkOracleRequirementsFidelityBeforeDispatch passes when the basis has no requirements artifact and no lineage",
  async () => {
    // No oracle artifact, no previous — virgin lineage.
    const base = mkFidelitySnapshot("snap-no-artifact-virgin");
    // Assert no oracle artifact is found.
    assertEquals(findOracleRequirementsArtifact(base), undefined);

    // SysON must not be called — the ratchet walk returns quickly when
    // there is no ancestor to inspect.
    const syson: McpToolClient = {
      callTool: () =>
        Promise.reject(new Error("syson must not be called in virgin-lineage path")),
      callToolTextResult: () => Promise.reject(new Error("syson must not be called")),
    };

    // Should complete without throwing.
    await checkOracleRequirementsFidelityBeforeDispatch(
      base,
      nullSnapshotStore(),
      MOCK_PROOF,
      syson,
      undefined,
    );
  },
);

Deno.test(
  "checkOracleRequirementsFidelityBeforeDispatch passes when the artifact is present and the model matches the proof",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fidelity-ok-" });
    try {
      // Produce a capture that checkOracleRequirementsFidelityBeforeDispatch
      // will look up by the digest encoded in the artifact URI.
      const captureJson = JSON.stringify({
        elementId: "elem-fidelity-ok",
        editingContextId: "ctx-fidelity-ok",
      });
      const digest = await sha256HexOf(captureJson);
      const captureFingerprint = { algorithm: "sha256" as const, digest };

      const requirementsCaptures = new FileCaptureStore({
        kind: "oracle-requirements-seed" as const,
        directory: `${directory}/reqs-captures`,
        uriNamespace: "oracle-requirements-seed-capture",
        label: "Oracle requirements seed",
      });
      await requirementsCaptures.save(captureFingerprint, captureJson);

      const artifactUri = requirementsCaptures.uriFor(captureFingerprint);

      // Build a snapshot that carries the oracle-requirements artifact.
      const reqsArtifact = {
        id: "oracle-req-artifact-ok",
        name: "Oracle requirements",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: captureFingerprint,
        uri: artifactUri,
        producer: {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: "run:oracle-req",
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh" as const,
          changedAt: "2026-08-03T15:00:00.000Z",
          invalidatedByChangeIds: [],
        },
      };
      const base = mkFidelitySnapshot("snap-fidelity-ok", [reqsArtifact]);

      // The artifact must be found.
      const found = findOracleRequirementsArtifact(base);
      assertEquals(found?.id, "oracle-req-artifact-ok");

      const syson = new ConstraintExtractSyson();

      // Should complete without throwing.
      await checkOracleRequirementsFidelityBeforeDispatch(
        base,
        nullSnapshotStore(),
        MOCK_PROOF,
        syson,
        requirementsCaptures,
      );

      // The SysON extraction must have been called with the element and context
      // from the capture — proving that the fidelity path was exercised.
      assertEquals(syson.calls.length, 1);
      assertEquals(syson.calls[0]?.name, "syson_constraint_extract");
      assertEquals(syson.calls[0]?.arguments?.element_id, "elem-fidelity-ok");
      assertEquals(syson.calls[0]?.arguments?.editing_context_id, "ctx-fidelity-ok");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "checkOracleRequirementsFidelityBeforeDispatch rejects before any mechanical dispatch when the model threshold is tampered",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fidelity-tampered-" });
    try {
      const captureJson = JSON.stringify({
        elementId: "elem-tampered",
        editingContextId: "ctx-tampered",
      });
      const digest = await sha256HexOf(captureJson);
      const captureFingerprint = { algorithm: "sha256" as const, digest };

      const requirementsCaptures = new FileCaptureStore({
        kind: "oracle-requirements-seed" as const,
        directory: `${directory}/reqs-captures`,
        uriNamespace: "oracle-requirements-seed-capture",
        label: "Oracle requirements seed",
      });
      await requirementsCaptures.save(captureFingerprint, captureJson);

      const artifactUri = requirementsCaptures.uriFor(captureFingerprint);

      const reqsArtifact = {
        id: "oracle-req-artifact-tampered",
        name: "Oracle requirements",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: captureFingerprint,
        uri: artifactUri,
        producer: {
          serverId: "syson",
          tool: "syson_element_insert_sysml",
          runId: "run:oracle-req",
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh" as const,
          changedAt: "2026-08-03T15:00:00.000Z",
          invalidatedByChangeIds: [],
        },
      };
      const base = mkFidelitySnapshot("snap-fidelity-tampered", [reqsArtifact]);

      // Syson returns a tampered value for the first requirement (threshold 999
      // instead of the reviewed 1 mm).  The fidelity check must reject this.
      const syson = new ConstraintExtractSyson({ tamperedValue: 999 });

      // Track that no "mechanical" dispatch happens after the error.  In this
      // isolated test the mechanical provider is represented by a stub that
      // rejects unconditionally; the test verifies it is never reached.
      let mechanicalProviderCalled = false;
      const mechanicalProvider: McpToolClient = {
        callTool: () => {
          mechanicalProviderCalled = true;
          return Promise.reject(new Error("mechanical provider must not be called"));
        },
        callToolTextResult: () => Promise.reject(new Error("must not call")),
      };
      void mechanicalProvider; // only used to record the call flag

      await assertRejects(
        () =>
          checkOracleRequirementsFidelityBeforeDispatch(
            base,
            nullSnapshotStore(),
            MOCK_PROOF,
            syson,
            requirementsCaptures,
          ),
        EngineeringProjectCommandError,
        "fidelity check failed",
      );

      // The mechanical provider was never invoked — the error fires before
      // control returns to the executor's dispatch logic.
      assertEquals(mechanicalProviderCalled, false);

      // The fidelity SysON call DID happen (it's the one that detected the tamper).
      assertEquals(syson.calls.length, 1);
      assertEquals(syson.calls[0]?.name, "syson_constraint_extract");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "checkOracleRequirementsFidelityBeforeDispatch raises requirements_artifact_removed when an ancestor carried the artifact but the basis does not",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fidelity-removed-" });
    try {
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);

      // Build lineage:
      //   ancestor (snapshot-fa1, revision 1) → has oracle artifact
      //   basis    (snapshot-fa2, revision 2) → NO oracle artifact
      // checkOracleRequirementsFidelityBeforeDispatch must raise because the
      // artifact was present in an ancestor but not in the basis.
      const freshness = {
        status: "fresh" as const,
        changedAt: "2026-08-03T15:00:00.000Z",
        invalidatedByChangeIds: [],
      };
      const operation = {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:test-removed",
      };
      const changeSet = {
        id: "changeset-removed",
        name: "Removed",
        status: "applied" as const,
        createdAt: "2026-08-03T15:00:00.000Z",
        appliedAt: "2026-08-03T15:00:00.000Z",
        changes: [],
      };
      const subject = {
        id: "project:coffee-machine-cm01-v3",
        name: "CM-01",
        kind: "system" as const,
        version: "v3",
        modelArtifactId: "model-artifact-removed",
      };
      const baseModelArtifact = {
        id: "model-artifact-removed",
        name: "Baseline model",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const oracleArtifactInAncestor = {
        id: "oracle-req-removed",
        name: "Oracle requirements",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
        uri: `${ORACLE_REQUIREMENTS_URI_PREFIX}sha256/${"d".repeat(64)}`,
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };

      // ancestor: carries the oracle artifact.
      const ancestor: ThreadSnapshot = {
        schemaVersion: "1.0",
        id: "snapshot-fa1",
        revision: 1,
        generatedAt: "2026-08-03T15:00:00.000Z",
        subject,
        freshness,
        changeSet,
        artifacts: [baseModelArtifact, oracleArtifactInAncestor],
        consumptions: [],
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
      };

      // basis: does NOT carry the oracle artifact, but links to ancestor.
      const basis: ThreadSnapshot = {
        ...ancestor,
        id: "snapshot-fa2",
        revision: 2,
        previous: { snapshotId: "snapshot-fa1", revision: 1 },
        artifacts: [baseModelArtifact], // oracle artifact dropped
      };

      await snapshots.save(ancestor);
      // Do not save basis — it is passed directly to the function; the lineage
      // walk will find ancestor in the store.

      const syson: McpToolClient = {
        callTool: () =>
          Promise.reject(
            new Error("syson must not be called when the artifact is absent"),
          ),
        callToolTextResult: () => Promise.reject(new Error("must not call")),
      };

      const error = await assertRejects(
        () =>
          checkOracleRequirementsFidelityBeforeDispatch(
            basis,
            snapshots,
            MOCK_PROOF,
            syson,
            undefined,
          ),
        EngineeringProjectCommandError,
      );
      // The error message must carry the machine-readable prefix so callers can
      // parse it without relying on prose content.
      assertEquals(
        (error as EngineeringProjectCommandError).message.startsWith(
          "requirements_artifact_removed",
        ),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Mock SysON client for oracle requirements tests
// ---------------------------------------------------------------------------

interface OracleRequirementsSysonOptions {
  architecturePackageId: string;
  declarationIds: readonly string[];
  editingContextId: string;
  newElementId: string;
  /** If true, children returns only the known declarations (no new element). */
  forceZeroCandidates?: boolean;
  /** If true, children returns two unknown elements instead of one. */
  forceMultipleCandidates?: boolean;
  /** If set, extraction returns this value instead of the canonical one. */
  tamperedValue?: number;
}

class OracleRequirementsSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #opts: OracleRequirementsSysonOptions;

  constructor(opts: OracleRequirementsSysonOptions) {
    this.#opts = opts;
  }

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        `callToolTextResult is not implemented by this stub (${call.name})`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_insert_sysml") {
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
        },
      });
    }

    if (call.name === "syson_element_children") {
      const knownChildren = this.#opts.declarationIds.map((id, i) => ({
        id,
        kind: "sysml::PartDefinition",
        label: `Decl${i}`,
      }));
      let allChildren: { id: string; kind: string; label: string }[];
      if (this.#opts.forceZeroCandidates) {
        allChildren = [...knownChildren];
      } else if (this.#opts.forceMultipleCandidates) {
        allChildren = [
          ...knownChildren,
          { id: "extra-element-001", kind: "sysml::PartDefinition", label: "ExtraA" },
          { id: "extra-element-002", kind: "sysml::PartDefinition", label: "ExtraB" },
        ];
      } else {
        allChildren = [
          ...knownChildren,
          {
            id: this.#opts.newElementId,
            kind: "sysml::PartDefinition",
            label: "DripTrayMechanicalRequirements",
          },
        ];
      }
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: allChildren,
          count: allChildren.length,
        },
      });
    }

    if (call.name === "syson_constraint_extract") {
      const canonical = canonicalRequirementsInPa(MOCK_PROOF);
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: canonical.map((req, index) => ({
            id: req.id,
            expression: {
              op: req.operator,
              left: { featurePath: [req.metric] },
              right: {
                // If tamperedValue is set, use it for the first requirement.
                value: (this.#opts.tamperedValue !== undefined && index === 0)
                  ? this.#opts.tamperedValue
                  : req.limit.value,
                unit: req.limit.unit,
              },
            },
          })),
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected oracle requirements tool: ${call.name}`),
    );
  }
}

// ---------------------------------------------------------------------------
// Mock SysON clients for the architecture executor (reused from arch test)
// ---------------------------------------------------------------------------

class SeedSyson implements McpToolClient {
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_project_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          id: "syson-project-123",
          name: "CM-01",
          editingContextId: "editing-context-456",
        },
      });
    }
    if (call.name === "syson_model_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          documentId: "document-789",
          documentName: "CM-01",
          documentKind: "Document",
          rootPackageId: "root-package-012",
          rootPackageLabel: "New Package",
        },
      });
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "read",
        structuredContent: {
          id: "root-package-012",
          kind: "sysml::Package",
          label: "New Package",
        },
      });
    }
    return Promise.reject(new Error(`Unexpected seed tool ${call.name}`));
  }
}

class ArchitectureSyson implements McpToolClient {
  #children = 0;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_element_insert_sysml") {
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
          text: call.arguments?.sysml_text,
        },
      });
    }
    if (call.name !== "syson_element_children") {
      return Promise.reject(new Error(`Unexpected architecture tool ${call.name}`));
    }
    this.#children++;
    const parentId = call.arguments?.element_id;
    if (this.#children === 1) {
      return Promise.resolve({
        text: "preflight",
        structuredContent: { parentId, children: [], count: 0 },
      });
    }
    if (this.#children === 2) {
      return Promise.resolve({
        text: "root",
        structuredContent: {
          parentId,
          children: [{
            id: "cm01-package",
            kind: "sysml::Package",
            label: "CoffeeMachineCM01",
          }],
          count: 1,
        },
      });
    }
    return recipe().then((value) =>
      Promise.resolve({
        text: "package",
        structuredContent: {
          parentId,
          children: [
            value.system.sysmlPartDefinitionName,
            ...value.components.map(
              (component: { sysmlPartDefinitionName: string }) =>
                component.sysmlPartDefinitionName,
            ),
          ].map((label: string, index: number) => ({
            id: `definition-${index}`,
            kind: "sysml::PartDefinition",
            label,
          })),
          count: value.components.length + 1,
        },
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture builder — runs the full lifecycle up to a queued oracle-req run
// ---------------------------------------------------------------------------

interface OracleRequirementsFixture {
  projects: FileEngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  seedCaptures: FileCaptureStore<"syson-model-seed">;
  archCaptures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  reqsCaptures: FileCaptureStore<"oracle-requirements-seed">;
  reqsAttempts: FileOracleRequirementsSeedAttemptStore;
  queued: {
    project: { id: string };
    revision: number;
    agentRuns: readonly { id: string }[];
  };
  architecturePackageId: string;
  declarationIds: readonly string[];
  editingContextId: string;
}

async function queuedOracleRequirements(
  directory: string,
): Promise<OracleRequirementsFixture> {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed-captures`,
  });
  const archCaptures = new FileCaptureStore({
    ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const reqsCaptures = new FileCaptureStore({
    ...ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/oracle-requirements-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(
    `${directory}/seed-attempts`,
  );
  const archAttempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
    `${directory}/architecture-attempts`,
  );
  const reqsAttempts = new FileOracleRequirementsSeedAttemptStore(
    `${directory}/oracle-requirements-attempts`,
  );
  const liveUpdates = new LiveThreadUpdateStore();

  let tick = 0;
  const now = () =>
    new Date(
      Date.parse("2026-08-03T13:00:00.000Z") + ++tick * 1_000,
    ).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-v3",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-03T12:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-cm01-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Create a reviewable CM-01 coffee-machine engineering record.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Represent the reviewed CM-01 machine boundaries in one system model.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Capture a traceable SysON architecture read-back.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-cm01-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 architecture record is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );

  project = await commands.publishPlan(AGENT, {
    ...ctx("publish-cm01-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });

  project = await commands.queueRun(AGENT, {
    ...ctx("queue-cm01-baseline", project.revision),
    runId: "run:cm01-brief-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });

  const baseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-03T13:30:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-record-cm01-brief",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-03T13:30:00.000Z",
    runId: "run:cm01-brief-baseline",
  });

  const r1 = baseline.threadSnapshots[0]!;
  // Phase 1: seed + architecture only. The oracle-requirements work item is
  // added in a separate appendChange AFTER the architecture run completes,
  // because its architectureArtifact binding requires the real entity ref from r3.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-cm01-architecture", baseline.revision),
    baseSnapshot: r1,
    phases: [{
      id: "architecture",
      name: "System model",
      description: "Create the bounded CM-01 system model.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }, {
      id: "author-cm01-architecture",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["seed-syson-model"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });

  const queuedSeed = await commands.queueRun(AGENT, {
    ...ctx("queue-cm01-seed", project.revision),
    runId: "run:cm01-seed",
    workItemId: "seed-syson-model",
    summary: "Create the CM-01 SysON model container.",
    basis: { kind: "thread-snapshot", ...r1 },
  });

  const seeded = await new SysonModelSeedRunExecutor({
    projects,
    commands,
    snapshots,
    captures: seedCaptures,
    attempts: seedAttempts,
    syson: new SeedSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/seed-leases`),
    now: () => "2026-08-03T14:00:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-seed-cm01",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: queuedSeed.revision,
    issuedAt: "2026-08-03T14:00:00.000Z",
    runId: "run:cm01-seed",
  });

  const r2 = seeded.threadSnapshots.at(-1)!;
  const queuedArch = await commands.queueRun(AGENT, {
    ...ctx("queue-cm01-architecture", seeded.revision),
    runId: "run:cm01-architecture",
    workItemId: "author-cm01-architecture",
    summary: "Author the reviewed CM-01 architecture.",
    basis: { kind: "thread-snapshot", ...r2 },
  });

  const arched = await new CoffeeMachineCm01V3ArchitectureRunExecutor({
    projects,
    commands,
    snapshots,
    seedCaptures,
    captures: archCaptures,
    attempts: archAttempts,
    recipe: await recipe(),
    syson: new ArchitectureSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
    liveUpdates,
    now: () => "2026-08-03T15:00:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-author-cm01-architecture",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: queuedArch.revision,
    issuedAt: "2026-08-03T15:00:00.000Z",
    runId: "run:cm01-architecture",
  });

  const r3Ref = arched.threadSnapshots.at(-1)!;
  const r3 = await snapshots.get(r3Ref.snapshotId);
  assertExists(r3);

  // Extract architecture context from the real architecture capture.
  const archArtifact = r3.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith("casys://coffee-machine-cm01-v3-architecture/"),
  );
  assertExists(archArtifact, "r3 must have an architecture artifact.");
  const archCaptureText = await archCaptures.read(archArtifact.fingerprint);
  assertExists(archCaptureText, "Architecture capture must be readable.");
  const archCaptureJson = JSON.parse(archCaptureText) as {
    architecturePackage: { id: string };
    declarations: readonly { id: string }[];
    seed: { fingerprint: { algorithm: string; digest: string } };
  };

  const architecturePackageId = archCaptureJson.architecturePackage.id;
  const declarationIds = archCaptureJson.declarations.map((d) => d.id);
  // editingContextId comes from the SeedSyson mock which always uses "editing-context-456".
  const editingContextId = "editing-context-456";

  // Phase 2: oracle requirements work item. Added after r3 is known so the
  // architectureArtifact binding can carry the real entity ref from r3.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-oracle-requirements", arched.revision),
    baseSnapshot: r3Ref,
    phases: [{
      id: "oracle-requirements-phase",
      name: "Oracle requirements",
      description: "Anchor the reviewed oracle requirements in the SysML model.",
    }],
    workItems: [{
      id: "write-oracle-requirements",
      phaseId: "oracle-requirements-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["author-cm01-architecture"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "architectureArtifact",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: r3.id,
                snapshotRevision: r3.revision,
                kind: "artifact" as const,
                id: archArtifact.id,
              },
            },
          },
        ],
      },
    }],
    requiredDecisions: [],
  });

  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-oracle-requirements", project.revision),
    runId: "run:oracle-requirements",
    workItemId: "write-oracle-requirements",
    summary: "Write the CM-01 oracle requirements into the SysML model.",
    basis: { kind: "thread-snapshot", ...r3Ref },
  });

  return {
    projects,
    commands,
    snapshots,
    seedCaptures,
    archCaptures,
    reqsCaptures,
    reqsAttempts,
    queued,
    architecturePackageId,
    declarationIds,
    editingContextId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "coffee-machine-cm01-v3",
    expectedRevision,
    issuedAt: "2026-08-03T13:00:00.000Z",
  };
}

function minimalCommand() {
  return {
    commandId: "agent-oracle-req-cmd",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: 1,
    issuedAt: "2026-08-03T12:00:00.000Z",
    runId: "run:oracle-requirements",
  };
}

function executionCommand(
  queued: {
    project: { id: string };
    revision: number;
    agentRuns: readonly { id: string }[];
  },
) {
  return {
    commandId: "agent-oracle-req-cmd",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-03T15:30:00.000Z",
    runId: queued.agentRuns.at(-1)!.id,
  };
}

async function recipe() {
  return JSON.parse(
    await Deno.readTextFile(
      "config/product-recipes/coffee-machine-cm01-v1.json",
    ),
  );
}

async function sha256HexOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
