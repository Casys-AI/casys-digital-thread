/**
 * Tests for the CM-01 part-definitions documentary capture executor.
 *
 * Coverage:
 *  - Human-origin rejection (no I/O touched)
 *  - Non-canonical shape rejection (wrong operation, no provider call)
 *  - Ratchet: assertPartDefinitionsNotRemoved fires when ancestor had the artifacts
 *  - Anti-doublon: executor throws when basis already carries part-def artifacts
 *  - Missing architecture artifact → invalid_input before provider call
 *  - Happy path: captures both PartDef records and publishes a valid snapshot
 *  - consumption.observedFingerprint equals the architecture artifact fingerprint
 *  - Idempotent replay: same command twice, no extra SysON calls
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../domain/project/project-brief-command-service.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtension } from "../../../domain/thread/thread-snapshot-extension.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../../captures/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../../stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "../approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../../testing/approved-brief-source-analysis-fixture.ts";
import { LiveThreadUpdateStore } from "../../stores/live-thread-update-store.ts";
import { SysonModelSeedRunExecutor } from "../syson-model-seed-run-executor.ts";
import { FileSysonModelSeedAttemptStore } from "../../wal/file-syson-model-seed-attempt-store.ts";
import {
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "./coffee-machine-cm01-v3-architecture-run-executor.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "../../wal/file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../../domain/platform/syson-model-seed.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../mcp/http-mcp-tool-client.ts";
import {
  assertPartDefinitionsNotRemoved,
  CoffeeMachineCm01V3PartDefinitionsRunExecutor,
  findPartDefinitionsArtifacts,
  PART_DEFINITIONS_URI_PREFIX,
  PartDefinitionsArtifactRemovedError,
} from "./coffee-machine-cm01-v3-part-definitions-run-executor.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

const EDITING_CONTEXT_ID = "editing-context-456";
const ARCH_PACKAGE_ID = "architecture-package-001";
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
const CM_ID = "definition-0"; // CoffeeMachine is first in the recipe
const DT_ID = "definition-10"; // DripTray is last

// ---------------------------------------------------------------------------
// Ratchet — assertPartDefinitionsNotRemoved
// ---------------------------------------------------------------------------

Deno.test(
  "assertPartDefinitionsNotRemoved raises when an ancestor carried part-def artifacts but the current basis does not",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-part-def-ratchet-",
    });
    try {
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const freshness = {
        status: "fresh" as const,
        changedAt: "2026-08-08T09:00:00.000Z",
        invalidatedByChangeIds: [],
      };
      const operation = {
        serverId: "syson",
        tool: "syson_part_structure",
        runId: "run:ratchet-test",
      };
      const changeSet = {
        id: "changeset-ratchet",
        name: "Ratchet test",
        status: "applied" as const,
        createdAt: "2026-08-08T09:00:00.000Z",
        appliedAt: "2026-08-08T09:00:00.000Z",
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
      const partDefArtifact = {
        id: "part-def-artifact-ratchet",
        name: "CM-01 CoffeeMachine part definition",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: `${PART_DEFINITIONS_URI_PREFIX}sha256/${"b".repeat(64)}`,
        producer: operation,
        inputArtifactIds: [],
        freshness,
      };
      const minimalBase = {
        schemaVersion: "1.0" as const,
        generatedAt: "2026-08-08T09:00:00.000Z",
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
        artifacts: [baseArtifact, partDefArtifact],
      };
      const s3: ThreadSnapshot = {
        ...minimalBase,
        id: "snapshot-ratchet-3",
        revision: 3,
        previous: { snapshotId: "snapshot-ratchet-2", revision: 2 },
        artifacts: [baseArtifact], // dropped part-def artifact
      };

      await snapshots.save(s1);
      await snapshots.save(s2);

      await assertRejects(
        () => assertPartDefinitionsNotRemoved(s3, snapshots),
        PartDefinitionsArtifactRemovedError,
        "previously carried part-definition artifacts",
      );

      await assertPartDefinitionsNotRemoved(s2, snapshots);
      await assertPartDefinitionsNotRemoved(s1, snapshots);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "assertPartDefinitionsNotRemoved fails closed when the ancestor lineage cycles",
  async () => {
    const base = ratchetSnapshot("ratchet-cycle-basis", 3, {
      snapshotId: "ratchet-cycle-one",
      revision: 1,
    });
    const one = ratchetSnapshot("ratchet-cycle-one", 1, {
      snapshotId: "ratchet-cycle-two",
      revision: 2,
    });
    const two = ratchetSnapshot("ratchet-cycle-two", 2, {
      snapshotId: "ratchet-cycle-one",
      revision: 1,
    });
    const snapshots = {
      get: (id: string) =>
        Promise.resolve(
          id === one.id ? one : id === two.id ? two : undefined,
        ),
      latest: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
    };

    await assertRejects(
      () => assertPartDefinitionsNotRemoved(base, snapshots),
      PartDefinitionsArtifactRemovedError,
      "contains a cycle",
    );
  },
);

// ---------------------------------------------------------------------------
// Ratchet — through executor path
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 part-definitions executor stops with PartDefinitionsArtifactRemovedError before any SysON call when the basis ancestor carried the artifacts",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-part-def-ratchet-thru-exec-",
    });
    try {
      const fixture = await queuedPartDefinitionsOnRatchetBasis(directory);

      let sysonCalled = false;
      const executor = new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        partDefinitionsCaptures: fixture.partDefinitionsCaptures,
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
          `${directory}/part-def-leases-ratchet-exec`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-part-def-ratchet-exec",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-08T09:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        PartDefinitionsArtifactRemovedError,
        "previously carried part-definition artifacts",
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
  "CM-01 part-definitions executor rejects a human before any store access",
  async () => {
    const executor = new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      architectureCaptures: {} as never,
      seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
      partDefinitionsCaptures: {} as never,
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
          issuedAt: "2026-08-08T09:00:00.000Z",
          runId: "run:part-def",
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
  "CM-01 part-definitions executor rejects a wrong operation before any provider call",
  async () => {
    let providerCalled = false;
    const executor = new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: {
              id: "different-project",
              subjectId: "project:different-project",
            },
            agentRuns: [{
              id: "run:part-def",
              workItemId: "capture-part-def",
              basis: { kind: "thread-snapshot" },
            }],
            workItems: [{
              id: "capture-part-def",
              operation: {
                id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions.id,
                version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions.version,
                bindings: [
                  { name: "approvedBrief", source: { kind: "approved-brief" } },
                ],
              },
            }],
          } as never),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      architectureCaptures: {} as never,
      seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
      partDefinitionsCaptures: {} as never,
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
          issuedAt: "2026-08-08T09:00:00.000Z",
          runId: "run:part-def",
        }),
      Error,
      "canonical CM-01 V3 part-definitions",
    );
    assertEquals(providerCalled, false);
  },
);

// ---------------------------------------------------------------------------
// Missing architecture artifact
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 part-definitions executor fails with invalid_input when the basis has no architecture artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-part-def-no-arch-",
    });
    try {
      const fixture = await queuedPartDefinitionsOnBriefBasis(directory);
      const executor = new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        partDefinitionsCaptures: fixture.partDefinitionsCaptures,
        syson: {
          callTool: () =>
            Promise.reject(new Error("must not call provider before input error")),
          callToolTextResult: () => Promise.reject(new Error("must not call")),
        },
        lease: new FileEngineeringProjectRunLease(
          `${directory}/part-def-leases-no-arch`,
        ),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-part-def-no-arch",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-08T09:00:00.000Z",
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
// Integration — happy path
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 part-definitions executor captures both PartDef records and publishes a valid snapshot",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-part-def-happy-",
    });
    try {
      const fixture = await queuedPartDefinitions(directory);
      const syson = new PartDefinitionsSyson({
        architecturePackageId: ARCH_PACKAGE_ID,
        declarationIds: EXISTING_DECL_IDS,
        partDefNames: RECIPE_PART_DEF_NAMES,
        cmId: CM_ID,
        dtId: DT_ID,
      });

      const executor = new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        partDefinitionsCaptures: fixture.partDefinitionsCaptures,
        syson,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/part-def-leases`,
        ),
        now: () => "2026-08-08T09:00:00.000Z",
      });

      const completed = await executor.execute(
        AGENT,
        {
          commandId: "agent-part-def-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: fixture.queued.revision,
          issuedAt: "2026-08-08T09:00:00.000Z",
          runId: fixture.queued.agentRuns.at(-1)!.id,
        },
      );

      const run = completed.agentRuns.at(-1)!;
      assertEquals(run.status, "completed");

      // The result snapshot must carry two part-definition artifacts.
      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot);

      // The snapshot must pass full validation.
      validateThreadSnapshot(snapshot);

      const partDefArtifacts = findPartDefinitionsArtifacts(snapshot);
      assertEquals(
        partDefArtifacts.length,
        2,
        "Snapshot must carry exactly two part-definition artifacts.",
      );

      const cmArtifact = partDefArtifacts.find((a) =>
        a.name === "CM-01 CoffeeMachine part definition"
      );
      const dtArtifact = partDefArtifacts.find((a) =>
        a.name === "CM-01 DripTray part definition"
      );
      assertExists(
        cmArtifact,
        "Snapshot must carry the CoffeeMachine part-def artifact.",
      );
      assertExists(dtArtifact, "Snapshot must carry the DripTray part-def artifact.");

      assertEquals(cmArtifact.fingerprint.algorithm, "sha256");
      assertEquals(dtArtifact.fingerprint.algorithm, "sha256");

      // Consumption must reference the architecture artifact fingerprint, not a capture fingerprint.
      const archArtifact = snapshot.artifacts.find(
        (a) =>
          a.kind === "sysml-model" &&
          typeof a.uri === "string" &&
          a.uri.startsWith("casys://coffee-machine-cm01-v3-architecture/"),
      );
      assertExists(archArtifact, "Snapshot must retain the architecture artifact.");

      const archConsumption = snapshot.consumptions.find(
        (c) => c.artifactId === archArtifact.id,
      );
      assertExists(
        archConsumption,
        "Snapshot must carry a consumption for the architecture artifact.",
      );
      assertEquals(
        archConsumption.observedFingerprint,
        archArtifact.fingerprint,
        "consumption.observedFingerprint must equal the architecture artifact fingerprint.",
      );

      // The captures are independent reads of the same architecture; do not
      // fabricate byte-level consumption or derivation between them.
      assertEquals(
        dtArtifact.inputArtifactIds.includes(cmArtifact.id),
        false,
        "DripTray must not declare an independently captured CoffeeMachine record as consumed input.",
      );
      assertEquals(
        snapshot.provenance.some(
          (l) => l.from.id === dtArtifact.id && l.to.id === cmArtifact.id,
        ),
        false,
        "Snapshot must not claim a provenance relation between independent capture bytes.",
      );

      // Closed US-2 attachment list: one traces_to link per anchored evidence
      // artifact, toward the part it measured.
      const tracesTo = (fromId: string, toId: string) =>
        snapshot.provenance.find(
          (l) =>
            l.relation === "traces_to" && l.from.id === fromId &&
            l.to.id === toId,
        );
      for (
        const dripTrayTargetId of [
          "coffee-machine-cm01-v3-mechanical-r3-fixture-proof",
          "drip-tray-printability-fixture-capture",
          "drip-tray-sensitivity-fixture-capture",
          "coffee-machine-cm01-v3-cad-r3-fixture-mesh-drip-tray",
        ]
      ) {
        assertExists(
          tracesTo(dripTrayTargetId, dtArtifact.id),
          `"${dripTrayTargetId}" must trace to the DripTray part definition.`,
        );
      }
      for (
        const machineTargetId of [
          "coffee-machine-cm01-v3-cad-r3-fixture-step",
          "erpnext-bom-fixture",
          "modelica-run-fixture-evidence-abc",
        ]
      ) {
        assertExists(
          tracesTo(machineTargetId, cmArtifact.id),
          `"${machineTargetId}" must trace to the CoffeeMachine part definition.`,
        );
      }
      // The machine-level Modelica rationale states the kit-vs-model limit.
      assertEquals(
        tracesTo("modelica-run-fixture-evidence-abc", cmArtifact.id)?.rationale,
        "The nominal heat-up scenario measures machine-level water temperature; " +
          "the run consumed an approved Modelica kit, not the SysON geometry.",
      );

      // The SysON call sequence must be: syson_element_children (phase 1) →
      // syson_part_structure for CM (phase 2) → syson_part_structure for DT (phase 2).
      assertEquals(syson.calls.map((c) => c.name), [
        "syson_element_children",
        "syson_part_structure",
        "syson_part_structure",
      ]);
      assertEquals(syson.calls[0]?.arguments?.element_id, ARCH_PACKAGE_ID);

      // Idempotent replay: same command, no extra SysON calls.
      const callCountBefore = syson.calls.length;
      const replay = await executor.execute(
        AGENT,
        {
          commandId: "agent-part-def-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: completed.revision,
          issuedAt: "2026-08-08T09:00:00.000Z",
          runId: fixture.queued.agentRuns.at(-1)!.id,
        },
      );
      assertEquals(replay.revision, completed.revision);
      assertEquals(
        syson.calls.length,
        callCountBefore,
        "Idempotent replay must not add SysON calls.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Closed attachment list — a missing target refuses the run
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 part-definitions executor refuses a basis that lacks any closed attachment target",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-part-def-no-targets-",
    });
    try {
      const fixture = await queuedPartDefinitions(directory, {
        withAnchorTargets: false,
      });
      const syson = new PartDefinitionsSyson({
        architecturePackageId: ARCH_PACKAGE_ID,
        declarationIds: EXISTING_DECL_IDS,
        partDefNames: RECIPE_PART_DEF_NAMES,
        cmId: CM_ID,
        dtId: DT_ID,
      });
      const executor = new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        architectureCaptures: fixture.archCaptures,
        seedCaptures: fixture.seedCaptures,
        partDefinitionsCaptures: fixture.partDefinitionsCaptures,
        syson,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/part-def-leases-no-targets`,
        ),
        now: () => "2026-08-08T09:00:00.000Z",
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-part-def-no-targets",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-08T09:00:00.000Z",
            runId: fixture.queued.agentRuns.at(-1)!.id,
          }),
        EngineeringProjectCommandError,
        "closed attachment entry",
      );
      assertEquals(
        syson.calls.length,
        0,
        "A missing closed-list target must fail before any SysON call.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Mock SysON client for part-definitions tests
// ---------------------------------------------------------------------------

interface PartDefinitionsSysonOptions {
  architecturePackageId: string;
  declarationIds: readonly string[];
  partDefNames: readonly string[];
  cmId: string;
  dtId: string;
}

class PartDefinitionsSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #opts: PartDefinitionsSysonOptions;

  constructor(opts: PartDefinitionsSysonOptions) {
    this.#opts = opts;
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_element_children") {
      const children = this.#opts.declarationIds.map((id, i) => ({
        id,
        kind: "sysml::PartDefinition",
        label: this.#opts.partDefNames[i],
      }));
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children,
          count: children.length,
        },
      });
    }

    return Promise.reject(
      new Error(`Unexpected callTool in PartDefinitionsSyson: ${call.name}`),
    );
  }

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    this.calls.push(structuredClone(call));

    if (call.name === "syson_part_structure") {
      const elementId = call.arguments?.root_element_id as string;

      if (elementId === this.#opts.cmId) {
        // CoffeeMachine structure: 1 child = DripTray usage.
        return Promise.resolve({
          root: {
            id: this.#opts.cmId,
            label: "CoffeeMachine",
            kind: "sysml::PartDefinition",
          },
          tree: [
            {
              id: "usage-dt-001",
              label: "dripTray",
              kind: "sysml::PartUsage",
              quantity: 1,
              quantitySource: "explicit",
              children: [],
            },
          ],
          partCount: 1,
          maxDepthReached: false,
        });
      }

      if (elementId === this.#opts.dtId) {
        // DripTray structure: no children.
        return Promise.resolve({
          root: {
            id: this.#opts.dtId,
            label: "DripTray",
            kind: "sysml::PartDefinition",
          },
          tree: [],
          partCount: 0,
          maxDepthReached: false,
        });
      }
    }

    return Promise.reject(
      new Error(
        `Unexpected callToolTextResult in PartDefinitionsSyson: ${call.name} root_element_id=${
          String(call.arguments?.root_element_id)
        }`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Seed + Architecture mock clients
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
      return Promise.reject(new Error(`Unexpected architecture tool: ${call.name}`));
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
// Fixture helpers
// ---------------------------------------------------------------------------

interface PartDefinitionsFixture {
  projects: EngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  archCaptures: FileCaptureStore<"coffee-machine-cm01-v3-architecture">;
  seedCaptures: FileCaptureStore<"syson-model-seed">;
  partDefinitionsCaptures: FileCaptureStore<"cm01-part-definitions">;
  queued: Awaited<ReturnType<EngineeringProjectCommandService["queueRun"]>>;
}

/**
 * Build the project state up to a queued part-definitions run with an
 * architecture-carrying basis (brief → seed → architecture → part-def queue).
 */
