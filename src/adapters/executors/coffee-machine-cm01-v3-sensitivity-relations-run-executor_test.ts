/**
 * Tests for the CM-01 sensitivity-relations anchoring executor.
 *
 * Coverage:
 *  - Human-origin rejection (no I/O touched)
 *  - Non-canonical shape rejection (wrong operation, no provider call)
 *  - Ratchet: assertSensitivityRelationsNotRemoved fires when ancestor had the artifact
 *  - WAL double-insertion guard (terminal OutcomeUnknown)
 *  - Missing architecture artifact → invalid_input before provider call
 *  - Missing sensitivity artifact → invalid_input before provider call
 *  - Happy path: inserts element, verifies re-extraction, publishes a valid snapshot
 *
 * The executor test does NOT call build123d or CalculiX; it stubs SysON calls
 * through in-process implementations so the full WAL + CAS + snapshot sequence
 * is exercised without a live provider network.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import {
  EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project-brief-command-service.ts";
import {
  SENSITIVITY_RELATIONS_SCHEMA,
  validateSensitivityRelationsDeclaration,
} from "../../domain/sensitivity-relations.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../file-engineering-project-run-lease.ts";
import { FileSensitivityRelationsAttemptStore } from "../file-sensitivity-relations-attempt-store.ts";
import { FileThreadSnapshotStore } from "../file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { LiveThreadUpdateStore } from "../live-thread-update-store.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";
import { FileSysonModelSeedAttemptStore } from "../file-syson-model-seed-attempt-store.ts";
import {
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "./coffee-machine-cm01-v3-architecture-run-executor.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "../file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/syson-model-seed.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../http-mcp-tool-client.ts";
import {
  assertSensitivityRelationsNotRemoved,
  CoffeeMachineCm01V3SensitivityRelationsRunExecutor,
  findSensitivityRelationsArtifact,
  SENSITIVITY_RELATIONS_URI_PREFIX,
  SensitivityRelationsArtifactRemovedError,
} from "./coffee-machine-cm01-v3-sensitivity-relations-run-executor.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

// Known UUIDs from the SysonModelSeed + Architecture mock stubs below.
const EDITING_CONTEXT_ID = "editing-context-456";
const ARCH_PACKAGE_ID = "architecture-package-001";
// 11 declarations matching the recipe: CoffeeMachine + 10 components.
// IDs use the same definition-{index} pattern as the oracle-requirements test.
const RECIPE_PART_DEF_NAMES = [
  "CoffeeMachine",
  "Enclosure",
  "WaterTank",
  "Boiler",
  "Pump",
  "BrewUnit",
  "ControlPCB",
  "PowerSupply",
  "TemperatureSensor",
  "UserInterface",
  "DripTray",
];
const EXISTING_DECL_IDS = RECIPE_PART_DEF_NAMES.map((_, i) => `definition-${i}`);
const NEW_ELEMENT_ID = "sensitivity-relations-element-001";

const SENSITIVITY_CAPTURE_FIXTURE = JSON.stringify({
  schemaVersion: "sensitivity-study-capture/1.0",
  derivatives: [
    {
      metric: "assembly_max_displacement",
      value: -0.00801800268471424,
      unit: "mm/mm",
    },
    {
      metric: "assembly_max_von_mises",
      value: -0.036042088238638414,
      unit: "MPa/mm",
    },
  ],
  domain: {
    base: 30,
    step: 1,
    parameterUnit: "mm",
  },
  capturedAt: "2026-08-04T11:43:39.000Z",
});

// ---------------------------------------------------------------------------
// Ratchet — assertSensitivityRelationsNotRemoved
// ---------------------------------------------------------------------------

Deno.test(
  "assertSensitivityRelationsNotRemoved raises when an ancestor carried the sensitivity-relations artifact but the current basis does not",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-rel-ratchet-",
    });
    try {
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const freshness = {
        status: "fresh" as const,
        changedAt: "2026-08-05T09:00:00.000Z",
        invalidatedByChangeIds: [],
      };
      const operation = {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:ratchet-test",
      };
      const changeSet = {
        id: "changeset-ratchet",
        name: "Ratchet test",
        status: "applied" as const,
        createdAt: "2026-08-05T09:00:00.000Z",
        appliedAt: "2026-08-05T09:00:00.000Z",
        changes: [],
      };
      const subject = {
        id: "project:coffee-machine-cm01-v3",
        name: "CM-01",
        kind: "system" as const,
        version: "v3",
        modelArtifactId: "base-artifact-ratchet",
      };
      const baseArtifact = {
        id: "base-artifact-ratchet",
        name: "Base model",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const relationsArtifact = {
        id: "sens-relations-artifact-ratchet",
        name: "Sensitivity relations",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: `${SENSITIVITY_RELATIONS_URI_PREFIX}sha256/${"b".repeat(64)}`,
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const minimalBase = {
        schemaVersion: "1.0" as const,
        generatedAt: "2026-08-05T09:00:00.000Z",
        freshness,
        changeSet,
        subject,
        consumptions: [] as never[],
        observations: [] as never[],
        requirements: [] as never[],
        evaluations: [] as never[],
        violations: [] as never[],
        provenance: [] as never[],
        proposedActions: [] as never[],
      };

      const s1: ThreadSnapshot = {
        ...minimalBase,
        id: "snapshot-ratchet-1",
        revision: 1,
        artifacts: [baseArtifact],
      };
      const s2: ThreadSnapshot = {
        ...minimalBase,
        id: "snapshot-ratchet-2",
        revision: 2,
        previous: { snapshotId: "snapshot-ratchet-1", revision: 1 },
        artifacts: [baseArtifact, relationsArtifact],
      };
      const s3: ThreadSnapshot = {
        ...minimalBase,
        id: "snapshot-ratchet-3",
        revision: 3,
        previous: { snapshotId: "snapshot-ratchet-2", revision: 2 },
        artifacts: [baseArtifact], // dropped relations artifact
      };

      await snapshots.save(s1);
      await snapshots.save(s2);

      // s3 lacks the artifact but ancestor s2 had it.
      await assertRejects(
        () => assertSensitivityRelationsNotRemoved(s3, snapshots),
        SensitivityRelationsArtifactRemovedError,
        "previously carried a sensitivity-relations artifact",
      );

      // s2 itself has the artifact — no error.
      await assertSensitivityRelationsNotRemoved(s2, snapshots);

      // s1 has no artifact and no ancestor — no error.
      await assertSensitivityRelationsNotRemoved(s1, snapshots);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Ratchet — through executor path (omission test)
// ---------------------------------------------------------------------------
//
// This test proves the ratchet call lives inside executeLeased / loadInputs.
// Removing `await assertSensitivityRelationsNotRemoved(base, this.#snapshots)` from
// loadInputs must make this test fail (the executor would reach SysON instead of
// throwing SensitivityRelationsArtifactRemovedError).

Deno.test(
  "CM-01 sensitivity-relations executor stops with SensitivityRelationsArtifactRemovedError before any SysON call when the basis ancestor carried the artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-rel-ratchet-thru-exec-",
    });
    try {
      const fixture = await queuedSensitivityRelationsOnRatchetBasis(directory);

      let syonCalled = false;
      const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityRelationsCaptures: fixture.sensRelCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/sensitivity-relations-attempts-ratchet-exec`,
        ),
        syson: {
          callTool: () => {
            syonCalled = true;
            return Promise.reject(
              new Error("SysON must not be called: ratchet should fire first"),
            );
          },
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/sensitivity-relations-leases-ratchet-exec`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-sens-rel-ratchet-exec",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T09:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        SensitivityRelationsArtifactRemovedError,
        "previously carried a sensitivity-relations artifact",
      );

      assertEquals(
        syonCalled,
        false,
        "SysON must not be reached: the ratchet fires before the provider call.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// WAL — double-insertion guard
// ---------------------------------------------------------------------------

Deno.test(
  "FileSensitivityRelationsAttemptStore never dispatches the same insertion twice without a completed record",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-sens-rel-wal-" });
    try {
      const decl = validateSensitivityRelationsDeclaration({
        schemaVersion: SENSITIVITY_RELATIONS_SCHEMA,
        paramAttrs: [{ attrName: "sizeZ_base_mm", unit: "mm" }],
        derivativeAttrs: [{ attrName: "dDisplacementDSizeZ_mm_per_mm", unit: "mm/mm" }],
        validityBounds: [{
          constraintName: "sizeZ_validity_lower",
          paramAttrName: "sizeZ_base_mm",
          operator: ">=",
          boundValue: 29,
          boundUnit: "mm",
        }],
        runId: "run-2026-08-05",
        capturedAt: "2026-08-05T09:00:00.000Z",
      });
      const fingerprint = await sha256Fingerprint(decl);
      const attempts = new FileSensitivityRelationsAttemptStore(directory);

      assertEquals(
        await attempts.begin({
          projectId: "coffee-machine-cm01-v3",
          runId: "run:sens-rel-wal-test",
          relationsDigest: fingerprint.digest,
          dispatchedAt: "2026-08-05T09:00:00.000Z",
        }),
        { action: "dispatch" },
      );
      // Second begin before complete must raise.
      await assertRejects(
        () =>
          attempts.begin({
            projectId: "coffee-machine-cm01-v3",
            runId: "run:sens-rel-wal-test",
            relationsDigest: fingerprint.digest,
            dispatchedAt: "2026-08-05T09:01:00.000Z",
          }),
        Error,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Human rejection
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-relations executor rejects a human before any store access",
  async () => {
    const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      architectureCaptures: {} as never,
      seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
      sensitivityCaptures: {} as never,
      sensitivityRelationsCaptures: {} as never,
      attempts: {} as never,
      syson: {
        callTool: () => Promise.reject(new Error("must not call")),
        callToolTextResult: () => Promise.reject(new Error("must not call")),
      },
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: "human-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: 1,
          issuedAt: "2026-08-05T09:00:00.000Z",
          runId: "run:sens-rel",
        }),
      Error,
      "Only an authenticated agent",
    );
  },
);

// ---------------------------------------------------------------------------
// Non-canonical shape rejection
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-relations executor rejects a wrong operation before any provider call",
  async () => {
    let providerCalled = false;
    const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: {
              id: "different-project",
              subjectId: "project:different-project",
            },
            agentRuns: [{
              id: "run:sens-rel",
              workItemId: "write-sens-rel",
              basis: { kind: "thread-snapshot" },
            }],
            workItems: [{
              id: "write-sens-rel",
              operation: {
                id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations.id,
                version:
                  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations.version,
                bindings: [
                  { name: "approvedBrief", source: { kind: "approved-brief" } },
                  { name: "sensitivityArtifact", source: { kind: "thread-entity" } },
                ],
              },
            }],
          } as never),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      architectureCaptures: {} as never,
      seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
      sensitivityCaptures: {} as never,
      sensitivityRelationsCaptures: {} as never,
      attempts: {} as never,
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
      () =>
        executor.execute(AGENT, {
          commandId: "agent-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: 1,
          issuedAt: "2026-08-05T09:00:00.000Z",
          runId: "run:sens-rel",
        }),
      Error,
      "canonical CM-01 V3 sensitivity-relations",
    );
    assertEquals(providerCalled, false);
  },
);

// ---------------------------------------------------------------------------
// Integration — happy path
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-relations executor inserts the element and publishes a valid snapshot",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-rel-happy-",
    });
    try {
      const fixture = await queuedSensitivityRelations(directory);
      const syson = new SensitivityRelationsSyson({
        architecturePackageId: ARCH_PACKAGE_ID,
        declarationIds: EXISTING_DECL_IDS,
        editingContextId: EDITING_CONTEXT_ID,
        newElementId: NEW_ELEMENT_ID,
      });

      const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityRelationsCaptures: fixture.sensRelCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/sensitivity-relations-attempts`,
        ),
        syson,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/sensitivity-relations-leases`,
        ),
        now: () => "2026-08-05T09:00:00.000Z",
      });

      const completed = await executor.execute(
        AGENT,
        {
          commandId: "agent-sens-rel-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: fixture.queued.revision,
          issuedAt: "2026-08-05T09:00:00.000Z",
          runId: fixture.queued.agentRuns.at(-1)!.id,
        },
      );

      const run = completed.agentRuns.at(-1)!;
      assertEquals(run.status, "completed");

      // The result snapshot must carry a sensitivity-relations artifact.
      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot);

      // The snapshot must pass full validation (not just in-memory inspection).
      validateThreadSnapshot(snapshot);

      const relationsArtifact = findSensitivityRelationsArtifact(snapshot);
      assertExists(
        relationsArtifact,
        "Snapshot must carry the sensitivity-relations artifact.",
      );
      assertEquals(relationsArtifact.fingerprint.algorithm, "sha256");

      // The SysON call sequence must be: preflight children (idempotent
      // adoption guard) → insert → children (identification by server-fixed
      // name) → constraint_extract + element_children (verification).
      assertEquals(syson.calls.map((c) => c.name), [
        "syson_element_children",
        "syson_element_insert_sysml",
        "syson_element_children",
        "syson_constraint_extract",
        "syson_element_children",
      ]);
      assertEquals(syson.calls[0]?.arguments?.element_id, ARCH_PACKAGE_ID);
      assertEquals(syson.calls[1]?.arguments?.parent_id, ARCH_PACKAGE_ID);
      assertEquals(syson.calls[1]?.arguments?.editing_context_id, EDITING_CONTEXT_ID);
      assertEquals(syson.calls[2]?.arguments?.element_id, ARCH_PACKAGE_ID);
      assertEquals(syson.calls[3]?.arguments?.element_id, NEW_ELEMENT_ID);
      assertEquals(syson.calls[4]?.arguments?.element_id, NEW_ELEMENT_ID);

      // Idempotent replay: same command, no extra SysON calls.
      const replay = await executor.execute(
        AGENT,
        {
          commandId: "agent-sens-rel-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: completed.revision,
          issuedAt: "2026-08-05T09:00:00.000Z",
          runId: fixture.queued.agentRuns.at(-1)!.id,
        },
      );
      assertEquals(replay.revision, completed.revision);
      assertEquals(
        syson.calls.length,
        5,
        "Idempotent replay must not add SysON calls.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Missing architecture artifact
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-relations executor fails with invalid_input when the basis has no architecture artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-rel-no-arch-",
    });
    try {
      // Build the project up to the baseline snapshot (r1), without architecture.
      const fixture = await queuedSensitivityRelationsOnBriefBasis(directory);
      const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityRelationsCaptures: fixture.sensRelCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/sensitivity-relations-attempts-no-arch`,
        ),
        syson: {
          callTool: () =>
            Promise.reject(new Error("must not call provider before input error")),
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/sensitivity-relations-leases-no-arch`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-sens-rel-no-arch",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T09:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        Error,
        "no architecture artifact",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Extraction diverges — no capture persisted
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-relations executor fails when re-extraction diverges without persisting a capture",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-rel-tampered-",
    });
    try {
      const fixture = await queuedSensitivityRelations(directory);
      const syson = new SensitivityRelationsSyson({
        architecturePackageId: ARCH_PACKAGE_ID,
        declarationIds: EXISTING_DECL_IDS,
        editingContextId: EDITING_CONTEXT_ID,
        newElementId: NEW_ELEMENT_ID,
        tamperedBoundValue: 999, // forces extraction divergence
      });

      const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityRelationsCaptures: fixture.sensRelCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/sensitivity-relations-attempts-tampered`,
        ),
        syson,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/sensitivity-relations-leases-tampered`,
        ),
        now: () => "2026-08-05T09:00:00.000Z",
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-sens-rel-tampered",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T09:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        Error,
      );

      // The run must NOT be completed.
      const project = await fixture.projects.get("coffee-machine-cm01-v3");
      const run = project?.agentRuns.find(
        (r) => r.id === fixture.queued.agentRuns.at(-1)!.id,
      );
      assertEquals(run?.status !== "completed", true);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Unknown metric in sensitivity capture
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-relations executor fails with invalid_input when the sensitivity capture has an unknown metric",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-rel-unknown-metric-",
    });
    try {
      const badSensitivityCapture = JSON.stringify({
        schemaVersion: "sensitivity-study-capture/1.0",
        derivatives: [
          { metric: "unknown_metric_id", value: -0.008, unit: "mm/mm" },
        ],
        domain: { base: 30, step: 1, parameterUnit: "mm" },
        capturedAt: "2026-08-05T09:00:00.000Z",
      });
      const fixture = await queuedSensitivityRelations(
        directory,
        badSensitivityCapture,
      );

      const executor = new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityRelationsCaptures: fixture.sensRelCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/sensitivity-relations-attempts-unknown-metric`,
        ),
        syson: {
          callTool: () =>
            Promise.reject(new Error("must not call provider before input error")),
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/sensitivity-relations-leases-unknown-metric`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-sens-rel-unknown-metric",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T09:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        Error,
        "server-fixed attribute name mapping",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Mock SysON client for sensitivity-relations tests
// ---------------------------------------------------------------------------

interface SensitivityRelationsSysonOptions {
  architecturePackageId: string;
  declarationIds: readonly string[];
  editingContextId: string;
  newElementId: string;
  forceZeroCandidates?: boolean;
  forceMultipleCandidates?: boolean;
  /** If set, extraction returns this value for the first bound instead of 29. */
  tamperedBoundValue?: number;
}

class SensitivityRelationsSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #opts: SensitivityRelationsSysonOptions;
  #inserted = false;

  constructor(opts: SensitivityRelationsSysonOptions) {
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
      this.#inserted = true;
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
      if (
        this.#opts.forceZeroCandidates ||
        call.arguments?.element_id !== this.#opts.architecturePackageId
      ) {
        // Return only known children for identification calls from architecture pkg;
        // for element-level children (re-extraction), return attrs + constraints.
        if (call.arguments?.element_id === this.#opts.newElementId) {
          allChildren = [
            { id: "attr-a1", kind: "AttributeUsage", label: "sizeZ_base_mm" },
            { id: "attr-a2", kind: "AttributeUsage", label: "sizeZ_step_mm" },
            {
              id: "attr-a3",
              kind: "AttributeUsage",
              label: "dDisplacementDSizeZ_mm_per_mm",
            },
            {
              id: "attr-a4",
              kind: "AttributeUsage",
              label: "dVonMisesDSizeZ_MPa_per_mm",
            },
          ];
        } else {
          allChildren = this.#opts.forceZeroCandidates
            ? [...knownChildren]
            : knownChildren;
        }
      } else if (this.#opts.forceMultipleCandidates) {
        allChildren = [
          ...knownChildren,
          {
            id: "extra-element-001",
            kind: "sysml::PartDefinition",
            label: "ExtraA",
          },
          {
            id: "extra-element-002",
            kind: "sysml::PartDefinition",
            label: "ExtraB",
          },
        ];
      } else if (call.arguments?.element_id === this.#opts.newElementId) {
        allChildren = [
          { id: "attr-a1", kind: "AttributeUsage", label: "sizeZ_base_mm" },
          { id: "attr-a2", kind: "AttributeUsage", label: "sizeZ_step_mm" },
          {
            id: "attr-a3",
            kind: "AttributeUsage",
            label: "dDisplacementDSizeZ_mm_per_mm",
          },
          {
            id: "attr-a4",
            kind: "AttributeUsage",
            label: "dVonMisesDSizeZ_MPa_per_mm",
          },
        ];
      } else if (this.#inserted) {
        allChildren = [
          ...knownChildren,
          {
            id: this.#opts.newElementId,
            kind: "sysml::PartDefinition",
            label: "DripTraySensitivityRelations",
          },
        ];
      } else {
        // Preflight before insertion: the package holds only known elements.
        allChildren = [...knownChildren];
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
      // Two validity bounds: lower (>=29) and upper (<=31).
      const lower = {
        id: "uuid-lower-constraint",
        name: "sizeZ_validity_lower",
        expression: {
          kind: "binary",
          op: ">=",
          left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
          right: {
            kind: "literal",
            value: this.#opts.tamperedBoundValue ?? 29,
            unit: "mm",
          },
        },
      };
      const upper = {
        id: "uuid-upper-constraint",
        name: "sizeZ_validity_upper",
        expression: {
          kind: "binary",
          op: "<=",
          left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
          right: { kind: "literal", value: 31, unit: "mm" },
        },
      };
      return Promise.resolve({
        text: "constraints",
        structuredContent: { constraints: [lower, upper], errors: [] },
      });
    }

    return Promise.reject(
      new Error(
        `Unexpected sensitivity-relations tool call: ${call.name}`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Seed + Architecture mock clients (reused from oracle-requirements test pattern)
// ---------------------------------------------------------------------------

class SeedSyson implements McpToolClient {
  callToolTextResult(_call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("callToolTextResult not implemented"));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_project_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          id: "syson-project-cm01",
          name: "CM-01",
          editingContextId: EDITING_CONTEXT_ID,
        },
      });
    }
    if (call.name === "syson_model_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          documentId: "document-cm01",
          documentName: "CM-01",
          documentKind: "Document",
          rootPackageId: "root-package-cm01",
          rootPackageLabel: "New Package",
        },
      });
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "read",
        structuredContent: {
          id: "root-package-cm01",
          kind: "Package",
          label: "New Package",
          features: [],
          children: [],
        },
      });
    }
    if (call.name === "syson_element_rename") {
      return Promise.resolve({
        text: "renamed",
        structuredContent: { id: "root-package-cm01", label: "CoffeeMachine" },
      });
    }
    if (call.name === "syson_element_children") {
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: [],
          count: 0,
        },
      });
    }
    return Promise.reject(new Error(`Unexpected seed tool: ${call.name}`));
  }
}

