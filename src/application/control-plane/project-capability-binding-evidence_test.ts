import { assertEquals } from "@std/assert";
import { listRegisteredEngineeringOperations } from "../../orchestration/operations/registry.ts";
import type { ResolvedOperationPlanV2 } from "../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { ResolvedRunPlanReader } from "../../domain/project/resolved-run-plan-sealer.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import type { PlannedProjectCapabilityBinding } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { ProjectCapabilityBindingReplacement } from "../../domain/capability/project-capability-authorization.ts";
import { evaluateProjectCapabilityBindingEvidence } from "./project-capability-binding-evidence.ts";

const CHRONO_KEY = "mechanics.observe-prescribed-kinematics\u00001\u0000execution";
const PROJECT_ID = "ml01";
const CHRONO_RUN_ID = "run-chrono";
const CHRONO_WORK_ITEM_ID = "wi-chrono";
const CAD_RUN_ID = "run-cad";
const CAD_WORK_ITEM_ID = "wi-cad";
const CHRONO_OPERATION = {
  id: "verify.run-prescribed-kinematics",
  version: "1",
} as const;
const CAD_OPERATION = {
  id: "verify.observe-assembly-integrity",
  version: "1",
} as const;
const INPUT = fingerprint("1");

Deno.test("unrelated CAD evidence does not publish a Chrono method", async () => {
  const decisions = await evaluate({
    workItems: [cadWorkItem()],
    runs: [completedCadRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1" }),
  });
  assertEquals(decisions.get(CHRONO_KEY), "none");
});

Deno.test("failed Chrono without a published result is not method evidence", async () => {
  const decisions = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [{
      ...completedChronoRun(),
      status: "failed",
      resultSnapshot: undefined,
      evidenceRefs: [],
      failure: { code: "provider-failed", message: "malformed" },
    }],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1" }),
  });
  assertEquals(decisions.get(CHRONO_KEY), "none");
});

Deno.test("completed published Chrono L3 matches the exact previous binding method", async () => {
  const decisions = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1" }),
  });
  assertEquals(decisions.get(CHRONO_KEY), "published");
});

Deno.test("completed Chrono L3 with a different prior binding is not that method's evidence", async () => {
  const decisions = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.2" }),
  });
  assertEquals(decisions.get(CHRONO_KEY), "none");
});

Deno.test("completed Chrono evidence with an absent ROP is unresolved", async () => {
  const { resolvedOperationPlan: _plan, ...withoutPlan } = completedChronoRun();
  const decisions = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [withoutPlan],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1" }),
  });
  assertEquals(decisions.get(CHRONO_KEY), "unresolved");
});

Deno.test("completed Chrono evidence with an unreadable or incoherent ROP is unresolved", async () => {
  const unreadable = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    readError: new TypeError("Resolved operation plan is not canonical JSON."),
  });
  assertEquals(unreadable.get(CHRONO_KEY), "unresolved");

  const tampered = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1", runId: "run-forged" }),
  });
  assertEquals(tampered.get(CHRONO_KEY), "unresolved");
});

Deno.test("removed historical Chrono operation still publishes from a matching exact ROP", async () => {
  const decisions = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1" }),
    excludeOperations: [CHRONO_OPERATION],
  });
  assertEquals(decisions.get(CHRONO_KEY), "published");
});

Deno.test("removed historical operation with an absent or unreadable ROP is unresolved", async () => {
  const { resolvedOperationPlan: _plan, ...withoutPlan } = completedChronoRun();
  const absent = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [withoutPlan],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1" }),
    excludeOperations: [CHRONO_OPERATION],
  });
  assertEquals(absent.get(CHRONO_KEY), "unresolved");

  const unreadable = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    readError: new TypeError("Resolved operation plan is not canonical JSON."),
    excludeOperations: [CHRONO_OPERATION],
  });
  assertEquals(unreadable.get(CHRONO_KEY), "unresolved");

  const incoherent = await evaluate({
    workItems: [chronoWorkItem()],
    runs: [completedChronoRun()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: kinematicsPlan({ adapterVersion: "0.3.1", runId: "run-forged" }),
    excludeOperations: [CHRONO_OPERATION],
  });
  assertEquals(incoherent.get(CHRONO_KEY), "unresolved");
});

Deno.test("removed historical unrelated operation without a Chrono binding is not method evidence", async () => {
  const decisions = await evaluate({
    workItems: [cadWorkItem()],
    runs: [completedCadRunWithPlan()],
    snapshots: [threadSnapshot()],
    replacements: [chronoReplacement("0.3.1")],
    plan: assemblyPlan(),
    excludeOperations: [CAD_OPERATION],
  });
  assertEquals(decisions.get(CHRONO_KEY), "none");
});