/**
 * Appends one revision on top of the architecture snapshot carrying one
 * artifact per closed US-2 attachment family, so the executor's structural
 * finders resolve. Ids mirror the real CM-01 naming contracts; kinds are
 * enum-valid stand-ins.
 */
async function withAnchorTargetArtifacts(
  snapshots: FileThreadSnapshotStore,
  baseRef: { snapshotId: string; revision: number; subjectId: string },
): Promise<{ snapshotId: string; revision: number; subjectId: string }> {
  const base = await snapshots.get(baseRef.snapshotId);
  if (!base) throw new Error("Architecture snapshot must exist in the fixture.");
  const op = {
    serverId: "fixture",
    tool: "fixture_attach",
    runId: "run:fixture-anchor-targets",
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: "2026-08-08T09:03:30.000Z",
    invalidatedByChangeIds: [] as string[],
  };
  const target = (id: string, kind: string, digestSeed: string) => ({
    id,
    name: `Fixture ${id}`,
    kind: kind as "solver-result",
    version: "v1",
    fingerprint: {
      algorithm: "sha256" as const,
      digest: digestSeed.repeat(64).slice(0, 64),
    },
    producer: op,
    inputArtifactIds: [] as string[],
    freshness,
  });
  const extended = applyThreadSnapshotExtension(base, {
    id: "fixture-anchor-targets",
    name: "Attach fixture anchor-target artifacts",
    subjectId: base.subject.id,
    capturedAt: "2026-08-08T09:03:30.000Z",
    artifacts: [
      target(
        "coffee-machine-cm01-v3-mechanical-r3-fixture-proof",
        "solver-result",
        "1",
      ),
      target("drip-tray-printability-fixture-capture", "document", "2"),
      target("drip-tray-sensitivity-fixture-capture", "document", "3"),
      target("coffee-machine-cm01-v3-cad-r3-fixture-step", "step", "4"),
      target("coffee-machine-cm01-v3-cad-r3-fixture-mesh-drip-tray", "mesh", "5"),
      target("erpnext-bom-fixture", "document", "6"),
      target("modelica-run-fixture-evidence-abc", "evidence", "7"),
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: "2026-08-08T09:03:30.000Z" });
  await snapshots.save(extended);
  return {
    snapshotId: extended.id,
    revision: extended.revision,
    subjectId: extended.subject.id,
  };
}

async function queuedPartDefinitions(
  directory: string,
  options: { withAnchorTargets?: boolean } = {},
): Promise<PartDefinitionsFixture> {
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
  const partDefinitionsCaptures = new FileCaptureStore({
    ...CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/part-definitions-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
  const archAttempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
    `${directory}/architecture-attempts`,
  );
  const liveUpdates = new LiveThreadUpdateStore();

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T09:00:00.000Z") + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-08T08:59:00.000Z",
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
      dependsOnItemIds: [],
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
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
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
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-08T09:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T09:01:00.000Z",
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
    now: () => "2026-08-08T09:02:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-seed",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T09:02:00.000Z",
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
    now: () => "2026-08-08T09:03:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-architecture",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T09:03:00.000Z",
    runId: "run:architecture",
  });

  const archRef = arched.threadSnapshots.at(-1)!;
  let basisRef = archRef;
  let planBaseRef = archRef;
  let planRevision = arched.revision;

  if (options.withAnchorTargets ?? true) {
    // Declare the anchor-target revision through the real run lifecycle
    // (queue → claim → publish → complete), the only path that binds a
    // ThreadSnapshot to the project — exactly like the production runners.
    const targetsRef = await withAnchorTargetArtifacts(snapshots, archRef);
    project = await commands.appendChange(AGENT, {
      ...ctx("append-anchor-targets", arched.revision),
      baseSnapshot: archRef,
      phases: [{
        id: "anchor-targets-phase",
        name: "Anchor targets",
        description: "Attach the fixture evidence artifacts.",
      }],
      workItems: [{
        id: "attach-anchor-targets",
        phaseId: "anchor-targets-phase",
        owner: "agent",
        dependsOnWorkItemIds: ["author-architecture"],
        decisionIds: [],
        operation: {
          ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions,
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
          ],
        },
      }],
      requiredDecisions: [],
    });
    project = await commands.queueRun(AGENT, {
      ...ctx("queue-anchor-targets", project.revision),
      runId: "run:anchor-targets",
      workItemId: "attach-anchor-targets",
      summary: "Attach the fixture anchor-target evidence.",
      basis: { kind: "thread-snapshot", ...archRef },
    });
    project = await commands.claimRun(AGENT, {
      ...ctx("claim-anchor-targets", project.revision),
      runId: "run:anchor-targets",
      summary: "Started attaching the fixture anchor-target evidence.",
    });
    project = await commands.publishRun(AGENT, {
      ...ctx("publish-anchor-targets", project.revision),
      runId: "run:anchor-targets",
      summary: "Publishing the fixture anchor-target evidence.",
    });
    project = await commands.completeRun(AGENT, {
      ...ctx("complete-anchor-targets", project.revision),
      runId: "run:anchor-targets",
      summary: "Recorded the fixture anchor-target evidence.",
      resultSnapshot: targetsRef,
      evidenceRefs: [{
        kind: "artifact",
        id: "coffee-machine-cm01-v3-mechanical-r3-fixture-proof",
        snapshotId: targetsRef.snapshotId,
        snapshotRevision: targetsRef.revision,
      }],
    });
    basisRef = targetsRef;
    planBaseRef = targetsRef;
    planRevision = project.revision;
  }

  project = await commands.appendChange(AGENT, {
    ...ctx("append-part-def", planRevision),
    baseSnapshot: planBaseRef,
    phases: [{
      id: "part-def-phase",
      name: "Part definitions",
      description: "Capture the CM-01 part definitions from the SysML model.",
    }],
    workItems: [{
      id: "capture-part-definitions",
      phaseId: "part-def-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["author-architecture"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
        ],
      },
    }],
    requiredDecisions: [],
  });

  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-part-def", project.revision),
    runId: "run:part-definitions",
    workItemId: "capture-part-definitions",
    summary: "Capture the CM-01 part definitions from the SysML model.",
    basis: {
      kind: "thread-snapshot",
      snapshotId: basisRef.snapshotId,
      revision: basisRef.revision,
      subjectId: basisRef.subjectId,
    },
  });

  return {
    projects,
    commands,
    snapshots,
    archCaptures,
    seedCaptures,
    partDefinitionsCaptures,
    queued,
  };
}