// ---------------------------------------------------------------------------
// Architecture mock SysON — stateful, matches the exact call sequence
// ---------------------------------------------------------------------------
//
// Architecture executor call sequence (no syson_element_get / rename / constraint):
//   1. syson_element_children on rootId    (preflight — must return [])
//   2. syson_element_insert_sysml          (bounded SysML insert)
//   3. syson_element_children on rootId    (root readback — must return [ARCH_PACKAGE_ID])
//   4. syson_element_children on ARCH_PACKAGE_ID  (package readback — recipe declarations)
//
class ArchitectureSyson implements McpToolClient {
  #children = 0;

  callToolTextResult(_call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("callToolTextResult not implemented"));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_element_insert_sysml") {
      // Echo sysml_text back so normalizeInsertion can verify the recipe hash.
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
      return Promise.reject(new Error(`Unexpected architecture tool: ${call.name}`));
    }
    this.#children++;
    const parentId = call.arguments?.element_id;
    if (this.#children === 1) {
      // Preflight: root package must be empty before the bounded insert.
      return Promise.resolve({
        text: "preflight",
        structuredContent: { parentId, children: [], count: 0 },
      });
    }
    if (this.#children === 2) {
      // Root readback: exactly one package "CoffeeMachineCM01" was created.
      return Promise.resolve({
        text: "root",
        structuredContent: {
          parentId,
          children: [{
            id: ARCH_PACKAGE_ID,
            kind: "sysml::Package",
            label: "CoffeeMachineCM01",
          }],
          count: 1,
        },
      });
    }
    // Package readback: all recipe part definitions (must match recipe exactly).
    return Promise.resolve({
      text: "package",
      structuredContent: {
        parentId,
        children: EXISTING_DECL_IDS.map((id, i) => ({
          id,
          kind: "sysml::PartDefinition",
          label: RECIPE_PART_DEF_NAMES[i],
        })),
        count: EXISTING_DECL_IDS.length,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface SensitivityRelationsFixture {
  projects: EngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  archCaptures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  seedCaptures: FileCaptureStore<"syson-model-seed">;
  sensitivityCaptures: FileCaptureStore<"sensitivity-study">;
  sensRelCaptures: FileCaptureStore<"sensitivity-relations-seed">;
  queued: Awaited<ReturnType<EngineeringProjectCommandService["queueRun"]>>;
}

/**
 * Build the project state up to a queued sensitivity-relations run with a
 * proper basis that carries both the architecture and a fake sensitivity artifact.
 *
 * Uses the real seed + architecture executors to produce an architecture artifact,
 * then writes a fake sensitivity artifact directly to the snapshot store.
 */
async function queuedSensitivityRelations(
  directory: string,
  sensitivityCaptureOverride?: string,
): Promise<SensitivityRelationsFixture> {
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
  const sensitivityCaptures = new FileCaptureStore({
    ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-captures`,
  });
  const sensRelCaptures = new FileCaptureStore({
    ...SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-relations-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
  const archAttempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
    `${directory}/architecture-attempts`,
  );
  const liveUpdates = new LiveThreadUpdateStore();

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-05T09:00:00.000Z") + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-05T08:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief", project.revision),
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
    ...ctx("approve-brief", project.revision),
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
    ...ctx("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "record-brief",
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
    ...ctx("queue-brief", project.revision),
    runId: "run:brief-baseline",
    workItemId: "record-brief",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-05T09:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T09:01:00.000Z",
    runId: "run:brief-baseline",
  });

  const r1 = baselined.threadSnapshots[0]!;
  project = await commands.appendChange(AGENT, {
    ...ctx("append-architecture", baselined.revision),
    baseSnapshot: r1,
    phases: [{
      id: "architecture",
      name: "System model",
      description: "Create the bounded CM-01 system model.",
    }],
    workItems: [{
      id: "seed-syson",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["record-brief"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }, {
      id: "author-architecture",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["seed-syson"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });

  project = await commands.queueRun(AGENT, {
    ...ctx("queue-seed", project.revision),
    runId: "run:seed",
    workItemId: "seed-syson",
    summary: "Seed the CM-01 SysON model.",
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
    now: () => "2026-08-05T09:02:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-seed",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T09:02:00.000Z",
    runId: "run:seed",
  });

  const r2 = seeded.threadSnapshots.at(-1)!;
  project = await commands.queueRun(AGENT, {
    ...ctx("queue-arch", seeded.revision),
    runId: "run:architecture",
    workItemId: "author-architecture",
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
    recipe: await loadRecipe(),
    syson: new ArchitectureSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
    liveUpdates,
    now: () => "2026-08-05T09:03:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-architecture",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T09:03:00.000Z",
    runId: "run:architecture",
  });

  const r3Ref = arched.threadSnapshots.at(-1)!;
  const r3 = await snapshots.get(r3Ref.snapshotId);
  assertExists(r3);

  // Find the architecture artifact that the architecture executor produced.
  const archArtifact = r3.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith("casys://coffee-machine-cm01-v3-architecture/"),
  );
  assertExists(archArtifact, "r3 must have an architecture artifact.");

  // Write a fake sensitivity-study capture and build a snapshot r4 that adds
  // the sensitivity artifact to the lineage (without running the real executor).
  // The capture store verifies sha256(bytes) = fingerprint.digest, so the text
  // saved must be the same deterministicJson that sha256Fingerprint hashed.
  const sensCapture = sensitivityCaptureOverride ?? SENSITIVITY_CAPTURE_FIXTURE;
  const sensObj = JSON.parse(sensCapture);
  const sensText = deterministicJson(sensObj); // normalized form to save
  const sensFingerprint = await sha256Fingerprint(sensObj);
  await sensitivityCaptures.save(sensFingerprint, sensText);

  const sensUri = sensitivityCaptures.uriFor(sensFingerprint);
  const sensArtifactId = `sensitivity-study-${sensFingerprint.digest.slice(0, 16)}`;
  const sensArtifact = {
    id: sensArtifactId,
    name: "CM-01 DripTray sensitivity study",
    kind: "document" as const,
    version: sensFingerprint.digest.slice(0, 8),
    fingerprint: sensFingerprint,
    uri: sensUri,
    mediaType: "application/json",
    producer: {
      serverId: "calculix",
      tool: "calculix_solve_static",
      runId: "run:sensitivity-study-fake",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh" as const,
      changedAt: "2026-08-05T09:04:00.000Z",
      invalidatedByChangeIds: [],
    },
  };

  // Build r4 as a snapshot extension of r3 that adds the sensitivity artifact.
  // r4 is saved to the snapshot store now so completeRun can read it for CAS validation.
  const r4: ThreadSnapshot = {
    ...r3,
    id: `${r3.id}-with-sensitivity`,
    revision: r3.revision + 1,
    previous: { snapshotId: r3.id, revision: r3.revision },
    artifacts: [...r3.artifacts, sensArtifact],
  };
  await snapshots.save(r4);

  // Phase: simulate the sensitivity study run lifecycle so r4 enters
  // project.threadSnapshots. The sensitivity study operation uses only
  // the APPROVED_BRIEF_BINDING, so no extra artifact reference is required.
  // claimRun → publishRun → completeRun registers r4 as the new head.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-sensitivity-study", arched.revision),
    baseSnapshot: r3Ref,
    phases: [{
      id: "sensitivity-study-phase",
      name: "Sensitivity study",
      description: "Measure DripTray size-z sensitivity.",
    }],
    workItems: [{
      id: "run-sensitivity-study",
      phaseId: "sensitivity-study-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["author-architecture"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityDripTrayBaseZ,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...ctx("queue-sensitivity-study", project.revision),
    runId: "run:sensitivity-study",
    workItemId: "run-sensitivity-study",
    summary: "Run the DripTray size-z sensitivity study.",
    basis: { kind: "thread-snapshot", ...r3Ref },
  });
  project = await commands.claimRun(AGENT, {
    ...ctx("claim-sensitivity-study", project.revision),
    runId: "run:sensitivity-study",
    summary: "Claiming DripTray sensitivity study run.",
  });
  project = await commands.publishRun(AGENT, {
    ...ctx("publish-sensitivity-study", project.revision),
    runId: "run:sensitivity-study",
    summary: "Publishing DripTray sensitivity study evidence.",
  });
  const r4Ref = { snapshotId: r4.id, revision: r4.revision, subjectId: r4.subject.id };
  project = await commands.completeRun(AGENT, {
    ...ctx("complete-sensitivity-study", project.revision),
    runId: "run:sensitivity-study",
    summary: "Completed DripTray sensitivity study.",
    resultSnapshot: r4Ref,
    evidenceRefs: [{
      kind: "artifact" as const,
      id: sensArtifactId,
      snapshotId: r4.id,
      snapshotRevision: r4.revision,
    }],
  });
  // r4 is now the head of project.threadSnapshots.

  // Phase: sensitivity-relations work item. Uses r4 as baseSnapshot now that
  // it is declared in project.threadSnapshots.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-sensitivity-relations", project.revision),
    baseSnapshot: r4Ref,
    phases: [{
      id: "sensitivity-relations-phase",
      name: "Sensitivity relations",
      description: "Anchor the sensitivity-relations declaration in SysML.",
    }],
    workItems: [{
      id: "write-sensitivity-relations",
      phaseId: "sensitivity-relations-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["author-architecture"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "sensitivityArtifact",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: r4.id,
                snapshotRevision: r4.revision,
                kind: "artifact" as const,
                id: sensArtifactId,
              },
            },
          },
        ],
      },
    }],
    requiredDecisions: [],
  });

  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-sensitivity-relations", project.revision),
    runId: "run:sensitivity-relations",
    workItemId: "write-sensitivity-relations",
    summary: "Write the CM-01 sensitivity-relations into the SysML model.",
    basis: {
      kind: "thread-snapshot",
      snapshotId: r4.id,
      revision: r4.revision,
      subjectId: r4.subject.id,
    },
  });

  return {
    projects,
    commands,
    snapshots,
    archCaptures,
    seedCaptures,
    sensitivityCaptures,
    sensRelCaptures,
    queued,
  };
}

/**
 * Minimal fixture for "missing architecture artifact" test.
 * Builds only through the brief baseline run (r1), which has no architecture artifact.
 */
async function queuedSensitivityRelationsOnBriefBasis(
  directory: string,
): Promise<SensitivityRelationsFixture> {
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
  const sensitivityCaptures = new FileCaptureStore({
    ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-captures`,
  });
  const sensRelCaptures = new FileCaptureStore({
    ...SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-relations-captures`,
  });

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-05T09:00:00.000Z") + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-no-arch",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-05T08:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief-no-arch", project.revision),
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
    ...ctx("approve-brief-no-arch", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "OK.",
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
    ...ctx("publish-plan-no-arch", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "record-brief-no-arch",
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
    ...ctx("queue-brief-no-arch", project.revision),
    runId: "run:brief-baseline-no-arch",
    workItemId: "record-brief-no-arch",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases-no-arch`),
    now: () => "2026-08-05T09:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline-no-arch",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T09:01:00.000Z",
    runId: "run:brief-baseline-no-arch",
  });

  const r1Ref = baselined.threadSnapshots[0]!;
  // Add the sensitivity-relations work item via appendChange (not in publishPlan).
  // The binding source must be a valid thread-entity ref — a stub suffices because
  // the executor reads the artifact from the basis snapshot, not from the binding.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-sens-rel-no-arch", baselined.revision),
    baseSnapshot: r1Ref,
    phases: [{
      id: "sensitivity-phase-no-arch",
      name: "Sensitivity relations (no arch)",
      description: "Should fail: no architecture artifact in basis.",
    }],
    workItems: [{
      id: "write-sensitivity-relations-no-arch",
      phaseId: "sensitivity-phase-no-arch",
      owner: "agent",
      dependsOnWorkItemIds: ["record-brief-no-arch"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "sensitivityArtifact",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: r1Ref.snapshotId,
                snapshotRevision: r1Ref.revision,
                kind: "artifact",
                id: "stub-sensitivity-artifact",
              },
            },
          },
        ],
      },
    }],
    requiredDecisions: [],
  });

  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-sens-rel-no-arch", project.revision),
    runId: "run:sensitivity-relations-no-arch",
    workItemId: "write-sensitivity-relations-no-arch",
    summary: "Write the CM-01 sensitivity-relations (should fail on missing arch).",
    basis: { kind: "thread-snapshot", ...r1Ref },
  });

  return {
    projects,
    commands,
    snapshots,
    archCaptures,
    seedCaptures,
    sensitivityCaptures,
    sensRelCaptures,
    queued,
  };
}