async function evaluate(input: {
  readonly workItems: readonly EngineeringWorkItem[];
  readonly runs: readonly EngineeringAgentRun[];
  readonly snapshots: EngineeringProjectSnapshot["threadSnapshots"];
  readonly replacements: readonly ProjectCapabilityBindingReplacement[];
  readonly plan?: ResolvedOperationPlanV2;
  readonly readError?: Error;
  readonly excludeOperations?: readonly {
    readonly id: string;
    readonly version: string;
  }[];
}): Promise<ReadonlyMap<string, "none" | "published" | "unresolved">> {
  const recordedPlans: ResolvedRunPlanReader = {
    read: () =>
      input.readError ? Promise.reject(input.readError) : Promise.resolve(input.plan!),
  };
  const excluded = new Set(
    (input.excludeOperations ?? []).map((operation) =>
      `${operation.id}\u0000${operation.version}`
    ),
  );
  return await evaluateProjectCapabilityBindingEvidence({
    project: projectFixture({
      threadSnapshots: input.snapshots,
      workItems: input.workItems,
      agentRuns: input.runs,
    }),
    registry: {
      list: () =>
        listRegisteredEngineeringOperations().filter((operation) =>
          !excluded.has(`${operation.id}\u0000${operation.version}`)
        ),
    },
    recordedPlans,
    replacements: input.replacements,
  });
}