/**
 * Minimal fixture for the "missing architecture artifact" test.
 * Builds only through the brief baseline run (r1).
 */
async function queuedPartDefinitionsOnBriefBasis(
  directory: string,
): Promise<PartDefinitionsFixture> {
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
  const partDefinitionsCaptures = new FileCaptureStore({
    ...CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/part-definitions-captures`,
  });

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T09:00:00.000Z") + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-no-arch",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-08T08:59:00.000Z",
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
      dependsOnItemIds: [],
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
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
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
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases-no-arch`),
    now: () => "2026-08-08T09:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline-no-arch",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T09:01:00.000Z",
    runId: "run:brief-baseline-no-arch",
  });

  const r1Ref = baselined.threadSnapshots[0]!;
  project = await commands.appendChange(AGENT, {
    ...ctx("append-part-def-no-arch", baselined.revision),
    baseSnapshot: r1Ref,
    phases: [{
      id: "part-def-phase-no-arch",
      name: "Part definitions (no arch)",
      description: "Should fail: no architecture artifact in basis.",
    }],
    workItems: [{
      id: "capture-part-def-no-arch",
      phaseId: "part-def-phase-no-arch",
      owner: "agent",
      dependsOnWorkItemIds: ["record-brief-no-arch"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
        ],
      },
    }],
    requiredDecisions: [],
  });

  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-part-def-no-arch", project.revision),
    runId: "run:part-definitions-no-arch",
    workItemId: "capture-part-def-no-arch",
    summary: "Capture part definitions (should fail on missing arch).",
    basis: { kind: "thread-snapshot", ...r1Ref },
  });

  return {
    projects,
    commands,
    snapshots,
    archCaptures,
    seedCaptures,
    partDefinitionsCaptures,
    queued,
  };
}

