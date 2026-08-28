import { assertEquals, assertRejects } from "@std/assert";
import { evaluateProjectCapabilityDemandCoverage } from "../../domain/capability/project-capability-demand.ts";
import type {
  AllowedEngineeringCapability,
  RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION,
  type CapabilityRequirementCatalog,
  type OperationCapabilityRequirement,
} from "./read-model/capability-demand.ts";
import { compileProjectCapabilityDemandFromServerCatalog } from "./compile-project-capability-demand.ts";

const APPROVED_BRIEF_BASIS: EngineeringApprovedBriefBasis = {
  kind: "approved-brief",
  projectId: "project-lamp",
  projectSnapshotId: "project-lamp:r3",
  projectRevision: 3,
  briefId: "brief-lamp",
  briefSnapshotId: "brief-lamp:r2",
  briefRevision: 2,
  approvedBriefFingerprint: {
    algorithm: "sha256",
    digest: "a".repeat(64),
  },
};

const COMMON_COMPATIBLE = capability(
  "model.author-system",
  "compatible",
);
const COMMON_QUALIFIED = capability("model.author-system", "qualified");
const STATIC_QUALIFIED = capability(
  "mechanics.solve-static-structural",
  "qualified",
);

Deno.test(
  "project capability demand canonically groups the exact path and keeps the strongest flattened requirement",
  async () => {
    const first = await compileProjectCapabilityDemandFromServerCatalog(
      project([
        workItem("work-z", "verify.static", "3"),
        workItem("work-a", "model.author", "1"),
        workItem("work-b", "verify.static", "3"),
      ]),
      catalog([
        requirement("verify.static", "3", [
          STATIC_QUALIFIED,
          COMMON_QUALIFIED,
        ]),
        requirement("model.author", "1", [COMMON_COMPATIBLE]),
      ]),
    );
    const reordered = await compileProjectCapabilityDemandFromServerCatalog(
      project([
        workItem("work-b", "verify.static", "3"),
        workItem("work-a", "model.author", "1"),
        workItem("work-z", "verify.static", "3"),
      ]),
      catalog([
        requirement("model.author", "1", [COMMON_COMPATIBLE]),
        requirement("verify.static", "3", [
          COMMON_QUALIFIED,
          STATIC_QUALIFIED,
        ]),
      ]),
    );

    assertEquals(first.mutatesRuntime, false);
    assertEquals(first.status, "resolved");
    assertEquals(first.projectSnapshot, {
      projectId: "project-lamp",
      snapshotId: "project-lamp:r7",
      revision: 7,
    });
    assertEquals(first.approvedBriefBasis, APPROVED_BRIEF_BASIS);
    assertEquals(
      first.operationGroups.map((group) => ({
        operation: group.operation,
        workItemIds: group.workItemIds,
        resolution: group.resolution,
      })),
      [
        {
          operation: { id: "model.author", version: "1" },
          workItemIds: ["work-a"],
          resolution: "resolved",
        },
        {
          operation: { id: "verify.static", version: "3" },
          workItemIds: ["work-b", "work-z"],
          resolution: "resolved",
        },
      ],
    );
    assertEquals(first.capabilityRequirements, [
      STATIC_QUALIFIED,
      COMMON_QUALIFIED,
    ]);
    assertEquals(first.pathFingerprint, reordered.pathFingerprint);
    assertEquals(
      first.capabilitySetFingerprint,
      reordered.capabilitySetFingerprint,
    );
    assertEquals(first.pathFingerprint.algorithm, "sha256");
    assertEquals(first.pathFingerprint.digest.length, 64);

    const nextRevisionInput = project([
      workItem("work-a", "model.author", "1"),
      workItem("work-b", "verify.static", "3"),
      workItem("work-z", "verify.static", "3"),
    ]);
    const nextRevision = await compileProjectCapabilityDemandFromServerCatalog(
      { ...nextRevisionInput, id: "project-lamp:r8", revision: 8 },
      catalog([
        requirement("model.author", "1", [COMMON_COMPATIBLE]),
        requirement("verify.static", "3", [
          COMMON_QUALIFIED,
          STATIC_QUALIFIED,
        ]),
      ]),
    );
    assertEquals(
      first.pathFingerprint.digest === nextRevision.pathFingerprint.digest,
      false,
    );
    assertEquals(
      first.capabilitySetFingerprint,
      nextRevision.capabilitySetFingerprint,
    );

    const serialized = JSON.stringify(first);
    for (const forbidden of ["bindings", "provider", "tool", "image", "args"]) {
      assertEquals(serialized.includes(`\"${forbidden}\"`), false);
    }
  },
);

Deno.test(
  "unknown catalogue operation remains explicit and makes coverage fail closed",
  async () => {
    const input = project([workItem("work-a", "model.author", "1")]);
    const unresolved = await compileProjectCapabilityDemandFromServerCatalog(
      input,
      catalog([]),
    );
    const resolved = await compileProjectCapabilityDemandFromServerCatalog(
      input,
      catalog([
        requirement("model.author", "1", [COMMON_COMPATIBLE]),
      ]),
    );

    assertEquals(unresolved.status, "unresolved");
    assertEquals(unresolved.operationGroups, [{
      operation: { id: "model.author", version: "1" },
      workItemIds: ["work-a"],
      resolution: "unresolved",
      reason: "catalog-entry-missing",
    }]);
    assertEquals(unresolved.capabilityRequirements, []);
    assertEquals(unresolved.pathFingerprint, resolved.pathFingerprint);
    assertEquals(
      unresolved.capabilitySetFingerprint === resolved.capabilitySetFingerprint,
      false,
    );
    assertEquals(
      evaluateProjectCapabilityDemandCoverage(unresolved, [
        allowed(COMMON_QUALIFIED),
      ]),
      {
        fits: false,
        unresolvedOperationGroups: [{
          operation: { id: "model.author", version: "1" },
          workItemIds: ["work-a"],
          resolution: "unresolved",
          reason: "catalog-entry-missing",
        }],
        missingRequirements: [],
      },
    );
  },
);

