/**
 * Tests for the CM-01 sensitivity-edges anchoring executor (@2).
 *
 * Coverage:
 *  - Human-origin rejection (no I/O touched)
 *  - Non-canonical shape rejection (wrong operation id/version, no provider call)
 *  - Ratchet: assertSensitivityEdgesNotRemoved fires when ancestor had the artifact
 *  - Missing architecture artifact → invalid_input before provider call
 *  - Happy path: inserts DripTraySensitivityEdges, verifies re-extraction (4 constraints,
 *    4 attrs), publishes a valid snapshot through validateThreadSnapshot
 *  - Unknown metric in sensitivity capture → invalid_input before provider call
 *  - Idempotent replay: same command reuses WAL result without re-inserting
 *
 * Key differences from the @1 test (sensitivity-relations):
 *  - Operation: sensitivityRelationsV2 (version "2") not sensitivityRelations (version "1")
 *  - Element label: DripTraySensitivityEdges not DripTraySensitivityRelations
 *  - URI prefix: casys://sensitivity-edges-seed-capture/
 *  - SysON mock returns 4 constraints (2 per edge × 2 edges) and 4 attrs
 *  - SERVER_FIXED_EDGE_TEMPLATES attribute names differ from METRIC_TO_ATTR_NAME
 *    (@1 mapped metric → 1 string; @2 maps metric → full SensitivityEdgeTemplate)
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
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../file-engineering-project-run-lease.ts";
import { FileSensitivityRelationsAttemptStore } from "../file-sensitivity-relations-attempt-store.ts";
import { FileThreadSnapshotStore } from "../file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
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
  assertSensitivityEdgesNotRemoved,
  CoffeeMachineCm01V3SensitivityEdgesRunExecutor,
  findSensitivityEdgesArtifact,
  SENSITIVITY_EDGES_URI_PREFIX,
  SensitivityEdgesArtifactRemovedError,
} from "./coffee-machine-cm01-v3-sensitivity-edges-run-executor.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

const EDITING_CONTEXT_ID = "editing-context-edges-456";
const ARCH_PACKAGE_ID = "architecture-package-edges-001";
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
const EXISTING_DECL_IDS = RECIPE_PART_DEF_NAMES.map((_, i) => `edges-definition-${i}`);
const NEW_ELEMENT_ID = "sensitivity-edges-element-001";

// Sensitivity capture used by the happy-path fixture.
// domain and derivatives match SERVER_FIXED_EDGE_TEMPLATES exactly.
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
  capturedAt: "2026-08-05T09:43:39.000Z",
});

// ---------------------------------------------------------------------------
// Ratchet — assertSensitivityEdgesNotRemoved (unit)
// ---------------------------------------------------------------------------

Deno.test(
  "assertSensitivityEdgesNotRemoved raises when an ancestor carried the sensitivity-edges artifact but the current basis does not",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-edges-ratchet-",
    });
    try {
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const freshness = {
        status: "fresh" as const,
        changedAt: "2026-08-05T10:00:00.000Z",
        invalidatedByChangeIds: [],
      };
      const operation = {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:edges-ratchet-test",
      };
      const changeSet = {
        id: "changeset-edges-ratchet",
        name: "Edges ratchet test",
        status: "applied" as const,
        createdAt: "2026-08-05T10:00:00.000Z",
        appliedAt: "2026-08-05T10:00:00.000Z",
        changes: [],
      };
      const subject = {
        id: "project:coffee-machine-cm01-v3",
        name: "CM-01",
        kind: "system" as const,
        version: "v3",
        modelArtifactId: "base-artifact-edges-ratchet",
      };
      const baseArtifact = {
        id: "base-artifact-edges-ratchet",
        name: "Base model",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const edgesArtifact = {
        id: "sens-edges-artifact-ratchet",
        name: "Sensitivity edges",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: `${SENSITIVITY_EDGES_URI_PREFIX}sha256/${"b".repeat(64)}`,
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const minimalBase = {
        schemaVersion: "1.0" as const,
        generatedAt: "2026-08-05T10:00:00.000Z",
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
        id: "snap-edges-ratchet-1",
        revision: 1,
        artifacts: [baseArtifact],
      };
      const s2: ThreadSnapshot = {
        ...minimalBase,
        id: "snap-edges-ratchet-2",
        revision: 2,
        previous: { snapshotId: "snap-edges-ratchet-1", revision: 1 },
        artifacts: [baseArtifact, edgesArtifact],
      };
      const s3: ThreadSnapshot = {
        ...minimalBase,
        id: "snap-edges-ratchet-3",
        revision: 3,
        previous: { snapshotId: "snap-edges-ratchet-2", revision: 2 },
        artifacts: [baseArtifact], // dropped sensitivity-edges artifact
      };

      await snapshots.save(s1);
      await snapshots.save(s2);

      await assertRejects(
        () => assertSensitivityEdgesNotRemoved(s3, snapshots),
        SensitivityEdgesArtifactRemovedError,
        "previously carried a sensitivity-edges artifact",
      );

      // s2 itself has the artifact — no error.
      await assertSensitivityEdgesNotRemoved(s2, snapshots);

      // s1 has no artifact and no ancestor — no error.
      await assertSensitivityEdgesNotRemoved(s1, snapshots);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Ratchet — through executor path
// ---------------------------------------------------------------------------
//
// Verifies that `assertSensitivityEdgesNotRemoved` is called inside executeLeased.
// Removing it from loadInputs must make this test fail.

Deno.test(
  "CM-01 sensitivity-edges executor stops with SensitivityEdgesArtifactRemovedError before any SysON call when the basis ancestor carried the artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-edges-ratchet-thru-exec-",
    });
    try {
      const fixture = await queuedSensitivityEdgesOnRatchetBasis(directory);

      let sysonCalled = false;
      const executor = new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityEdgesCaptures: fixture.sensitivityEdgesCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/edges-attempts-ratchet-exec`,
        ),
        syson: {
          callTool: () => {
            sysonCalled = true;
            return Promise.reject(
              new Error("SysON must not be called: ratchet should fire first"),
            );
          },
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/edges-leases-ratchet-exec`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-edges-ratchet-exec",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T10:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        SensitivityEdgesArtifactRemovedError,
        "previously carried a sensitivity-edges artifact",
      );

      assertEquals(
        sysonCalled,
        false,
        "SysON must not be reached: the ratchet fires before the provider call.",
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
  "CM-01 sensitivity-edges executor rejects a human before any store access",
  async () => {
    const executor = new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      architectureCaptures: {} as never,
      seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
      sensitivityCaptures: {} as never,
      sensitivityEdgesCaptures: {} as never,
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
          commandId: "human-cmd-edges",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: 1,
          issuedAt: "2026-08-05T10:00:00.000Z",
          runId: "run:sens-edges",
        }),
      Error,
      "Only an authenticated agent",
    );
  },
);

// ---------------------------------------------------------------------------
// Non-canonical shape rejection — @1 operation version rejected by @2 executor
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-edges executor rejects the @1 operation version before any provider call",
  async () => {
    let providerCalled = false;
    const executor = new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: {
              id: "coffee-machine-cm01-v3",
              subjectId: "project:coffee-machine-cm01-v3",
            },
            agentRuns: [{
              id: "run:sens-edges",
              workItemId: "write-sens-edges",
              basis: { kind: "thread-snapshot" },
            }],
            workItems: [{
              id: "write-sens-edges",
              operation: {
                // @1 operation — version "1", must be rejected by the @2 executor.
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
      sensitivityEdgesCaptures: {} as never,
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
          commandId: "agent-cmd-edges-wrong-version",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: 1,
          issuedAt: "2026-08-05T10:00:00.000Z",
          runId: "run:sens-edges",
        }),
      Error,
      "canonical CM-01 V3 sensitivity-edges @2",
    );
    assertEquals(providerCalled, false);
  },
);

// ---------------------------------------------------------------------------
// Missing architecture artifact
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-edges executor fails with invalid_input when the basis has no architecture artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-edges-no-arch-",
    });
    try {
      const fixture = await queuedSensitivityEdgesOnBriefBasis(directory);
      const executor = new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityEdgesCaptures: fixture.sensitivityEdgesCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/edges-attempts-no-arch`,
        ),
        syson: {
          callTool: () =>
            Promise.reject(new Error("must not call provider before input error")),
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/edges-leases-no-arch`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-edges-no-arch",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T10:00:00.000Z",
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
// Unknown metric in sensitivity capture
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-edges executor fails with invalid_input when the sensitivity capture has an unknown metric",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-edges-unknown-metric-",
    });
    try {
      const badCapture = JSON.stringify({
        schemaVersion: "sensitivity-study-capture/1.0",
        derivatives: [
          { metric: "unknown_metric_id", value: -0.008, unit: "mm/mm" },
        ],
        domain: { base: 30, step: 1, parameterUnit: "mm" },
        capturedAt: "2026-08-05T10:00:00.000Z",
      });
      const fixture = await queuedSensitivityEdges(directory, badCapture);

      const executor = new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityEdgesCaptures: fixture.sensitivityEdgesCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/edges-attempts-unknown-metric`,
        ),
        syson: {
          callTool: () =>
            Promise.reject(new Error("must not call provider before input error")),
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/edges-leases-unknown-metric`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-edges-unknown-metric",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-05T10:00:00.000Z",
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
// Happy path
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 sensitivity-edges executor inserts the DripTraySensitivityEdges element and publishes a valid snapshot",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-sens-edges-happy-",
    });
    try {
      const fixture = await queuedSensitivityEdges(directory);
      const syson = new SensitivityEdgesSyson({
        architecturePackageId: ARCH_PACKAGE_ID,
        declarationIds: EXISTING_DECL_IDS,
        editingContextId: EDITING_CONTEXT_ID,
        newElementId: NEW_ELEMENT_ID,
      });

      const executor = new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        sensitivityCaptures: fixture.sensitivityCaptures,
        sensitivityEdgesCaptures: fixture.sensitivityEdgesCaptures,
        attempts: new FileSensitivityRelationsAttemptStore(
          `${directory}/edges-attempts`,
        ),
        syson,
        lease: new FileEngineeringProjectRunLease(`${directory}/edges-leases`),
        now: () => "2026-08-05T10:00:00.000Z",
      });

      const completed = await executor.execute(
        AGENT,
        {
          commandId: "agent-sens-edges-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: fixture.queued.revision,
          issuedAt: "2026-08-05T10:00:00.000Z",
          runId: fixture.queued.agentRuns.at(-1)!.id,
        },
      );

      const run = completed.agentRuns.at(-1)!;
      assertEquals(run.status, "completed");

      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot);

      // Full domain validation — not just in-memory inspection.
      validateThreadSnapshot(snapshot);

      const edgesArtifact = findSensitivityEdgesArtifact(snapshot);
      assertExists(
        edgesArtifact,
        "Snapshot must carry the sensitivity-edges artifact.",
      );
      assertEquals(edgesArtifact.fingerprint.algorithm, "sha256");
      assertEquals(
        typeof edgesArtifact.uri === "string" &&
          edgesArtifact.uri.startsWith(SENSITIVITY_EDGES_URI_PREFIX),
        true,
        `Artifact URI must start with "${SENSITIVITY_EDGES_URI_PREFIX}".`,
      );

      // SysON call sequence:
      //   1. syson_element_children on archPackageId (preflight — adoption guard)
      //   2. syson_element_insert_sysml
      //   3. syson_element_children on archPackageId (identification by DripTraySensitivityEdges)
      //   4. syson_constraint_extract on newElementId (4 constraints, phase 1)
      //   5. syson_element_children on newElementId (4 attrs, phase 2)
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
          commandId: "agent-sens-edges-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: completed.revision,
          issuedAt: "2026-08-05T10:00:00.000Z",
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
// Mock SysON client for sensitivity-edges tests
// ---------------------------------------------------------------------------
//
// WHY 4 CONSTRAINTS — the @2 executor inserts DripTraySensitivityEdges with 2
// edges × 2 bounds each = 4 constraints. The @1 mock returned only 2 (1 param
// axis × 2 bounds). The constraint names and featurePaths reflect the server-
// fixed attribute names from SERVER_FIXED_EDGE_TEMPLATES.

interface SensitivityEdgesSysonOptions {
  architecturePackageId: string;
  declarationIds: readonly string[];
  editingContextId: string;
  newElementId: string;
  /** If set, tamperedConstraintName constraint returns this bound instead of 29. */
  tamperedBoundValue?: number;
  tamperedConstraintName?: string;
}

class SensitivityEdgesSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #opts: SensitivityEdgesSysonOptions;
  #inserted = false;

  constructor(opts: SensitivityEdgesSysonOptions) {
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
          text: call.arguments?.sysml_text,
        },
      });
    }

    if (call.name === "syson_element_children") {
      // Element-level children for re-extraction phase 2.
      if (call.arguments?.element_id === this.#opts.newElementId) {
        return Promise.resolve({
          text: "children",
          structuredContent: {
            parentId: call.arguments.element_id,
            children: [
              {
                id: "edge-attr-a1",
                kind: "AttributeUsage",
                label: "sizeZ_for_assembly_max_displacement",
              },
              {
                id: "edge-attr-a2",
                kind: "AttributeUsage",
                label: "sizeZ_for_assembly_max_von_mises",
              },
              {
                id: "edge-attr-a3",
                kind: "AttributeUsage",
                label: "d_assembly_max_displacement_mm_per_mm",
              },
              {
                id: "edge-attr-a4",
                kind: "AttributeUsage",
                label: "d_assembly_max_von_mises_MPa_per_mm",
              },
            ],
            count: 4,
          },
        });
      }

      // Package-level children for preflight + identification.
      const knownChildren = this.#opts.declarationIds.map((id, i) => ({
        id,
        kind: "sysml::PartDefinition",
        label: RECIPE_PART_DEF_NAMES[i],
      }));

      let allChildren: { id: string; kind: string; label: string }[];
      if (this.#inserted) {
        allChildren = [
          ...knownChildren,
          {
            id: this.#opts.newElementId,
            kind: "sysml::PartDefinition",
            label: "DripTraySensitivityEdges",
          },
        ];
      } else {
        // Preflight: no DripTraySensitivityEdges yet.
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
      // 4 constraints: 2 per edge × 2 edges.
      // featurePath[0] = driver.sysmlAttrName from SERVER_FIXED_EDGE_TEMPLATES.
      const lower1 = {
        id: "uuid-lower-disp",
        name: "assembly_max_displacement_validity_lower",
        expression: {
          kind: "binary",
          op: ">=",
          left: {
            kind: "ref",
            featurePath: ["sizeZ_for_assembly_max_displacement"],
          },
          right: {
            kind: "literal",
            value: this.#opts.tamperedConstraintName ===
                "assembly_max_displacement_validity_lower"
              ? (this.#opts.tamperedBoundValue ?? 29)
              : 29,
            unit: "mm",
          },
        },
      };
      const upper1 = {
        id: "uuid-upper-disp",
        name: "assembly_max_displacement_validity_upper",
        expression: {
          kind: "binary",
          op: "<=",
          left: {
            kind: "ref",
            featurePath: ["sizeZ_for_assembly_max_displacement"],
          },
          right: { kind: "literal", value: 31, unit: "mm" },
        },
      };
      const lower2 = {
        id: "uuid-lower-vm",
        name: "assembly_max_von_mises_validity_lower",
        expression: {
          kind: "binary",
          op: ">=",
          left: {
            kind: "ref",
            featurePath: ["sizeZ_for_assembly_max_von_mises"],
          },
          right: {
            kind: "literal",
            value: this.#opts.tamperedConstraintName ===
                "assembly_max_von_mises_validity_lower"
              ? (this.#opts.tamperedBoundValue ?? 29)
              : 29,
            unit: "mm",
          },
        },
      };
      const upper2 = {
        id: "uuid-upper-vm",
        name: "assembly_max_von_mises_validity_upper",
        expression: {
          kind: "binary",
          op: "<=",
          left: {
            kind: "ref",
            featurePath: ["sizeZ_for_assembly_max_von_mises"],
          },
          right: { kind: "literal", value: 31, unit: "mm" },
        },
      };
      return Promise.resolve({
        text: "constraints",
        structuredContent: {
          constraints: [lower1, upper1, lower2, upper2],
          errors: [],
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected sensitivity-edges tool call: ${call.name}`),
    );
  }
}

// ---------------------------------------------------------------------------
// Seed + Architecture mock SysON clients (same pattern as @1 test)
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
          id: "syson-project-cm01-edges",
          name: "CM-01",
          editingContextId: EDITING_CONTEXT_ID,
        },
      });
    }
    if (call.name === "syson_model_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          documentId: "document-cm01-edges",
          documentName: "CM-01",
          documentKind: "Document",
          rootPackageId: "root-package-cm01-edges",
          rootPackageLabel: "New Package",
        },
      });
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "read",
        structuredContent: {
          id: "root-package-cm01-edges",
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
        structuredContent: {
          id: "root-package-cm01-edges",
          label: "CoffeeMachine",
        },
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

class ArchitectureSyson implements McpToolClient {
  #children = 0;

  callToolTextResult(_call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("callToolTextResult not implemented"));
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
      return Promise.reject(
        new Error(`Unexpected architecture tool: ${call.name}`),
      );
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
            id: ARCH_PACKAGE_ID,
            kind: "sysml::Package",
            label: "CoffeeMachineCM01",
          }],
          count: 1,
        },
      });
    }
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
// Fixture types
// ---------------------------------------------------------------------------

interface SensitivityEdgesFixture {
  projects: EngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  archCaptures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  seedCaptures: FileCaptureStore<"syson-model-seed">;
  sensitivityCaptures: FileCaptureStore<"sensitivity-study">;
  sensitivityEdgesCaptures: FileCaptureStore<"sensitivity-edges-seed">;
  queued: Awaited<ReturnType<EngineeringProjectCommandService["queueRun"]>>;
}

// ---------------------------------------------------------------------------
// Fixture helper: happy path + unknown metric
//
// WHY MOCK COMMANDS — sensitivityRelationsV2 (@2) was planning-only when this
// suite was written, so EngineeringProjectCommandService.queueRun rejected it at
// assertRegisteredQueueOperation. The mocks are kept after the 2026-08-05
// consent flip to trusted: they isolate the executor from command-service
// concerns, which is what these tests are about. The real brief → seed →
// architecture chain still runs to produce real CAS captures.
// ---------------------------------------------------------------------------

async function queuedSensitivityEdges(
  directory: string,
  sensitivityCaptureOverride?: string,
): Promise<SensitivityEdgesFixture> {
  // Separate projects store for the real trusted executor chain (not exposed to executor).
  const realProjects = new FileEngineeringProjectRevisionStore(
    `${directory}/projects`,
  );
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
  const sensitivityEdgesCaptures = new FileCaptureStore({
    ...SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-edges-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(
    `${directory}/seed-attempts`,
  );
  const archAttempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
    `${directory}/architecture-attempts`,
  );
  const liveUpdates = new LiveThreadUpdateStore();

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-05T10:00:00.000Z") + ++tick * 1_000).toISOString();

  // Run brief → seed → architecture via trusted operations (real commands are fine here).
  const briefs = new ProjectBriefCommandService(realProjects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-edges",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-05T09:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief-edges", project.revision),
    items: [
      {
        id: "objective",
        kind: "objective",
        statement: "Create a reviewable CM-01 coffee-machine engineering record.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement:
          "Represent the reviewed CM-01 machine boundaries in one system model.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
      },
      {
        id: "success",
        kind: "success-criterion",
        statement: "Capture a traceable SysON architecture read-back.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
      },
    ],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-brief-edges", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 architecture record is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const realCommands = new EngineeringProjectCommandService(
    realProjects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );

  project = await realCommands.publishPlan(AGENT, {
    ...ctx("publish-plan-edges", project.revision),
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

  project = await realCommands.queueRun(AGENT, {
    ...ctx("queue-brief-edges", project.revision),
    runId: "run:brief-baseline-edges",
    workItemId: "record-brief",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects: realProjects,
    commands: realCommands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-05T10:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline-edges",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T10:01:00.000Z",
    runId: "run:brief-baseline-edges",
  });

  const r1 = baselined.threadSnapshots[0]!;
  project = await realCommands.appendChange(AGENT, {
    ...ctx("append-arch-edges", baselined.revision),
    baseSnapshot: r1,
    phases: [{
      id: "architecture",
      name: "System model",
      description: "Create the bounded CM-01 system model.",
    }],
    workItems: [
      {
        id: "seed-syson",
        phaseId: "architecture",
        owner: "agent",
        dependsOnWorkItemIds: ["record-brief"],
        decisionIds: [],
        operation: {
          ...SYSON_MODEL_SEED_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      },
      {
        id: "author-architecture",
        phaseId: "architecture",
        owner: "agent",
        dependsOnWorkItemIds: ["seed-syson"],
        decisionIds: [],
        operation: {
          ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      },
    ],
    requiredDecisions: [],
  });

  project = await realCommands.queueRun(AGENT, {
    ...ctx("queue-seed-edges", project.revision),
    runId: "run:seed-edges",
    workItemId: "seed-syson",
    summary: "Seed the CM-01 SysON model.",
    basis: { kind: "thread-snapshot", ...r1 },
  });
  const seeded = await new SysonModelSeedRunExecutor({
    projects: realProjects,
    commands: realCommands,
    snapshots,
    captures: seedCaptures,
    attempts: seedAttempts,
    syson: new SeedSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/seed-leases`),
    now: () => "2026-08-05T10:02:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-seed-edges",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T10:02:00.000Z",
    runId: "run:seed-edges",
  });

  const r2 = seeded.threadSnapshots.at(-1)!;
  project = await realCommands.queueRun(AGENT, {
    ...ctx("queue-arch-edges", seeded.revision),
    runId: "run:architecture-edges",
    workItemId: "author-architecture",
    summary: "Author the reviewed CM-01 architecture.",
    basis: { kind: "thread-snapshot", ...r2 },
  });
  const arched = await new CoffeeMachineCm01V3ArchitectureRunExecutor({
    projects: realProjects,
    commands: realCommands,
    snapshots,
    seedCaptures,
    captures: archCaptures,
    attempts: archAttempts,
    recipe: await loadRecipe(),
    syson: new ArchitectureSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
    liveUpdates,
    now: () => "2026-08-05T10:03:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-architecture-edges",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-05T10:03:00.000Z",
    runId: "run:architecture-edges",
  });

  const r3Ref = arched.threadSnapshots.at(-1)!;
  const r3 = await snapshots.get(r3Ref.snapshotId);
  assertExists(r3);

  const archArtifact = r3.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith("casys://coffee-machine-cm01-v3-architecture/"),
  );
  assertExists(archArtifact, "r3 must have an architecture artifact.");

  // Write a fake sensitivity-study capture and build snapshot r4.
  const sensCapture = sensitivityCaptureOverride ?? SENSITIVITY_CAPTURE_FIXTURE;
  const sensObj = JSON.parse(sensCapture);
  const sensText = deterministicJson(sensObj);
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
      runId: "run:sensitivity-study-edges-fake",
    },
    inputArtifactIds: [] as string[],
    freshness: {
      status: "fresh" as const,
      changedAt: "2026-08-05T10:04:00.000Z",
      invalidatedByChangeIds: [] as string[],
    },
  };

  // r4 = r3 + sensitivity artifact. The @2 executor reads basis from the snapshot
  // store using the snapshot ID in the mock project's run.basis.snapshotId.
  const r4: ThreadSnapshot = {
    ...r3,
    id: `${r3.id}-with-sensitivity-edges`,
    revision: r3.revision + 1,
    previous: { snapshotId: r3.id, revision: r3.revision },
    artifacts: [...r3.artifacts, sensArtifact],
  };
  await snapshots.save(r4);

  // Switch to mock projects + commands: they isolate the executor from
  // command-service concerns (see the WHY MOCK COMMANDS note above).
  return mockSensEdgesFixture({
    snapshots,
    archCaptures,
    seedCaptures,
    sensitivityCaptures,
    sensitivityEdgesCaptures,
    basisSnapshot: r4,
    sensArtifactId,
  });
}