/**
 * Fixture for the through-executor ratchet test.
 * Uses a stateful mock for projects and commands to bypass queueRun validation.
 */
async function queuedPartDefinitionsOnRatchetBasis(
  directory: string,
): Promise<PartDefinitionsFixture> {
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed-captures`,
  });
  const archCaptures = new FileCaptureStore({
    ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const partDefinitionsCaptures = new FileCaptureStore({
    ...CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/part-definitions-captures`,
  });

  const ratchetFreshness = {
    status: "fresh" as const,
    changedAt: "2026-08-08T09:03:00.000Z",
    invalidatedByChangeIds: [] as string[],
  };
  const ratchetOp = {
    serverId: "syson",
    tool: "syson_part_structure",
    runId: "run:ratchet-ancestor",
  };
  const snapAId = "snap-ratchet-part-def-a";
  const snapBId = "snap-ratchet-part-def-b";

  // snap-a: revision 1, no previous, carries a part-definition artifact.
  await snapshots.save({
    schemaVersion: "1.0" as const,
    id: snapAId,
    revision: 1,
    generatedAt: "2026-08-08T09:03:00.000Z",
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
      createdAt: "2026-08-08T09:03:00.000Z",
      appliedAt: "2026-08-08T09:03:00.000Z",
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
      {
        id: "part-def-artifact-ratchet-a",
        name: "CM-01 CoffeeMachine part definition",
        kind: "sysml-model" as const,
        version: "v1",
        fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        uri: `${PART_DEFINITIONS_URI_PREFIX}sha256/${"b".repeat(64)}`,
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

  // snap-b: revision 2, previous → snap-a, NO part-definition artifacts.
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
    generatedAt: "2026-08-08T09:04:00.000Z",
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
      createdAt: "2026-08-08T09:04:00.000Z",
      appliedAt: "2026-08-08T09:04:00.000Z",
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

  const runId = "run:part-definitions-ratchet-exec";
  const workItemId = "capture-part-def-ratchet-exec";
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
        phaseId: "part-def-phase-ratchet-exec",
        owner: "agent",
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions.id,
          version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions.version,
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
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
      startedAt = "2026-08-08T09:03:00.000Z";
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
    partDefinitionsCaptures,
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
    issuedAt: "2026-08-08T09:00:00.000Z",
  };
}

function ratchetSnapshot(
  id: string,
  revision: number,
  previous?: { snapshotId: string; revision: number },
): ThreadSnapshot {
  const freshness = {
    status: "fresh" as const,
    changedAt: "2026-08-08T09:00:00.000Z",
    invalidatedByChangeIds: [],
  };
  return {
    schemaVersion: "1.0",
    id,
    revision,
    ...(previous ? { previous } : {}),
    generatedAt: "2026-08-08T09:00:00.000Z",
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system",
      version: "v3",
      modelArtifactId: "ratchet-base-artifact",
    },
    freshness,
    changeSet: {
      id: `changeset-${id}`,
      name: "Ratchet cycle fixture",
      status: "applied",
      createdAt: "2026-08-08T09:00:00.000Z",
      appliedAt: "2026-08-08T09:00:00.000Z",
      changes: [],
    },
    artifacts: [{
      id: "ratchet-base-artifact",
      name: "Base model",
      kind: "sysml-model",
      version: "v1",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      producer: {
        serverId: "syson",
        tool: "syson_part_structure",
        runId: "run:ratchet-cycle",
      },
      inputArtifactIds: [],
      freshness,
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

async function loadRecipe() {
  return JSON.parse(
    await Deno.readTextFile("config/product-recipes/coffee-machine-cm01-v1.json"),
  );
}

void deterministicJson; // imported for type completeness
void sha256Fingerprint; // imported for type completeness