function projectFixture(
  patch: Partial<
    Pick<EngineeringProjectSnapshot, "threadSnapshots" | "workItems" | "agentRuns">
  >,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "snapshot",
    revision: 4,
    generatedAt: "2026-08-31T00:00:00.000Z",
    project: {
      id: PROJECT_ID,
      name: "ML01",
      subjectId: "subject",
      objective: { title: "Observe kinematics", statement: "Observe kinematics." },
    },
    threadSnapshots: patch.threadSnapshots ?? [],
    phases: [],
    workItems: patch.workItems ?? [],
    agentRuns: patch.agentRuns ?? [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function chronoReplacement(
  previousAdapterVersion: string,
): ProjectCapabilityBindingReplacement {
  const previous = chronoBinding(previousAdapterVersion);
  return {
    requirementKey: CHRONO_KEY,
    previous,
    next: chronoBinding("0.3.2"),
  };
}

function chronoBinding(adapterVersion: string): PlannedProjectCapabilityBinding {
  return {
    requirement: {
      id: "mechanics.observe-prescribed-kinematics",
      version: "1",
      minimumQualification: "qualified",
      use: "execution",
    },
    status: "unavailable",
    binding: null,
    unitIds: ["casys.mcp-chrono"],
    reasons: ["unqualified"],
    candidate: {
      id: "chrono-prescribed-kinematics",
      version: "1",
      qualification: "unqualified",
      adapter: {
        id: "chrono-prescribed-kinematics-adapter",
        version: adapterVersion,
        source: "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts",
      },
      profile: null,
      unitIds: ["casys.mcp-chrono"],
    },
  };
}

function chronoWorkItem(): EngineeringWorkItem {
  return workItem({
    id: CHRONO_WORK_ITEM_ID,
    operationId: CHRONO_OPERATION.id,
  });
}

function cadWorkItem(): EngineeringWorkItem {
  return workItem({
    id: CAD_WORK_ITEM_ID,
    operationId: CAD_OPERATION.id,
  });
}

function workItem(input: {
  readonly id: string;
  readonly operationId: string;
}): EngineeringWorkItem {
  return {
    id: input.id,
    activityId: `activity:${input.id}`,
    phaseId: "phase-1",
    title: input.id,
    description: input.id,
    kind: "verify",
    status: "completed",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [evidenceRef()],
    decisionIds: [],
    blockerIds: [],
    operation: {
      id: input.operationId,
      version: "1",
      bindings: [],
    },
  };
}

function completedChronoRun(): EngineeringAgentRun {
  return {
    id: CHRONO_RUN_ID,
    workItemId: CHRONO_WORK_ITEM_ID,
    status: "completed",
    summary: "Prescribed kinematics observed.",
    queuedAt: "2026-08-31T00:00:00.000Z",
    inputFingerprint: INPUT,
    resolvedOperationPlan: {
      schemaVersion: "resolved-operation-plan-ref/1.0",
      planId: CHRONO_RUN_ID,
      fingerprint: fingerprint("2"),
      byteCount: 32,
      casUri: `casys://resolved-operation-plan/sha256/${"2".repeat(64)}`,
    },
    evidenceRefs: [evidenceRef()],
    resultSnapshot: threadSnapshot(),
  };
}

function completedCadRun(): EngineeringAgentRun {
  return {
    id: CAD_RUN_ID,
    workItemId: CAD_WORK_ITEM_ID,
    status: "completed",
    summary: "Assembly observed.",
    queuedAt: "2026-08-31T00:00:00.000Z",
    inputFingerprint: INPUT,
    evidenceRefs: [evidenceRef()],
    resultSnapshot: threadSnapshot(),
  };
}

function completedCadRunWithPlan(): EngineeringAgentRun {
  return {
    ...completedCadRun(),
    resolvedOperationPlan: {
      schemaVersion: "resolved-operation-plan-ref/1.0",
      planId: CAD_RUN_ID,
      fingerprint: fingerprint("2"),
      byteCount: 32,
      casUri: `casys://resolved-operation-plan/sha256/${"2".repeat(64)}`,
    },
  };
}

function threadSnapshot() {
  return {
    snapshotId: "thread-1",
    revision: 1,
    subjectId: "subject",
  };
}

function evidenceRef() {
  return {
    snapshotId: "thread-1",
    snapshotRevision: 1,
    kind: "artifact" as const,
    id: "artifact-1",
  };
}

function kinematicsPlan(input: {
  readonly adapterVersion: string;
  readonly runId?: string;
}): ResolvedOperationPlanV2 {
  const runId = input.runId ?? CHRONO_RUN_ID;
  const material = {
    unitId: "casys.mcp-chrono",
    materialId: "mcp-chrono-image",
    imageDigest: "e".repeat(64),
  };
  return {
    schemaVersion: "resolved-operation-plan/2.0",
    id: runId,
    run: {
      projectId: PROJECT_ID,
      runId,
      workItemId: CHRONO_WORK_ITEM_ID,
      inputFingerprint: INPUT,
      queueBasisProject: {
        snapshotId: "project-r1",
        revision: 1,
        fingerprint: fingerprint("3"),
      },
    },
    workItem: {
      id: CHRONO_WORK_ITEM_ID,
      operation: { id: CHRONO_OPERATION.id, version: CHRONO_OPERATION.version },
      operationFingerprint: fingerprint("4"),
    },
    operationalCapability: {
      schemaVersion: "resolved-capability-runtime-operation/2.0",
      projectId: PROJECT_ID,
      operation: { id: CHRONO_OPERATION.id, version: CHRONO_OPERATION.version },
      authorizationFingerprint: fingerprint("5"),
      demandFingerprint: fingerprint("6"),
      registryFingerprint: fingerprint("7"),
      bindings: [{
        capability: {
          id: "mechanics.observe-prescribed-kinematics",
          version: "1",
          use: "execution",
          minimumQualification: "qualified",
        },
        binding: { id: "chrono-prescribed-kinematics", version: "1" },
        effectiveQualification: "qualified",
        adapter: {
          id: "chrono-prescribed-kinematics-adapter",
          version: input.adapterVersion,
          source: "test",
        },
        profile: null,
        materials: [material],
        runtimeModes: [{
          material,
          targetPlatform: "linux/amd64",
          mode: "emulated",
          qualificationAttestationFingerprint: fingerprint("8"),
        }],
        hostLifecycles: [{
          material,
          kind: "persistent-compose",
          launchGroup: null,
        }],
      }],
    },
  } as unknown as ResolvedOperationPlanV2;
}

function assemblyPlan(): ResolvedOperationPlanV2 {
  const material = {
    unitId: "casys.mcp-build123d",
    materialId: "mcp-build123d-image",
    imageDigest: "e".repeat(64),
  };
  return {
    schemaVersion: "resolved-operation-plan/2.0",
    id: CAD_RUN_ID,
    run: {
      projectId: PROJECT_ID,
      runId: CAD_RUN_ID,
      workItemId: CAD_WORK_ITEM_ID,
      inputFingerprint: INPUT,
      queueBasisProject: {
        snapshotId: "project-r1",
        revision: 1,
        fingerprint: fingerprint("3"),
      },
    },
    workItem: {
      id: CAD_WORK_ITEM_ID,
      operation: { id: CAD_OPERATION.id, version: CAD_OPERATION.version },
      operationFingerprint: fingerprint("4"),
    },
    operationalCapability: {
      schemaVersion: "resolved-capability-runtime-operation/2.0",
      projectId: PROJECT_ID,
      operation: { id: CAD_OPERATION.id, version: CAD_OPERATION.version },
      authorizationFingerprint: fingerprint("5"),
      demandFingerprint: fingerprint("6"),
      registryFingerprint: fingerprint("7"),
      bindings: [{
        capability: {
          id: "geometry.observe-assembly-integrity",
          version: "1",
          use: "execution",
          minimumQualification: "qualified",
        },
        binding: { id: "assembly-integrity", version: "1" },
        effectiveQualification: "qualified",
        adapter: {
          id: "build123d-assembly-integrity-adapter",
          version: "1",
          source: "test",
        },
        profile: null,
        materials: [material],
        runtimeModes: [{
          material,
          targetPlatform: "linux/amd64",
          mode: "emulated",
          qualificationAttestationFingerprint: fingerprint("8"),
        }],
        hostLifecycles: [{
          material,
          kind: "persistent-compose",
          launchGroup: null,
        }],
      }],
    },
  } as unknown as ResolvedOperationPlanV2;
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}
