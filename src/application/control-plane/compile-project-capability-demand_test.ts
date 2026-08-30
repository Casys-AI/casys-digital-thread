import { assertEquals, assertRejects } from "@std/assert";
import { evaluateProjectCapabilityDemandCoverage } from "../../domain/capability/project-capability-demand.ts";
import type {
  AllowedEngineeringCapability,
  RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  compileProjectCapabilityDemand,
  type EngineeringOperationRuntimeDemandRegistryView,
} from "./compile-project-capability-demand.ts";
import {
  engineeringOperationRegistry,
  fingerprintRegisteredEngineeringOperationRegistry,
} from "../../orchestration/operations/registry.ts";
import type { RuntimePreparationPrerequisiteRegistryEntry } from "../../orchestration/operations/runtime-preparation-prerequisite-closure.ts";

const APPROVED_BRIEF_BASIS: EngineeringApprovedBriefBasis = {
  kind: "approved-brief",
  projectId: "project-lamp",
  projectSnapshotId: "project-lamp:r3",
  projectRevision: 3,
  briefId: "brief-lamp",
  briefSnapshotId: "brief-lamp:r2",
  briefRevision: 2,
  approvedBriefFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
};

const AUTHOR = capability("model.author-system", "qualified");
const STATIC = capability("mechanics.solve-static-structural", "qualified");
const MODULE_PREPARATION: RequiredEngineeringCapability = {
  ...GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
  minimumQualification: "qualified",
  use: "preparation",
};

Deno.test("V2 demand retains every revision while ceiling and JIT use exact current leaves", async () => {
  const demand = await compileProjectCapabilityDemand(
    project([
      workItem("author-r1", "activity:author", "completed", "model.author", "1"),
      workItem(
        "author-r2",
        "activity:author",
        "ready",
        "model.author",
        "1",
        "author-r1",
      ),
      workItem("static-r1", "activity:static", "completed", "verify.static", "3"),
      workItem("none-r1", "activity:none", "ready", "record.note", "1"),
      workItem("old-r1", "activity:old", "cancelled", "retired.unknown", "1"),
    ]),
    registry([
      required("model.author", "1", [AUTHOR]),
      required("verify.static", "3", [STATIC]),
      none("record.note", "1"),
    ]),
  );

  assertEquals(demand.schemaVersion, "project-capability-demand/2.0");
  assertEquals(demand.status, "resolved");
  assertEquals(demand.plannedCeiling.operationGroups, [
    resolved("model.author", "1", ["author-r2"], [AUTHOR]),
    resolved("record.note", "1", ["none-r1"], []),
    resolved("verify.static", "3", ["static-r1"], [STATIC]),
  ]);
  assertEquals(demand.jitDemand.operationGroups, [
    resolved("model.author", "1", ["author-r2"], [AUTHOR]),
    resolved("record.note", "1", ["none-r1"], []),
  ]);
  assertEquals(demand.plannedCeiling.capabilityRequirements, [STATIC, AUTHOR]);
  assertEquals(demand.jitDemand.capabilityRequirements, [AUTHOR]);
  assertEquals(
    demand.workItemHistory.find((item) => item.id === "old-r1"),
    {
      id: "old-r1",
      activityId: "activity:old",
      status: "cancelled",
      operation: { id: "retired.unknown", version: "1" },
      resolution: "unresolved",
      reason: "operation-unregistered",
    },
  );
  const serialized = JSON.stringify(demand);
  for (const forbidden of ["bindings", "provider", "tool", "image", "args"]) {
    assertEquals(serialized.includes(`\"${forbidden}\"`), false);
  }
  assertEquals(demand.historyPathFingerprint.algorithm, "sha256");
  assertEquals(demand.plannedCeilingFingerprint.algorithm, "sha256");
  assertEquals(demand.jitDemandFingerprint.algorithm, "sha256");
  assertEquals(demand.registryFingerprint.algorithm, "sha256");
});

