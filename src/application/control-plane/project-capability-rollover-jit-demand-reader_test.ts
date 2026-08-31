import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartySysonRolloverPredecessorUnit } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { MODEL_AUTHOR_SYSTEM_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import {
  fingerprintProjectCapabilityAuthorizationEvent,
  fingerprintProjectCapabilityProposal,
  PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
  type ProjectCapabilityAuthorizationEvent,
  type ProjectCapabilityLedger,
  type ProjectCapabilityProposal,
  reconstructProjectCapabilityEffectiveEnvelope,
} from "./project-capability-authorization.ts";
import { ProjectCapabilityRolloverJitDemandReader } from "./project-capability-rollover-jit-demand-reader.ts";

const PROJECT_ID = "project-rollover";
const REQUIREMENT = {
  ...MODEL_AUTHOR_SYSTEM_CAPABILITY,
  minimumQualification: "qualified" as const,
  use: "execution" as const,
};

Deno.test("rollover JIT reader recognizes an exact predecessor SysON ledger without consulting the successor catalogue", async () => {
  const ledger = await predecessorLedger();
  const reader = new ProjectCapabilityRolloverJitDemandReader({
    projects: { get: () => Promise.resolve(project("model.author")) },
    operations: registry("model.author"),
    ledgers: ledgerStore(ledger),
  });

  assertEquals(
    await reader.hasRemainingDemand({
      projectId: PROJECT_ID,
      unitId: "casys.syson-stack",
    }),
    true,
  );
  assertEquals(
    await reader.hasRemainingDemand({
      projectId: PROJECT_ID,
      unitId: "casys.mcp-chrono",
    }),
    false,
  );
});

Deno.test("rollover JIT reader fails closed for unresolved registered demand", async () => {
  const ledger = await predecessorLedger();
  const reader = new ProjectCapabilityRolloverJitDemandReader({
    projects: { get: () => Promise.resolve(project("unknown.operation")) },
    operations: registry("model.author"),
    ledgers: ledgerStore(ledger),
  });

  await assertRejects(
    () =>
      reader.hasRemainingDemand({ projectId: PROJECT_ID, unitId: "casys.syson-stack" }),
    Error,
    "unresolved",
  );
});

async function predecessorLedger(): Promise<ProjectCapabilityLedger> {
  const unit = await createFirstPartySysonRolloverPredecessorUnit();
  const body = {
    schemaVersion: PROJECT_CAPABILITY_PROPOSAL_SCHEMA_VERSION,
    mutatesRuntime: false as const,
    projectId: PROJECT_ID,
    source: "published-plan" as const,
    brief: {
      briefSnapshotId: "brief",
      briefRevision: 1,
      briefReviewFingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
    },
    intent: null,
    semanticRequirements: [REQUIREMENT],
    bindings: [{
      requirement: REQUIREMENT,
      status: "selected" as const,
      binding: {
        id: "syson-author-system",
        version: "1",
        qualification: "qualified" as const,
      },
      unitIds: [unit.id],
      reasons: [],
    }],
    units: [unit],
    materials: unit.materials.map((material) => ({
      unitId: unit.id,
      materialId: material.id,
      imageReference: material.imageReference,
      mode: "native" as const,
      downloadBytes: material.effects.downloadBytes,
      storageBytes: material.effects.storageBytes,
    })),
    effects: {
      downloadBytes: 0,
      storageBytes: 0,
      services: [],
      volumes: [],
      networks: [],
      loopbackPorts: [],
      bindMounts: [],
      privileged: false as const,
      dockerSocket: false as const,
      devices: [],
      secretSlots: [],
      licences: [],
      security: "reviewed" as const,
    },
    status: "ready" as const,
    activation: "allowed" as const,
    blockers: [],
  };
  const proposal: ProjectCapabilityProposal = {
    ...body,
    capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(body),
  };
  const preparedBody = {
    kind: "initial-prepared" as const,
    recordedAt: "2026-08-30T10:00:00.000Z",
    proposal,
  };
  const prepared: ProjectCapabilityAuthorizationEvent = {
    ...preparedBody,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(
      preparedBody,
    ),
  };
  const authorizedBody = {
    kind: "initial-authorized" as const,
    recordedAt: "2026-08-30T10:00:01.000Z",
    proposalFingerprint: proposal.capabilityProposalFingerprint,
    approval: {
      projectSnapshotId: "project-rollover:r1",
      projectRevision: 1,
      approvedBriefFingerprint: proposal.brief.briefReviewFingerprint,
    },
  };
  const authorized: ProjectCapabilityAuthorizationEvent = {
    ...authorizedBody,
    eventFingerprint: await fingerprintProjectCapabilityAuthorizationEvent(
      authorizedBody,
    ),
  };
  const effectiveEnvelope = await reconstructProjectCapabilityEffectiveEnvelope([
    prepared,
    authorized,
  ]);
  return {
    schemaVersion: "project-capability-ledger/1.0",
    projectId: PROJECT_ID,
    revision: 2,
    previous: { algorithm: "sha256", digest: "2".repeat(64) },
    events: [prepared, authorized],
    effectiveEnvelope,
    ledgerFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
  };
}

function ledgerStore(ledger: ProjectCapabilityLedger): ProjectCapabilityLedgerStore {
  return {
    get: (projectId) => Promise.resolve(projectId === PROJECT_ID ? ledger : undefined),
    list: () => Promise.resolve([ledger]),
    listPending: () => Promise.resolve([]),
    getPending: () => Promise.resolve(undefined),
    append: () => Promise.reject(new Error("not used by rollover JIT reader")),
  };
}

function registry(knownOperation: string) {
  return {
    list: () => [{
      id: knownOperation,
      version: "1",
      runtimeDemand: {
        kind: "required" as const,
        capabilities: [REQUIREMENT],
      },
    }],
  };
}

function project(operationId: string): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "project-rollover:r1",
    revision: 1,
    previous: null,
    generatedAt: "2026-08-30T10:00:00.000Z",
    project: {
      id: PROJECT_ID,
      name: "Rollover",
      subjectId: "rollover",
      objective: { title: "Rollover", statement: "Test the SysON rollover." },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis: {
        kind: "approved-brief",
        projectId: PROJECT_ID,
        projectSnapshotId: "project-rollover:r1",
        projectRevision: 1,
        briefId: "brief",
        briefSnapshotId: "brief:r1",
        briefRevision: 1,
        approvedBriefFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      },
      publishedAt: "2026-08-30T09:00:00.000Z",
      publishedBy: { id: "agent:test", origin: "agent" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [{
      id: "work-author-r1",
      activityId: "activity:author",
      status: "ready",
      title: "Author system",
      operation: { id: operationId, version: "1" },
      basis: { kind: "approved-brief", id: "brief", revision: 1 },
      inputs: [],
      predecessors: [],
      successors: [],
      createdAt: "2026-08-30T09:00:00.000Z",
      updatedAt: "2026-08-30T09:00:00.000Z",
    }],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  } as unknown as EngineeringProjectSnapshot;
}
