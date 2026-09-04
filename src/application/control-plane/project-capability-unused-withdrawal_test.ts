import { assertEquals, assertRejects } from "@std/assert";
import { InMemoryProjectCapabilityLedgerStore } from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import { FileCapabilityRuntimeAdminPolicyStore } from "../../adapters/control-plane/file-capability-runtime-host-stores.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { FileEngineeringProjectRevisionStore } from "../../adapters/shared/stores/engineering-project-store.ts";
import { ProjectBriefCommandService } from "../use-cases/project/project-brief-command-service.ts";
import { listRegisteredEngineeringOperations } from "../../orchestration/operations/registry.ts";
import {
  ProjectCapabilityAuthorizationError,
  ProjectCapabilityAuthorizationService,
} from "./project-capability-authorization-service.ts";
import { isStrictUnusedWithdrawalDelta } from "../../domain/capability/project-capability-authorization.ts";
import {
  type CapabilityRuntimeCatalog,
  fingerprintAtomicCapabilityRuntimeUnit,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";

Deno.test("explicit unused withdrawal shrinks a covered subset and later demand needs an amendment", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-unused-withdrawal-" });
  try {
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-08-30T00:00:00.000Z") + ++tick * 1_000).toISOString();
    const projects = new FileEngineeringProjectRevisionStore(directory);
    const briefs = new ProjectBriefCommandService(projects, now);
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const ledgers = new InMemoryProjectCapabilityLedgerStore();
    const authorization = new ProjectCapabilityAuthorizationService({
      ledgers,
      registry: { list: listRegisteredEngineeringOperations },
      recordedPlans: unusedRecordedPlans(),
      catalog,
      qualificationSpecs: [],
      qualificationCandidates: [],
      policy: new FileCapabilityRuntimeAdminPolicyStore(
        `${directory}/host/admin-policy.json`,
        catalog,
      ),
      host: {
        schemaVersion: "capability-runtime-host-observation/1.0",
        identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        platform: "linux/arm64",
        images: [],
      },
      lock: {
        schemaVersion: "capability-runtime-admin-lock/1.0",
        revision: 0,
        previous: null,
        units: [],
      },
      now,
    });
    const started = await briefs.startProject(
      { kind: "agent", actorId: "test" },
      {
        commandId: "start",
        projectId: "capability-unused-withdrawal",
        projectName: "Unused withdrawal",
        issuedAt: "2026-08-29T23:59:00.000Z",
        intent: "Observe assembly after a broader brief.",
        intentSource: { kind: "human", reference: "conversation" },
      },
    );
    const proposed = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: "2026-08-29T23:59:10.000Z",
        items: [
          item("objective", "objective", "Observe an assembly."),
          item("mission", "mission-scenario", "Keep unused authoring capacity."),
          {
            ...item("success", "success-criterion", "The observation is reviewable."),
            dependsOnItemIds: [],
          },
          {
            ...item(
              "assembly",
              "verification-activity",
              "Observe exact assembly facts.",
            ),
            dependsOnItemIds: ["success"],
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          },
        ],
      },
    );
    const proposal = await authorization.proposeForPendingBrief(proposed);
    await authorization.prepareInitial(proposal);
    const review = proposed.framing!.proposalReview!;
    const approved = await briefs.approveBrief(
      { kind: "human", actorId: "operator" },
      {
        commandId: "approve",
        projectId: proposed.project.id,
        expectedRevision: proposed.revision,
        issuedAt: "2026-08-29T23:59:20.000Z",
        briefSnapshotId: review.briefSnapshotId,
        briefRevision: review.briefRevision,
        inputFingerprint: review.inputFingerprint,
        rationale: "Confirmed.",
      },
    );
    await authorization.finalizeInitial(approved, proposal);
    const seedPlan = publishedPlan(approved, [
      plannedWorkItem({
        id: "wi-baseline",
        status: "completed",
        kind: "define",
        operationId: "baseline.from-approved-brief",
        operationVersion: "1",
      }),
      plannedWorkItem({
        id: "wi-assembly",
        status: "ready",
        kind: "verify",
        operationId: "verify.observe-assembly-integrity",
        operationVersion: "1",
      }),
      plannedWorkItem({
        id: "wi-static-fea",
        status: "ready",
        kind: "verify",
        operationId: "verify.run-fea-static-proof",
        operationVersion: "3",
      }),
    ]);
    const widening = await authorization.reviewPublishedPlan(seedPlan);
    assertEquals(widening.status, "amendment-required");
    if (widening.status !== "amendment-required") return;
    await authorization.authorizeAmendment(
      seedPlan,
      widening.proposal.capabilityProposalFingerprint,
    );
    const assemblyPlan = publishedPlan(approved, seedPlan.workItems.slice(0, 2));
    const before = await ledgers.get(assemblyPlan.project.id);
    assertEquals(
      (await authorization.reviewPublishedPlan(assemblyPlan)).status,
      "covered",
    );
    assertEquals(
      (await ledgers.get(assemblyPlan.project.id))?.revision,
      before?.revision,
    );

    const withdrawal = await authorization.reviewUnusedWithdrawal(assemblyPlan);
    assertEquals(withdrawal.status, "withdrawal-required");
    if (withdrawal.status !== "withdrawal-required") return;
    assertEquals(withdrawal.delta.addedRequirementKeys, []);
    assertEquals(withdrawal.delta.requirementReplacements, []);
    assertEquals(
      withdrawal.delta.removedRequirementKeys.includes(
        "mechanics.solve-static-structural\u00001\u0000execution",
      ),
      true,
    );
    assertEquals(
      withdrawal.delta.bindingReplacements.every((replacement) =>
        replacement.next === null && replacement.previous !== null
      ),
      true,
    );
    assertEquals(
      (await ledgers.get(assemblyPlan.project.id))?.revision,
      before?.revision,
    );

    await assertRejects(
      () =>
        authorization.authorizeUnusedWithdrawal(assemblyPlan, {
          algorithm: "sha256",
          digest: "b".repeat(64),
        }),
      ProjectCapabilityAuthorizationError,
      "no longer matches",
    );
    assertEquals(
      (await ledgers.get(assemblyPlan.project.id))?.revision,
      before?.revision,
    );

    const withdrawn = await authorization.authorizeUnusedWithdrawal(
      assemblyPlan,
      withdrawal.proposal.capabilityProposalFingerprint,
    );
    assertEquals(withdrawn.events.at(-1)?.kind, "amendment-authorized");
    const event = withdrawn.events.at(-1);
    if (event?.kind !== "amendment-authorized") return;
    assertEquals(event.delta, withdrawal.delta);
    assertEquals(
      event.proposalFingerprint,
      withdrawal.proposal.capabilityProposalFingerprint,
    );
    assertEquals(
      withdrawn.effectiveEnvelope?.proposal.semanticRequirements.some(
        (requirement) => requirement.id === "mechanics.solve-static-structural",
      ),
      false,
    );
    assertEquals(
      (await authorization.reviewUnusedWithdrawal(assemblyPlan)).status,
      "no-change",
    );

    const restored = await authorization.reviewPublishedPlan(seedPlan);
    assertEquals(restored.status, "amendment-required");
    if (restored.status !== "amendment-required") return;
    assertEquals(
      restored.delta.addedRequirementKeys.includes(
        "mechanics.solve-static-structural\u00001\u0000execution",
      ),
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("unused withdrawal may resolve unknown security and unknown bytes by removing unused material", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "capability-unused-withdrawal-unknown-",
  });
  try {
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-08-30T00:00:00.000Z") + ++tick * 1_000).toISOString();
    const projects = new FileEngineeringProjectRevisionStore(directory);
    const briefs = new ProjectBriefCommandService(projects, now);
    const catalog = await catalogWithUnknownUnusedCalculix();
    const authorization = new ProjectCapabilityAuthorizationService({
      ledgers: new InMemoryProjectCapabilityLedgerStore(),
      registry: { list: listRegisteredEngineeringOperations },
      recordedPlans: unusedRecordedPlans(),
      catalog,
      qualificationSpecs: [],
      qualificationCandidates: [],
      policy: new FileCapabilityRuntimeAdminPolicyStore(
        `${directory}/host/admin-policy.json`,
        catalog,
      ),
      host: {
        schemaVersion: "capability-runtime-host-observation/1.0",
        identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        platform: "linux/arm64",
        images: [],
      },
      lock: {
        schemaVersion: "capability-runtime-admin-lock/1.0",
        revision: 0,
        previous: null,
        units: [],
      },
      now,
    });
    const started = await briefs.startProject(
      { kind: "agent", actorId: "test" },
      {
        commandId: "start",
        projectId: "capability-unused-unknown",
        projectName: "Unused unknown withdrawal",
        issuedAt: "2026-08-29T23:59:00.000Z",
        intent: "Observe assembly after a broader brief.",
        intentSource: { kind: "human", reference: "conversation" },
      },
    );
    const proposed = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: "2026-08-29T23:59:10.000Z",
        items: [
          item("objective", "objective", "Observe an assembly."),
          item("mission", "mission-scenario", "Keep unused authoring capacity."),
          {
            ...item("success", "success-criterion", "The observation is reviewable."),
            dependsOnItemIds: [],
          },
          {
            ...item(
              "assembly",
              "verification-activity",
              "Observe exact assembly facts.",
            ),
            dependsOnItemIds: ["success"],
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          },
        ],
      },
    );
    const proposal = await authorization.proposeForPendingBrief(proposed);
    assertEquals(proposal.effects.security, "reviewed");
    assertEquals(typeof proposal.effects.downloadBytes, "number");
    await authorization.prepareInitial(proposal);
    const review = proposed.framing!.proposalReview!;
    const approved = await briefs.approveBrief(
      { kind: "human", actorId: "operator" },
      {
        commandId: "approve",
        projectId: proposed.project.id,
        expectedRevision: proposed.revision,
        issuedAt: "2026-08-29T23:59:20.000Z",
        briefSnapshotId: review.briefSnapshotId,
        briefRevision: review.briefRevision,
        inputFingerprint: review.inputFingerprint,
        rationale: "Confirmed.",
      },
    );
    await authorization.finalizeInitial(approved, proposal);
    const seedPlan = publishedPlan(approved, [
      plannedWorkItem({
        id: "wi-baseline",
        status: "completed",
        kind: "define",
        operationId: "baseline.from-approved-brief",
        operationVersion: "1",
      }),
      plannedWorkItem({
        id: "wi-assembly",
        status: "ready",
        kind: "verify",
        operationId: "verify.observe-assembly-integrity",
        operationVersion: "1",
      }),
      plannedWorkItem({
        id: "wi-static-fea",
        status: "ready",
        kind: "verify",
        operationId: "verify.run-fea-static-proof",
        operationVersion: "3",
      }),
    ]);
    const widening = await authorization.reviewPublishedPlan(seedPlan);
    assertEquals(widening.status, "amendment-required");
    if (widening.status !== "amendment-required") return;
    const authorizedWithUnused = await authorization.authorizeAmendment(
      seedPlan,
      widening.proposal.capabilityProposalFingerprint,
    );
    assertEquals(
      authorizedWithUnused.effectiveEnvelope?.proposal.effects.security,
      "unknown",
    );
    assertEquals(
      authorizedWithUnused.effectiveEnvelope?.proposal.effects.downloadBytes,
      null,
    );
    assertEquals(
      authorizedWithUnused.effectiveEnvelope?.proposal.effects.storageBytes,
      null,
    );

    const assemblyPlan = publishedPlan(approved, seedPlan.workItems.slice(0, 2));
    assertEquals(
      (await authorization.reviewPublishedPlan(assemblyPlan)).status,
      "covered",
    );
    const kinematicsPlan = publishedPlan(approved, [
      ...assemblyPlan.workItems,
      plannedWorkItem({
        id: "wi-kinematics",
        status: "ready",
        kind: "verify",
        operationId: "verify.run-prescribed-kinematics",
        operationVersion: "1",
      }),
    ]);
    const wideningWithdrawal = await authorization.reviewUnusedWithdrawal(
      kinematicsPlan,
    );
    assertEquals(wideningWithdrawal.status === "withdrawal-required", false);
    assertEquals(
      wideningWithdrawal.status === "amendment-required" ||
        wideningWithdrawal.status === "method-transition-required" ||
        wideningWithdrawal.status === "unresolved",
      true,
    );

    const withdrawal = await authorization.reviewUnusedWithdrawal(assemblyPlan);
    assertEquals(withdrawal.status, "withdrawal-required");
    if (withdrawal.status !== "withdrawal-required") return;
    assertEquals(isStrictUnusedWithdrawalDelta(withdrawal.delta), true);
    assertEquals(withdrawal.delta.effects.added.security, "reviewed");
    assertEquals(withdrawal.delta.effects.removed.security, "unknown");
    assertEquals(withdrawal.delta.effects.downloadBytes.previous, null);
    assertEquals(typeof withdrawal.delta.effects.downloadBytes.next, "number");
    assertEquals(withdrawal.delta.effects.storageBytes.previous, null);
    assertEquals(typeof withdrawal.delta.effects.storageBytes.next, "number");
    assertEquals(
      (withdrawal.delta.effects.downloadBytes.next ?? 0) > 0,
      true,
    );

    const withdrawn = await authorization.authorizeUnusedWithdrawal(
      assemblyPlan,
      withdrawal.proposal.capabilityProposalFingerprint,
    );
    assertEquals(withdrawn.effectiveEnvelope?.proposal.effects.security, "reviewed");
    assertEquals(
      typeof withdrawn.effectiveEnvelope?.proposal.effects.downloadBytes,
      "number",
    );
    assertEquals(
      withdrawn.effectiveEnvelope?.proposal.effects.downloadBytes,
      withdrawal.delta.effects.downloadBytes.next,
    );
    assertEquals(
      (await authorization.reviewUnusedWithdrawal(assemblyPlan)).status,
      "no-change",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function catalogWithUnknownUnusedCalculix(): Promise<CapabilityRuntimeCatalog> {
  const catalog = JSON.parse(
    JSON.stringify(await createFirstPartyCapabilityRuntimeCatalog()),
  ) as CapabilityRuntimeCatalog;
  for (const unit of catalog.units as unknown as MutableCatalogUnit[]) {
    for (const material of unit.materials) {
      if (unit.id === "casys.calculix-worker") {
        material.effects.security = "unknown";
        material.effects.downloadBytes = null;
        material.effects.storageBytes = null;
      } else {
        material.effects.downloadBytes = 12;
        material.effects.storageBytes = 20;
      }
    }
    unit.manifestFingerprint = await fingerprintAtomicCapabilityRuntimeUnit(
      unit as unknown as CapabilityRuntimeCatalog["units"][number],
    );
  }
  return catalog;
}

type MutableCatalogUnit = {
  id: string;
  version: string;
  materials: Array<{
    effects: {
      downloadBytes: number | null;
      storageBytes: number | null;
      security: "reviewed" | "unknown";
    };
    [key: string]: unknown;
  }>;
  manifestFingerprint: CapabilityRuntimeCatalog["units"][number]["manifestFingerprint"];
};

function publishedPlan(
  approved: EngineeringProjectSnapshot,
  workItems: EngineeringProjectSnapshot["workItems"],
): EngineeringProjectSnapshot {
  return {
    ...approved,
    plan: {
      startingPoint: "idea-or-spec" as const,
      basis: {
        kind: "approved-brief" as const,
        projectId: approved.project.id,
        projectSnapshotId: approved.id,
        projectRevision: approved.revision,
        briefId: approved.framing!.currentBrief!.briefId,
        briefSnapshotId: approved.framing!.currentBrief!.id,
        briefRevision: approved.framing!.currentBrief!.revision,
        approvedBriefFingerprint: approved.framing!.currentBriefApproval!
          .inputFingerprint,
      },
      publishedAt: approved.generatedAt,
      publishedBy: { id: "agent:test", origin: "agent" as const },
    },
    threadSnapshots: [{
      revision: 1,
      snapshotId: `project:${approved.project.id}:r1:approved-brief-baseline`,
      subjectId: `project:${approved.project.id}`,
    }],
    workItems,
  };
}

function plannedWorkItem(input: {
  readonly id: string;
  readonly status: "completed" | "ready";
  readonly kind: "define" | "architect" | "verify";
  readonly operationId: string;
  readonly operationVersion: string;
}) {
  return {
    id: input.id,
    activityId: `activity:${input.id}`,
    phaseId: "phase-1",
    title: input.id,
    description: input.id,
    kind: input.kind,
    status: input.status,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    decisionIds: [],
    evidenceRefs: [],
    blockerIds: [],
    operation: {
      id: input.operationId,
      version: input.operationVersion,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
  };
}

function unusedRecordedPlans() {
  return {
    read: () =>
      Promise.reject(
        new TypeError("Recorded run plans are not composed in this fixture."),
      ),
  };
}

function item(
  id: string,
  kind:
    | "objective"
    | "mission-scenario"
    | "success-criterion"
    | "verification-activity",
  statement: string,
) {
  return {
    id,
    kind,
    statement,
    sourceRefs: [{ kind: "intent" as const, reference: "conversation" }],
  };
}