Deno.test("unknown current operation stays literally unresolved and coverage uses the ceiling, never JIT", async () => {
  const demand = await compileProjectCapabilityDemand(
    project([
      workItem("unknown-r1", "activity:unknown", "planned", "unknown.operation", "1"),
      workItem("ready-r1", "activity:ready", "ready", "model.author", "1"),
    ]),
    registry([required("model.author", "1", [AUTHOR])]),
  );

  assertEquals(demand.status, "unresolved");
  const unresolved = {
    operation: { id: "unknown.operation", version: "1" },
    workItemIds: ["unknown-r1"],
    resolution: "unresolved" as const,
    reason: "operation-unregistered" as const,
  };
  assertEquals(demand.plannedCeiling.operationGroups[1], unresolved);
  assertEquals(demand.jitDemand.status, "resolved");
  assertEquals(
    evaluateProjectCapabilityDemandCoverage(demand, [allowed(AUTHOR)]),
    { fits: false, unresolvedOperationGroups: [unresolved], missingRequirements: [] },
  );
});

Deno.test("V2 fingerprints sort explicitly and bind their distinct bases", async () => {
  const entries = [
    none("record.note", "1"),
    required("model.author", "1", [AUTHOR]),
  ];
  const first = await compileProjectCapabilityDemand(
    project([
      workItem("author-r1", "activity:author", "ready", "model.author", "1"),
      workItem("none-r1", "activity:none", "ready", "record.note", "1"),
    ]),
    registry(entries),
  );
  const reordered = await compileProjectCapabilityDemand(
    project([
      workItem("none-r1", "activity:none", "ready", "record.note", "1"),
      workItem("author-r1", "activity:author", "ready", "model.author", "1"),
    ]),
    registry([...entries].reverse()),
  );
  assertEquals(first.historyPathFingerprint, reordered.historyPathFingerprint);
  assertEquals(first.plannedCeilingFingerprint, reordered.plannedCeilingFingerprint);
  assertEquals(first.jitDemandFingerprint, reordered.jitDemandFingerprint);
  assertEquals(first.registryFingerprint, reordered.registryFingerprint);

  const changedRegistry = await compileProjectCapabilityDemand(
    project([
      workItem("author-r1", "activity:author", "ready", "model.author", "1"),
      workItem("none-r1", "activity:none", "ready", "record.note", "1"),
    ]),
    registry([required("model.author", "1", [AUTHOR]), none("record.note", "2")]),
  );
  assertEquals(
    first.registryFingerprint.digest === changedRegistry.registryFingerprint.digest,
    false,
  );
  assertEquals(
    first.historyPathFingerprint.digest ===
      changedRegistry.historyPathFingerprint.digest,
    false,
  );
});

Deno.test("V2 slice fingerprints are independent canonical identities", async () => {
  const entries = [
    required("model.author", "1", [AUTHOR]),
    none("record.note", "1"),
  ];
  const initial = await compileProjectCapabilityDemand(
    project([
      workItem("author-r1", "activity:author", "ready", "model.author", "1"),
      workItem("note-r1", "activity:note", "completed", "record.note", "1"),
    ]),
    registry(entries),
  );
  const changedHistoryAndCeiling = await compileProjectCapabilityDemand(
    project([
      workItem("author-r1", "activity:author", "ready", "model.author", "1"),
      workItem("note-r1", "activity:note", "cancelled", "record.note", "1"),
    ]),
    registry(entries),
  );
  assertEquals(
    initial.jitDemandFingerprint,
    changedHistoryAndCeiling.jitDemandFingerprint,
  );
  assertEquals(
    initial.plannedCeilingFingerprint.digest ===
      changedHistoryAndCeiling.plannedCeilingFingerprint.digest,
    false,
  );
  assertEquals(
    initial.historyPathFingerprint.digest ===
      changedHistoryAndCeiling.historyPathFingerprint.digest,
    false,
  );

  const changedJitOnly = await compileProjectCapabilityDemand(
    project([
      workItem("author-r1", "activity:author", "planned", "model.author", "1"),
      workItem("note-r1", "activity:note", "completed", "record.note", "1"),
    ]),
    registry(entries),
  );
  assertEquals(
    initial.plannedCeilingFingerprint,
    changedJitOnly.plannedCeilingFingerprint,
  );
  assertEquals(
    initial.jitDemandFingerprint.digest === changedJitOnly.jitDemandFingerprint.digest,
    false,
  );
  assertEquals(
    initial.historyPathFingerprint.digest ===
      changedJitOnly.historyPathFingerprint.digest,
    false,
  );
});