// ---------------------------------------------------------------------------
// Fixture helper: no architecture artifact
//
// The executor fails before any capture read, so no real executors are needed.
// A minimal brief-only snapshot is created manually; the mock project's run
// basis points to it.
// ---------------------------------------------------------------------------

async function queuedSensitivityEdgesOnBriefBasis(
  directory: string,
): Promise<SensitivityEdgesFixture> {
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const archCaptures = new FileCaptureStore({
    ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed-captures`,
  });
  const sensitivityCaptures = new FileCaptureStore({
    ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-captures`,
  });
  const sensitivityEdgesCaptures = new FileCaptureStore({
    ...SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-edges-captures`,
  });

  // Minimal brief-only snapshot — no architecture artifact.
  // The executor finds no arch artifact and throws before any capture read.
  const briefFreshness = {
    status: "fresh" as const,
    changedAt: "2026-08-05T10:01:00.000Z",
    invalidatedByChangeIds: [] as string[],
  };
  const briefModelArtifact = {
    id: "model-artifact-no-arch-edges",
    name: "Base",
    kind: "sysml-model" as const,
    version: "v1",
    fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    producer: { serverId: "syson", tool: "syson_element_get", runId: "run:stub" },
    inputArtifactIds: [] as string[],
    freshness: briefFreshness,
  };
  const briefSnap: ThreadSnapshot = {
    schemaVersion: "1.0" as const,
    id: "snap-no-arch-edges",
    revision: 1,
    generatedAt: "2026-08-05T10:01:00.000Z",
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system" as const,
      version: "v3",
      modelArtifactId: briefModelArtifact.id,
    },
    freshness: briefFreshness,
    changeSet: {
      id: "cs-no-arch-edges",
      name: "Brief only",
      status: "applied" as const,
      createdAt: "2026-08-05T10:01:00.000Z",
      appliedAt: "2026-08-05T10:01:00.000Z",
      changes: [],
    },
    artifacts: [briefModelArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  await snapshots.save(briefSnap);

  return mockSensEdgesFixture({
    snapshots,
    archCaptures,
    seedCaptures,
    sensitivityCaptures,
    sensitivityEdgesCaptures,
    basisSnapshot: briefSnap,
    sensArtifactId: "stub-sens-artifact-no-arch",
  });
}

// ---------------------------------------------------------------------------
// mockSensEdgesFixture — shared mock project + commands factory
//
// Creates mock projects + commands that isolate the executor from the command
// service. The mock tracks run state (queued → running → publishing →
// completed) in memory. Real captures are already in the stores; only the run
// lifecycle goes through the mock.
// ---------------------------------------------------------------------------

function mockSensEdgesFixture(opts: {
  snapshots: FileThreadSnapshotStore;
  archCaptures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  seedCaptures: FileCaptureStore<"syson-model-seed">;
  sensitivityCaptures: FileCaptureStore<"sensitivity-study">;
  sensitivityEdgesCaptures: FileCaptureStore<"sensitivity-edges-seed">;
  basisSnapshot: ThreadSnapshot;
  sensArtifactId: string;
}): SensitivityEdgesFixture {
  const runId = "run:sensitivity-edges";
  const workItemId = "write-sensitivity-edges";

  type RunStatus = "queued" | "running" | "publishing" | "completed";
  let runStatus: RunStatus = "queued";
  let claimedBy: { origin: string; id: string } | undefined;
  let startedAt: string | undefined;
  let resultSnapshot: unknown | undefined;
  let projectRevision = 10;
  const commandReceipts: { commandId: string }[] = [];

  function makeProject(): Record<string, unknown> {
    return {
      schemaVersion: "3.0",
      revision: projectRevision,
      project: {
        id: "coffee-machine-cm01-v3",
        subjectId: "project:coffee-machine-cm01-v3",
        name: "CM-01 coffee machine",
      },
      commandReceipts: [...commandReceipts],
      agentRuns: [{
        id: runId,
        workItemId,
        status: runStatus,
        claimedBy,
        startedAt,
        resultSnapshot,
        basis: {
          kind: "thread-snapshot",
          snapshotId: opts.basisSnapshot.id,
          revision: opts.basisSnapshot.revision,
          subjectId: opts.basisSnapshot.subject.id,
        },
      }],
      workItems: [{
        id: workItemId,
        phaseId: "sensitivity-edges-phase",
        owner: "agent",
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.id,
          version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.version,
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
            {
              name: "sensitivityArtifact",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: opts.basisSnapshot.id,
                  snapshotRevision: opts.basisSnapshot.revision,
                  kind: "artifact" as const,
                  id: opts.sensArtifactId,
                },
              },
            },
          ],
        },
      }],
    };
  }

  const mockProjects: EngineeringProjectRevisionStore = {
    get: (_id: string) => Promise.resolve(makeProject() as never),
  } as unknown as EngineeringProjectRevisionStore;

  const mockCommands: EngineeringProjectCommandService = {
    claimRun: (origin: { kind: string; actorId: string }, _cmd: unknown) => {
      claimedBy = { origin: origin.kind, id: origin.actorId };
      startedAt = "2026-08-05T10:00:01.000Z";
      runStatus = "running";
      projectRevision++;
      return Promise.resolve(makeProject() as never);
    },
    publishRun: (_origin: unknown, _cmd: unknown) => {
      runStatus = "publishing";
      projectRevision++;
      return Promise.resolve(makeProject() as never);
    },
    completeRun: (_origin: unknown, cmd: unknown) => {
      const c = cmd as { commandId: string; resultSnapshot: unknown };
      runStatus = "completed";
      resultSnapshot = c.resultSnapshot;
      // commandReceipts must carry the exact commandId the executor passes so
      // assertCompleted can find it on the idempotent replay path.
      commandReceipts.push({ commandId: c.commandId });
      projectRevision++;
      return Promise.resolve(makeProject() as never);
    },
    failRun: (_origin: unknown, _cmd: unknown) => {
      runStatus = "queued";
      projectRevision++;
      return Promise.resolve(makeProject() as never);
    },
  } as unknown as EngineeringProjectCommandService;

  return {
    projects: mockProjects,
    commands: mockCommands,
    snapshots: opts.snapshots,
    archCaptures: opts.archCaptures,
    seedCaptures: opts.seedCaptures,
    sensitivityCaptures: opts.sensitivityCaptures,
    sensitivityEdgesCaptures: opts.sensitivityEdgesCaptures,
    queued: makeProject() as never,
  };
}

// ---------------------------------------------------------------------------
// Fixture helper: ratchet-through-executor basis
// ---------------------------------------------------------------------------

async function queuedSensitivityEdgesOnRatchetBasis(
  directory: string,
): Promise<SensitivityEdgesFixture> {
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
  const sensitivityEdgesCaptures = new FileCaptureStore({
    ...SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/sensitivity-edges-captures`,
  });

  const ratchetFreshness = {
    status: "fresh" as const,
    changedAt: "2026-08-05T10:03:00.000Z",
    invalidatedByChangeIds: [] as string[],
  };
  const ratchetOp = {
    serverId: "syson",
    tool: "syson_element_get",
    runId: "run:ratchet-edges-ancestor",
  };
  const snapAId = "snap-edges-ratchet-exec-a";
  const snapBId = "snap-edges-ratchet-exec-b";

  // snap-a: carries the sensitivity-edges artifact.
  await snapshots.save({
    schemaVersion: "1.0" as const,
    id: snapAId,
    revision: 1,
    generatedAt: "2026-08-05T10:03:00.000Z",
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system" as const,
      version: "v3",
      modelArtifactId: "model-artifact-edges-ratchet-a",
    },
    freshness: ratchetFreshness,
    changeSet: {
      id: "cs-edges-ratchet-a",
      name: "Edges Ratchet A",
      status: "applied" as const,
      createdAt: "2026-08-05T10:03:00.000Z",
      appliedAt: "2026-08-05T10:03:00.000Z",
      changes: [],
    },
    artifacts: [
      {
        id: "model-artifact-edges-ratchet-a",
        name: "Model A",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
        producer: ratchetOp,
        inputArtifactIds: [] as string[],
        freshness: ratchetFreshness,
      },
      {
        id: "sens-edges-artifact-ratchet-exec-a",
        name: "Sensitivity edges A",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: `${SENSITIVITY_EDGES_URI_PREFIX}sha256/${"b".repeat(64)}`,
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

  // snap-b: revision 2, previous → snap-a, no sensitivity-edges artifact.
  const modelArtifactB = {
    id: "model-artifact-edges-ratchet-b",
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
    generatedAt: "2026-08-05T10:04:00.000Z",
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
      id: "cs-edges-ratchet-b",
      name: "Edges Ratchet B",
      status: "applied" as const,
      createdAt: "2026-08-05T10:04:00.000Z",
      appliedAt: "2026-08-05T10:04:00.000Z",
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

  const runId = "run:sensitivity-edges-ratchet-exec";
  const workItemId = "write-sensitivity-edges-ratchet-exec";
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
        phaseId: "sensitivity-edges-phase-ratchet-exec",
        owner: "agent",
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.id,
          version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.version,
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
                  id: "stub-sensitivity-artifact-edges-ratchet-exec",
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
      startedAt = "2026-08-05T10:03:00.000Z";
      runStatus = "running";
      projectRevision++;
      return Promise.resolve(makeRatchetProject() as never);
    },
    publishRun: () =>
      Promise.reject(
        new Error("must not reach publishRun: ratchet fires first"),
      ),
    completeRun: () =>
      Promise.reject(
        new Error("must not reach completeRun: ratchet fires first"),
      ),
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
    sensitivityEdgesCaptures,
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
    issuedAt: "2026-08-05T10:00:00.000Z",
  };
}

async function loadRecipe() {
  return JSON.parse(
    await Deno.readTextFile("config/product-recipes/coffee-machine-cm01-v1.json"),
  );
}
