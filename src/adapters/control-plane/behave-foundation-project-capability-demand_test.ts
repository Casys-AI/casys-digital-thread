import { assertEquals } from "@std/assert";
import {
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
} from "../../domain/capability/engineering-capability.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import { BEHAVE_FOUNDATION_OPERATION_ROUTES } from "../../orchestration/operations/behave-foundation-routes.ts";
import { compileBehaveFoundationProjectCapabilityDemand } from "./behave-foundation-project-capability-demand.ts";

Deno.test(
  "Behave composition compiles a valid published project against the full registry",
  async () => {
    const project = validBehaveProject();
    const demand = await compileBehaveFoundationProjectCapabilityDemand(project);

    assertEquals(demand.status, "resolved");
    assertEquals(
      demand.plannedCeiling.operationGroups.map((group) => group.operation),
      [...BEHAVE_FOUNDATION_OPERATION_ROUTES]
        .sort(compareOperation),
    );
    assertEquals(demand.plannedCeiling.capabilityRequirements, [
      {
        ...GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
        minimumQualification: "qualified",
        use: "preparation",
      },
      {
        ...MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
        minimumQualification: "qualified",
        use: "execution",
      },
      {
        ...MODEL_AUTHOR_SYSTEM_CAPABILITY,
        minimumQualification: "qualified",
        use: "execution",
      },
      {
        ...MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
        minimumQualification: "qualified",
        use: "execution",
      },
    ]);
  },
);

Deno.test(
  "Behave demand resolves a registered none operation outside its route census",
  async () => {
    const source = validBehaveProject();
    const baseline = {
      ...source.workItems[0],
      id: "baseline-work",
      activityId: "activity:baseline-work",
      title: "Create baseline",
      description: "Create the registered provider-free baseline.",
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [],
      },
      status: "ready" as const,
    };
    const demand = await compileBehaveFoundationProjectCapabilityDemand({
      ...source,
      workItems: [...source.workItems, baseline],
    });

    assertEquals(
      demand.plannedCeiling.operationGroups.find((group) =>
        group.operation.id === "baseline.from-approved-brief"
      ),
      {
        operation: { id: "baseline.from-approved-brief", version: "1" },
        workItemIds: ["baseline-work"],
        resolution: "resolved",
        capabilities: [],
      },
    );
  },
);

function validBehaveProject() {
  const generatedAt = "2026-08-28T12:00:00.000Z";
  const approvedBriefFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  const basis = {
    kind: "approved-brief" as const,
    projectId: "capability-walk",
    projectSnapshotId: "capability-walk:r2",
    projectRevision: 2,
    briefId: "capability-walk:brief",
    briefSnapshotId: "capability-walk:brief:r1",
    briefRevision: 1,
    approvedBriefFingerprint,
  };
  const workItems = BEHAVE_FOUNDATION_OPERATION_ROUTES.map(
    (operation, index) => ({
      id: `behave-work-${index + 1}`,
      activityId: `activity:behave-work-${index + 1}`,
      phaseId: "behave",
      title: `Behave work ${index + 1}`,
      description: `Execute registered Behave operation ${operation.id}.`,
      kind: "verify" as const,
      operation: { ...operation, bindings: [] },
      status: "planned" as const,
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }),
  );

  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "capability-walk:r3",
    revision: 3,
    generatedAt,
    previous: { snapshotId: "capability-walk:r2", revision: 2 },
    project: {
      id: "capability-walk",
      name: "Capability walk",
      subjectId: "project:capability-walk",
      objective: {
        title: "Compile the registered Behave path.",
        statement: "Compile the registered Behave path.",
      },
    },
    framing: {
      intent: {
        statement: "Exercise the registered Behave capability path.",
        source: { kind: "human", reference: "conversation:capability-walk" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId: "capability-walk:brief",
        id: "capability-walk:brief:r1",
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Compile the registered Behave path.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:capability-walk",
          }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Walk the bounded Behave foundation operations.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:capability-walk",
          }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Produce exact provider-neutral demand.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:capability-walk",
          }],
        }],
        proposedAt: generatedAt,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: "capability-walk:brief:r1",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: approvedBriefFingerprint,
        requestedAt: generatedAt,
        decidedAt: generatedAt,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Approved for the capability walk.",
      },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis,
      publishedAt: generatedAt,
      publishedBy: { id: "agent:planner", origin: "agent" },
    },
    threadSnapshots: [],
    phases: [{
      id: "behave",
      name: "Behave",
      order: 1,
      description: "Registered Behave foundation work.",
      workItemIds: workItems.map((item) => item.id),
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems,
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: "capability-walk:r1", revision: 1 },
    }, {
      commandId: "approve",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: "capability-walk:r2", revision: 2 },
      approvedBriefBasis: basis,
    }, {
      commandId: "publish",
      type: "project.plan-publish",
      actor: { id: "agent:planner", origin: "agent" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: "capability-walk:r3", revision: 3 },
    }],
  });
}

function compareOperation(
  left: { readonly id: string; readonly version: string },
  right: { readonly id: string; readonly version: string },
): number {
  const leftKey = `${left.id}\u0000${left.version}`;
  const rightKey = `${right.id}\u0000${right.version}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