Deno.test("compiler registry fingerprint is identical to the full registry identity", async () => {
  const demand = await compileProjectCapabilityDemand(
    project([
      workItem(
        "architecture-r1",
        "activity:architecture",
        "ready",
        "model.write-architecture",
        "1",
      ),
    ]),
    engineeringOperationRegistry,
  );
  assertEquals(
    demand.registryFingerprint,
    await fingerprintRegisteredEngineeringOperationRegistry(),
  );
});

Deno.test("demand closes and deduplicates hidden preparation prerequisites", async () => {
  const demand = await compileProjectCapabilityDemand(
    project([
      workItem("first", "activity:first", "ready", "verify.first", "1"),
      workItem("second", "activity:second", "ready", "verify.second", "1"),
    ]),
    registry([
      required("verify.first", "1", [AUTHOR], [{
        id: "design.prepare-module",
        version: "1",
      }]),
      required("verify.second", "1", [AUTHOR], [{
        id: "design.prepare-module",
        version: "1",
      }]),
      preparation("design.prepare-module", "1", [MODULE_PREPARATION]),
    ]),
  );

  assertEquals(demand.status, "resolved");
  assertEquals(demand.plannedCeiling.operationGroups, [
    resolved("verify.first", "1", ["first"], [MODULE_PREPARATION, AUTHOR]),
    resolved("verify.second", "1", ["second"], [MODULE_PREPARATION, AUTHOR]),
  ]);
  assertEquals(demand.plannedCeiling.capabilityRequirements, [
    MODULE_PREPARATION,
    AUTHOR,
  ]);
});

Deno.test("demand refuses absent, cyclic, and non-unique preparation prerequisites", async () => {
  const subject = project([
    workItem("assembly", "activity:assembly", "ready", "verify.assembly", "1"),
  ]);
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        subject,
        registry([
          required("verify.assembly", "1", [AUTHOR], [{
            id: "design.prepare-missing",
            version: "1",
          }]),
        ]),
      ),
    TypeError,
    "absent runtime preparation prerequisite",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        subject,
        registry([
          required("verify.assembly", "1", [AUTHOR], [{
            id: "design.prepare-a",
            version: "1",
          }]),
          preparation("design.prepare-a", "1", [MODULE_PREPARATION], [{
            id: "design.prepare-b",
            version: "1",
          }]),
          preparation("design.prepare-b", "1", [MODULE_PREPARATION], [{
            id: "design.prepare-a",
            version: "1",
          }]),
        ]),
      ),
    TypeError,
    "prerequisite cycle",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        subject,
        registry([
          required("verify.assembly", "1", [AUTHOR], [{
            id: "design.prepare-many",
            version: "1",
          }]),
          preparation("design.prepare-many", "1", [
            MODULE_PREPARATION,
            { ...MODULE_PREPARATION, id: "geometry.module.alternative" },
          ]),
        ]),
      ),
    TypeError,
    "exactly one preparation capability",
  );
});

Deno.test("V2 fails closed on malformed lifecycle histories and registry demand", async () => {
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([
          workItem("a", "activity:one", "ready", "model.author", "1", "b"),
          workItem("b", "activity:two", "ready", "model.author", "1"),
        ]),
        registry([required("model.author", "1", [AUTHOR])]),
      ),
    TypeError,
    "invalid predecessor",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([
          workItem("a", "activity:cycle", "ready", "model.author", "1", "b"),
          workItem("b", "activity:cycle", "ready", "model.author", "1", "a"),
        ]),
        registry([required("model.author", "1", [AUTHOR])]),
      ),
    TypeError,
    "predecessor cycle",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([
          workItem("a", "activity:roots", "ready", "model.author", "1"),
          workItem("b", "activity:roots", "ready", "model.author", "1"),
        ]),
        registry([required("model.author", "1", [AUTHOR])]),
      ),
    TypeError,
    "exactly one root revision",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([{
          ...workItem("a", "activity:status", "ready", "model.author", "1"),
          status: "queued",
        } as unknown as EngineeringWorkItem]),
        registry([required("model.author", "1", [AUTHOR])]),
      ),
    TypeError,
    "known EngineeringWorkItem status",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([{
          ...workItem("a", "activity:operation", "ready", "model.author", "1"),
          operation: undefined,
        }]),
        registry([required("model.author", "1", [AUTHOR])]),
      ),
    TypeError,
    "has no operation",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([
          workItem("same", "activity:a", "ready", "model.author", "1"),
          workItem("same", "activity:b", "ready", "model.author", "1"),
        ]),
        registry([required("model.author", "1", [AUTHOR])]),
      ),
    TypeError,
    "is duplicated",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([workItem("a", "activity:a", "ready", "model.author", "1")]),
        registry([
          required("model.author", "1", [AUTHOR]),
          required("model.author", "1", [AUTHOR]),
        ]),
      ),
    TypeError,
    "duplicate operation",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityDemand(
        project([workItem("a", "activity:a", "ready", "model.author", "1")]),
        registry([{
          id: "model.author",
          version: "1",
          runtimeDemand: { kind: "required", capabilities: [] },
        }]),
      ),
    TypeError,
    "nonempty capabilities",
  );
});