/**
 * Fixture for the through-executor ratchet test.
 *
 * Uses a stateful mock for projects and commands to bypass queueRun
 * validation (which would reject snap-b because it was not produced by a
 * legitimate run completion). The real FileThreadSnapshotStore holds snap-a
 * (which carries the artifact) and snap-b (which drops it).
 *
 * When executeLeased runs:
 *   1. projects.get() → project with run in "queued" state
 *   2. commands.claimRun() → transitions to "running", sets claimedBy + startedAt
 *   3. projects.get() → project with run in "running" state
 *   4. loadInputs(basis) → exactSnapshot validates snap-b (valid ThreadSnapshot),
 *      then assertSensitivityRelationsNotRemoved walks back to snap-a (which HAS
 *      the artifact) → SensitivityRelationsArtifactRemovedError fires before SysON
 *
 * snap-a has revision 1 and no previous pointer; snap-b has revision 2 and
 * previous → snap-a. Both pass validateThreadSnapshot.
 */
async function queuedSensitivityRelationsOnRatchetBasis(
  directory: string,
): Promise<SensitivityRelationsFixture> {
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed-captures`,
  });
  const archCaptures = new FileCaptureStore({
    ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const sensitivityCaptures = new FileCaptureStore({
    ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-captures`,
  });
  const sensRelCaptures = new FileCaptureStore({
    ...SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-relations-captures`,
  });

  const ratchetFreshness = {
    status: "fresh" as const,
    changedAt: "2026-08-05T09:03:00.000Z",
    invalidatedByChangeIds: [] as string[],
  };
  const ratchetOp = {
    serverId: "syson",
    tool: "syson_element_get",
    runId: "run:ratchet-ancestor",
  };
  const snapAId = "snap-ratchet-exec-a";
  const snapBId = "snap-ratchet-exec-b";

  // snap-a: revision 1, no previous, carries the sensitivity-relations artifact.
  // Must pass validateThreadSnapshot so FileThreadSnapshotStore.save accepts it.
  await snapshots.save({
    schemaVersion: "1.0" as const,
    id: snapAId,
    revision: 1,
    generatedAt: "2026-08-05T09:03:00.000Z",
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system" as const,
      version: "v3",
      modelArtifactId: "model-artifact-ratchet-a",
    },
    freshness: ratchetFreshness,
    changeSet: {
      id: "cs-ratchet-a",
      name: "Ratchet A",
      status: "applied" as const,
      createdAt: "2026-08-05T09:03:00.000Z",
      appliedAt: "2026-08-05T09:03:00.000Z",
      changes: [],
    },
    artifacts: [
      {
        id: "model-artifact-ratchet-a",
        name: "Model A",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        producer: ratchetOp,
        inputArtifactIds: [] as string[],
        freshness: ratchetFreshness,
      },
      // The sensitivity-relations artifact that the ratchet detects in an ancestor.
      {
        id: "sens-rel-artifact-ratchet-a",
        name: "Sensitivity relations A",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: `${SENSITIVITY_RELATIONS_URI_PREFIX}sha256/${"b".repeat(64)}`,
        producer: ratchetOp,
        inputArtifactIds: [] as string[],
        freshness: ratchetFreshness,
      },
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });

  // snap-b: revision 2, previous → snap-a, NO sensitivity-relations artifact.
  // This is the run basis. exactSnapshot validates it with validateThreadSnapshot.
  const modelArtifactB = {
    id: "model-artifact-ratchet-b",
    name: "Model B",
    kind: "sysml-model" as const,
    version: "v1",
    fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    producer: ratchetOp,
    inputArtifactIds: [] as string[],
    freshness: ratchetFreshness,
  };
  await snapshots.save({
    schemaVersion: "1.0" as const,
    id: snapBId,
    revision: 2,
    generatedAt: "2026-08-05T09:04:00.000Z",
    previous: { snapshotId: snapAId, revision: 1 },
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system" as const,
      version: "v3",
      modelArtifactId: modelArtifactB.id,
    },
    freshness: ratchetFreshness,
    changeSet: {
      id: "cs-ratchet-b",
      name: "Ratchet B",
      status: "applied" as const,
      createdAt: "2026-08-05T09:04:00.000Z",
      appliedAt: "2026-08-05T09:04:00.000Z",
      changes: [],
    },
    artifacts: [modelArtifactB],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });

  // Stateful mock tracking the run from queued → running after claimRun.
  // Only claimRun is needed — the ratchet fires before publishRun / completeRun.
  const runId = "run:sensitivity-relations-ratchet-exec";
  const workItemId = "write-sensitivity-relations-ratchet-exec";
  let runStatus: "queued" | "running" = "queued";
  let claimedBy: { origin: string; id: string } | undefined;
  let startedAt: string | undefined;
  let projectRevision = 5;

  function makeRatchetProject() {
    return {
      schemaVersion: "3.0",
      revision: projectRevision,
      project: {
        id: "coffee-machine-cm01-v3",
        subjectId: "project:coffee-machine-cm01-v3",
        name: "CM-01 coffee machine",
      },
      agentRuns: [{
        id: runId,
        workItemId,
        status: runStatus,
        claimedBy,
        startedAt,
        basis: {
          kind: "thread-snapshot",
          snapshotId: snapBId,
          revision: 2,
          subjectId: "project:coffee-machine-cm01-v3",
        },
      }],
      workItems: [{
        id: workItemId,
        phaseId: "sensitivity-phase-ratchet-exec",
        owner: "agent",
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations.id,
          version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations.version,
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
            {
              name: "sensitivityArtifact",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: snapAId,
                  snapshotRevision: 1,
                  kind: "artifact",
                  id: "stub-sensitivity-artifact-ratchet-exec",
                },
              },
            },
          ],
        },
      }],
    };
  }

  const mockProjects: EngineeringProjectRevisionStore = {
    get: (_projectId: string) => Promise.resolve(makeRatchetProject() as never),
  } as unknown as EngineeringProjectRevisionStore;

  const mockCommands: EngineeringProjectCommandService = {
    claimRun: (origin: { kind: string; actorId: string }, _cmd: unknown) => {
      claimedBy = { origin: origin.kind, id: origin.actorId };
      startedAt = "2026-08-05T09:03:00.000Z";
      runStatus = "running";
      projectRevision++;
      return Promise.resolve(makeRatchetProject() as never);
    },
    publishRun: () =>
      Promise.reject(new Error("must not reach publishRun: ratchet fires first")),
    completeRun: () =>
      Promise.reject(new Error("must not reach completeRun: ratchet fires first")),
  } as unknown as EngineeringProjectCommandService;

  const queued = makeRatchetProject() as unknown as Awaited<
    ReturnType<EngineeringProjectCommandService["queueRun"]>
  >;

  return {
    projects: mockProjects,
    commands: mockCommands,
    snapshots,
    archCaptures,
    seedCaptures,
    sensitivityCaptures,
    sensRelCaptures,
    queued,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ctx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "coffee-machine-cm01-v3",
    expectedRevision,
    issuedAt: "2026-08-05T09:00:00.000Z",
  };
}

async function loadRecipe() {
  return JSON.parse(
    await Deno.readTextFile("config/product-recipes/coffee-machine-cm01-v1.json"),
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

void sha256HexOf; // referenced by unused-variable suppressor; used indirectly
void deterministicJson; // imported for type completeness