Deno.test(
  "coverage requires exact capability version and use with equal-or-stronger qualification",
  async () => {
    const demand = await compileProjectCapabilityDemandFromServerCatalog(
      project([
        workItem("work-a", "model.author", "1"),
        workItem("work-b", "verify.static", "3"),
      ]),
      catalog([
        requirement("model.author", "1", [COMMON_COMPATIBLE]),
        requirement("verify.static", "3", [STATIC_QUALIFIED]),
      ]),
    );

    assertEquals(
      evaluateProjectCapabilityDemandCoverage(demand, [
        allowed(COMMON_QUALIFIED),
        allowed(STATIC_QUALIFIED),
      ]),
      {
        fits: true,
        unresolvedOperationGroups: [],
        missingRequirements: [],
      },
    );
    const weakerStatic = allowed(STATIC_QUALIFIED, "compatible");
    const wrongUse = {
      ...allowed(COMMON_QUALIFIED),
      use: "preparation" as const,
    };
    assertEquals(
      evaluateProjectCapabilityDemandCoverage(demand, [
        wrongUse,
        weakerStatic,
      ]),
      {
        fits: false,
        unresolvedOperationGroups: [],
        missingRequirements: [STATIC_QUALIFIED, COMMON_COMPATIBLE],
      },
    );
    const wrongVersion = {
      ...allowed(STATIC_QUALIFIED),
      version: "2",
    };
    assertEquals(
      evaluateProjectCapabilityDemandCoverage(demand, [
        allowed(COMMON_QUALIFIED),
        wrongVersion,
      ]),
      {
        fits: false,
        unresolvedOperationGroups: [],
        missingRequirements: [STATIC_QUALIFIED],
      },
    );
  },
);

Deno.test(
  "compiler fails closed on absent plan and duplicate or conflicting catalogue declarations",
  async () => {
    const input = project([workItem("work-a", "model.author", "1")]);
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          { ...input, plan: undefined },
          catalog([]),
        ),
      TypeError,
      "project.plan-publish",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          input,
          catalog([
            requirement("model.author", "1", [COMMON_COMPATIBLE]),
            requirement("model.author", "1", [COMMON_QUALIFIED]),
          ]),
        ),
      TypeError,
      "duplicate operation model.author@1",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          input,
          catalog([
            requirement("model.author", "1", [
              COMMON_COMPATIBLE,
              COMMON_QUALIFIED,
            ]),
          ]),
        ),
      TypeError,
      "duplicate or conflicting model.author-system@1 execution demand",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          project([workItem("work-a", "model.author", "latest")]),
          catalog([]),
        ),
      TypeError,
      "mutable version alias",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          project([workItem("work-a", " model.author", "1")]),
          catalog([]),
        ),
      TypeError,
      "edge whitespace",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          project([workItem("human-note")]),
          catalog([]),
        ),
      TypeError,
      "has no registered operation",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          input,
          catalog([requirement("model.author", "1", [])]),
        ),
      TypeError,
      "must declare at least one capability",
    );
    await assertRejects(
      () =>
        compileProjectCapabilityDemandFromServerCatalog(
          {
            ...input,
            plan: {
              ...input.plan!,
              basis: { ...input.plan!.basis, projectId: "other-project" },
            },
          },
          catalog([]),
        ),
      TypeError,
      "same project",
    );
  },
);

function capability(
  id: string,
  minimumQualification: RequiredEngineeringCapability["minimumQualification"],
  use: RequiredEngineeringCapability["use"] = "execution",
): RequiredEngineeringCapability {
  return { id, version: "1", minimumQualification, use };
}

function allowed(
  required: RequiredEngineeringCapability,
  qualification = required.minimumQualification,
): AllowedEngineeringCapability {
  return {
    id: required.id,
    version: required.version,
    use: required.use,
    qualification,
  };
}

function requirement(
  id: string,
  version: string,
  capabilities: readonly RequiredEngineeringCapability[],
): OperationCapabilityRequirement {
  return { operation: { id, version }, capabilities };
}

function catalog(
  entries: readonly OperationCapabilityRequirement[],
): CapabilityRequirementCatalog {
  return {
    schemaVersion: CAPABILITY_REQUIREMENT_CATALOG_SCHEMA_VERSION,
    scope: "behave-foundation",
    entries,
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
  operationId?: string,
  operationVersion?: string,
): EngineeringWorkItem {
  return {
    id,
    activityId: `activity:${id}`,
    phaseId: "phase-1",
    title: id,
    description: id,
    kind: "verify",
    ...(operationId && operationVersion
      ? {
        operation: {
          id: operationId,
          version: operationVersion,
          bindings: [{
            name: "approvedBrief",
            source: { kind: "approved-brief" as const },
          }],
        },
      }
      : {}),
    status: "planned",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
}