function capability(
  id: string,
  minimumQualification: RequiredEngineeringCapability["minimumQualification"],
): RequiredEngineeringCapability {
  return { id, version: "1", minimumQualification, use: "execution" };
}

function allowed(
  required: RequiredEngineeringCapability,
): AllowedEngineeringCapability {
  return {
    id: required.id,
    version: required.version,
    use: required.use,
    qualification: required.minimumQualification,
  };
}

function required(
  id: string,
  version: string,
  capabilities: readonly RequiredEngineeringCapability[],
  runtimePreparationPrerequisites: readonly {
    readonly id: string;
    readonly version: string;
  }[] = [],
): RuntimePreparationPrerequisiteRegistryEntry {
  return {
    id,
    version,
    execution: "trusted",
    runtimeDemand: { kind: "required" as const, capabilities },
    ...(runtimePreparationPrerequisites.length === 0
      ? {}
      : { runtimePreparationPrerequisites }),
  };
}

function preparation(
  id: string,
  version: string,
  capabilities: readonly RequiredEngineeringCapability[],
  runtimePreparationPrerequisites: readonly {
    readonly id: string;
    readonly version: string;
  }[] = [],
): RuntimePreparationPrerequisiteRegistryEntry {
  return {
    id,
    version,
    execution: "planning-only",
    prerequisiteOnly: true,
    runtimeDemand: { kind: "required" as const, capabilities },
    ...(runtimePreparationPrerequisites.length === 0
      ? {}
      : { runtimePreparationPrerequisites }),
  };
}

function none(
  id: string,
  version: string,
): RuntimePreparationPrerequisiteRegistryEntry {
  return {
    id,
    version,
    execution: "trusted",
    runtimeDemand: { kind: "none" as const },
  };
}

function registry(
  entries: readonly RuntimePreparationPrerequisiteRegistryEntry[],
): EngineeringOperationRuntimeDemandRegistryView {
  return { list: () => entries };
}

function resolved(
  id: string,
  version: string,
  workItemIds: readonly string[],
  capabilities: readonly RequiredEngineeringCapability[],
) {
  return {
    operation: { id, version },
    workItemIds,
    resolution: "resolved" as const,
    capabilities,
  };
}

function project(
  workItems: readonly EngineeringWorkItem[],
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "project-lamp:r7",
    revision: 7,
    previous: { snapshotId: "project-lamp:r6", revision: 6 },
    generatedAt: "2026-08-28T12:00:00.000Z",
    project: {
      id: "project-lamp",
      name: "Lamp",
      subjectId: "lamp",
      objective: { title: "Lamp", statement: "Build an articulated lamp." },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis: APPROVED_BRIEF_BASIS,
      publishedAt: "2026-08-28T11:00:00.000Z",
      publishedBy: { id: "agent:planner", origin: "agent" },
    },
    threadSnapshots: [],
    phases: [],
    workItems,
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function workItem(
  id: string,
  activityId: string,
  status: EngineeringWorkItem["status"],
  operationId: string,
  operationVersion: string,
  predecessorRevisionId?: string,
): EngineeringWorkItem {
  return {
    id,
    activityId,
    ...(predecessorRevisionId ? { predecessorRevisionId } : {}),
    phaseId: "phase-1",
    title: id,
    description: id,
    kind: "verify",
    operation: { id: operationId, version: operationVersion, bindings: [] },
    status,
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
}
