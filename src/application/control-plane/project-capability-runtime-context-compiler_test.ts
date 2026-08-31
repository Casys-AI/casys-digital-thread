import { assertEquals } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { InMemoryProjectCapabilityLedgerStore } from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { listRegisteredEngineeringOperations } from "../../orchestration/operations/registry.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  FixedCapabilityRuntimeAdminLockReader,
  FixedCapabilityRuntimeAdminPolicyReader,
  FixedCapabilityRuntimeHostObservationReader,
  ProjectCapabilityRuntimeContextCompiler,
} from "./project-capability-runtime-context-compiler.ts";

Deno.test("runtime context compiler reconstructs a fresh plan from durable authorities without implicit authorization", async () => {
  const compiler = new ProjectCapabilityRuntimeContextCompiler({
    registry: { list: listRegisteredEngineeringOperations },
    catalog: await createFirstPartyCapabilityRuntimeCatalog(),
    qualificationSpecs: [],
    qualificationCandidates: [],
    policy: new FixedCapabilityRuntimeAdminPolicyReader({
      schemaVersion: "capability-runtime-admin-policy/1.0",
      disabledBindingIds: [],
      preferences: [],
    }),
    host: new FixedCapabilityRuntimeHostObservationReader({
      schemaVersion: "capability-runtime-host-observation/1.0",
      identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      platform: "linux/arm64",
      images: [],
    }),
    lock: new FixedCapabilityRuntimeAdminLockReader({
      schemaVersion: "capability-runtime-admin-lock/1.0",
      revision: 0,
      previous: null,
      units: [],
    }),
    ledgers: new InMemoryProjectCapabilityLedgerStore(),
  });

  const context = await compiler.read(project());

  assertEquals(context.demand.projectSnapshot, {
    projectId: "project:context",
    snapshotId: "project:context:r7",
    revision: 7,
  });
  assertEquals(context.demand.registryFingerprint.algorithm, "sha256");
  assertEquals(context.authorization, undefined);
  assertEquals(
    context.plan.bindings.some((binding) =>
      binding.requirement.id === "mechanics.solve-static-structural"
    ),
    true,
  );
});

Deno.test("runtime context compiler observes only demanded catalogue materials", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const observed: string[] = [];
  const compiler = new ProjectCapabilityRuntimeContextCompiler({
    registry: { list: listRegisteredEngineeringOperations },
    catalog,
    qualificationSpecs: [],
    qualificationCandidates: [],
    policy: new FixedCapabilityRuntimeAdminPolicyReader({
      schemaVersion: "capability-runtime-admin-policy/1.0",
      disabledBindingIds: [],
      preferences: [],
    }),
    host: {
      read: (scope) => {
        observed.push(
          ...(scope?.materials ?? []).map(capabilityRuntimeMaterialKey),
        );
        return Promise.resolve({
          schemaVersion: "capability-runtime-host-observation/1.0",
          identityFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          platform: "linux/arm64",
          images: [],
        });
      },
    },
    lock: new FixedCapabilityRuntimeAdminLockReader({
      schemaVersion: "capability-runtime-admin-lock/1.0",
      revision: 0,
      previous: null,
      units: [],
    }),
    ledgers: new InMemoryProjectCapabilityLedgerStore(),
  });

  await compiler.read(project());
  assertEquals(
    observed.includes("casys.calculix-worker\u0000calculix-worker-image"),
    true,
  );

  observed.length = 0;
  await compiler.read(seedProject());
  assertEquals(
    observed.includes("casys.calculix-worker\u0000calculix-worker-image"),
    false,
  );
  assertEquals(
    observed.some((key) => key.startsWith("casys.syson-stack\u0000")),
    true,
  );
});

function project(): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "project:context:r7",
    revision: 7,
    previous: { snapshotId: "project:context:r6", revision: 6 },
    generatedAt: "2026-08-29T00:00:00.000Z",
    project: {
      id: "project:context",
      name: "Context test",
      subjectId: "context-test",
      objective: { title: "Context test", statement: "Verify a static proof." },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis: {
        kind: "approved-brief",
        projectId: "project:context",
        projectSnapshotId: "project:context:r3",
        projectRevision: 3,
        briefId: "brief:context",
        briefSnapshotId: "brief:context:r2",
        briefRevision: 2,
        approvedBriefFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      },
      publishedAt: "2026-08-29T00:00:00.000Z",
      publishedBy: { id: "agent:test", origin: "agent" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [{
      id: "work:static",
      activityId: "activity:static",
      phaseId: "phase:verify",
      title: "Static proof",
      description: "Static proof",
      kind: "verify",
      operation: {
        id: "verify.run-fea-static-proof",
        version: "3",
        bindings: [],
      },
      status: "ready",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function seedProject(): EngineeringProjectSnapshot {
  const base = project();
  return {
    ...base,
    project: {
      ...base.project,
      objective: { title: "Seed", statement: "Author a SysON container." },
    },
    workItems: [{
      ...base.workItems[0]!,
      id: "work:seed",
      activityId: "activity:seed",
      kind: "architect",
      title: "SysON seed",
      description: "SysON seed",
      operation: {
        id: "architecture.seed-syson-model",
        version: "2",
        bindings: [],
      },
    }],
  };
}
