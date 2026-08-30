import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  FileProjectCapabilityLedgerStore,
  InMemoryProjectCapabilityLedgerStore,
} from "../../adapters/control-plane/file-project-capability-ledger-store.ts";
import {
  FileCapabilityRuntimeAdminLockStore,
  FileCapabilityRuntimeAdminPolicyStore,
  FileCapabilityRuntimeHostMutationLock,
} from "../../adapters/control-plane/file-capability-runtime-host-stores.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { FileEngineeringProjectRevisionStore } from "../../adapters/shared/stores/engineering-project-store.ts";
import { ProjectBriefCommandService } from "../use-cases/project/project-brief-command-service.ts";
import { listRegisteredEngineeringOperations } from "../../orchestration/operations/registry.ts";
import {
  ProjectCapabilityAuthorizationError,
  ProjectCapabilityAuthorizationService,
} from "./project-capability-authorization-service.ts";
import { LocalCapabilityRuntimeAdminService } from "./local-capability-runtime-admin-service.ts";
import {
  fingerprintProjectCapabilityProposal,
  validateProjectCapabilityProposal,
} from "./project-capability-authorization.ts";
import type { ProjectCapabilityLedgerStore } from "../ports/out/project-capability-ledger-store.ts";
import type { ProjectCapabilityLedger } from "./project-capability-authorization.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";

Deno.test("brief capability authorization retains resolved candidates beside an unresolved authority and finalizes idempotently", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-authorization-" });
  try {
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-08-29T00:00:00.000Z") + ++tick * 1_000).toISOString();
    const projects = new FileEngineeringProjectRevisionStore(directory);
    const briefs = new ProjectBriefCommandService(projects, now);
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const lock = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/host/admin-lock.json`,
      catalog,
    );
    const ledgers = new InMemoryProjectCapabilityLedgerStore();
    const hostMutationLock = new FileCapabilityRuntimeHostMutationLock(
      `${directory}/host/mutation.lock`,
    );
    let interruptNextLockSave = false;
    const lockWriter = {
      read: () => lock.read(),
      readRevision: (revision: number) => lock.readRevision(revision),
      list: () => lock.list(),
      save: async (value: Awaited<ReturnType<typeof lock.read>>) => {
        if (interruptNextLockSave) {
          interruptNextLockSave = false;
          throw new Error("simulated ledger-to-lock interruption");
        }
        await lock.save(value);
      },
    };
    const preloads: unknown[] = [];
    const authorization = new ProjectCapabilityAuthorizationService({
      ledgers,
      registry: { list: listRegisteredEngineeringOperations },
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
      lock,
      lockWriter,
      hostMutationLock,
      preloadScheduler: {
        schedule: (proposal) => preloads.push(proposal),
      },
      now,
    });
    const started = await briefs.startProject(
      { kind: "agent", actorId: "test" },
      {
        commandId: "start",
        projectId: "capability-test",
        projectName: "Capability test",
        issuedAt: "2026-08-28T23:59:00.000Z",
        intent: "Verify an assembly.",
        intentSource: { kind: "human", reference: "conversation" },
      },
    );
    const proposed = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: "2026-08-28T23:59:10.000Z",
        items: [
          item("objective", "objective", "Verify an assembly."),
          item("mission", "mission-scenario", "Assemble a product."),
          {
            ...item("success", "success-criterion", "The result is reviewable."),
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
          {
            ...item("future", "verification-activity", "An unavailable future method."),
            dependsOnItemIds: ["success"],
            verificationAuthority: { id: "future-method", version: "1.0" },
          },
        ],
      },
    );
    const proposal = await authorization.proposeForPendingBrief(proposed);
    assertEquals(proposal.intent?.status, "unresolved");
    assertEquals(proposal.bindings.length, 1);
    assertEquals(
      proposal.bindings[0]?.candidate?.id,
      "build123d-observe-assembly-integrity",
    );
    assertEquals(proposal.units[0]?.id, "casys.mcp-build123d-observation");
    assertEquals(proposal.activation, "blocked");
    const tamperedIntent = structuredClone(proposal) as unknown as {
      intent: { authorities: unknown[] };
    };
    tamperedIntent.intent.authorities = [];
    await assertRejects(
      () => validateProjectCapabilityProposal(tamperedIntent),
      TypeError,
      "intent",
    );

    const prepared = await authorization.prepareInitial(proposal);
    assertEquals(prepared.effectiveEnvelope, null);
    const { capabilityProposalFingerprint: _proposalFingerprint, ...otherBody } =
      structuredClone(proposal);
    const otherPreparedProposal = {
      ...otherBody,
      brief: {
        ...otherBody.brief,
        briefSnapshotId: "another-pending-brief",
      },
    };
    const otherProposal = {
      ...otherPreparedProposal,
      capabilityProposalFingerprint: await fingerprintProjectCapabilityProposal(
        otherPreparedProposal,
      ),
    };
    await assertRejects(
      () => authorization.prepareInitial(otherProposal),
      ProjectCapabilityAuthorizationError,
      "different prepared capability proposal",
    );
    assertEquals(
      (await authorization.inspect(proposed.project.id)).authorization,
      "not-authorized",
    );
    const review = proposed.framing!.proposalReview!;
    const approved = await briefs.approveBrief(
      { kind: "human", actorId: "operator" },
      {
        commandId: "approve",
        projectId: proposed.project.id,
        expectedRevision: proposed.revision,
        issuedAt: "2026-08-28T23:59:20.000Z",
        briefSnapshotId: review.briefSnapshotId,
        briefRevision: review.briefRevision,
        inputFingerprint: review.inputFingerprint,
        rationale: "Confirmed.",
      },
    );
    const finalized = await authorization.finalizeInitial(approved, proposal);
    assertEquals(finalized.effectiveEnvelope?.status, "authorized");
    assertEquals(
      (await lock.read()).units.find((unit) =>
        unit.id === "casys.mcp-build123d-observation"
      )?.desired,
      "active",
    );
    assertEquals(preloads.length, 1);
    assertEquals(
      (preloads[0] as { capabilityProposalFingerprint: unknown })
        .capabilityProposalFingerprint,
      proposal.capabilityProposalFingerprint,
    );
    await assertRejects(
      () => Deno.stat(`${directory}/host/admin-lock.json`),
      Deno.errors.NotFound,
    );
    assertEquals(
      (await authorization.inspect(approved.project.id)).authorization,
      "authorized",
    );
    assertEquals(
      (await authorization.reviewPublishedPlan(approved)).status,
      "not-authorized",
    );
    const replay = await authorization.finalizeInitial(approved, proposal);
    assertEquals(replay.revision, finalized.revision);

    const editorial = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose-editorial",
        projectId: approved.project.id,
        expectedRevision: approved.revision,
        issuedAt: "2026-08-28T23:59:30.000Z",
        items: structuredClone(proposed.framing!.proposedBrief!.items).map((entry) =>
          entry.id === "objective"
            ? { ...entry, statement: "Verify the assembly with a clarified title." }
            : entry
        ),
      },
    );
    const editorialProposal = await authorization.proposeForPendingBrief(editorial);
    assertEquals(
      editorialProposal.intent?.capabilityIntentFingerprint,
      proposal.intent?.capabilityIntentFingerprint,
    );
    assertNotEquals(
      editorialProposal.capabilityProposalFingerprint,
      proposal.capabilityProposalFingerprint,
    );
    const editorialPrepared = await authorization.prepareInitial(editorialProposal);
    assertEquals(editorialPrepared.revision, finalized.revision);
    const editorialReview = editorial.framing!.proposalReview!;
    const editorialApproved = await briefs.approveBrief(
      { kind: "human", actorId: "operator" },
      {
        commandId: "approve-editorial",
        projectId: editorial.project.id,
        expectedRevision: editorial.revision,
        issuedAt: "2026-08-28T23:59:40.000Z",
        briefSnapshotId: editorialReview.briefSnapshotId,
        briefRevision: editorialReview.briefRevision,
        inputFingerprint: editorialReview.inputFingerprint,
        rationale: "Confirmed editorial revision.",
      },
    );
    const editorialFinalized = await authorization.finalizeInitial(
      editorialApproved,
      editorialProposal,
    );
    assertEquals(editorialFinalized.revision, finalized.revision);

    const changedCapability = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose-capability-change",
        projectId: editorialApproved.project.id,
        expectedRevision: editorialApproved.revision,
        issuedAt: "2026-08-28T23:59:50.000Z",
        items: [
          ...structuredClone(editorial.framing!.proposedBrief!.items),
          {
            ...item(
              "static-fea",
              "verification-activity",
              "Verify static structural behaviour.",
            ),
            dependsOnItemIds: ["success"],
            verificationAuthority: {
              id: "static-structural-fea",
              version: "1.0",
            },
          },
        ],
      },
    );
    const changedProposal = await authorization.proposeForPendingBrief(
      changedCapability,
    );
    await assertRejects(
      () => authorization.prepareInitial(changedProposal),
      ProjectCapabilityAuthorizationError,
      "different or revoked ceiling",
    );
    const localAdmin = new LocalCapabilityRuntimeAdminService({
      catalog,
      ledgers,
      lock,
      hostMutationLock,
      authorization,
    });
    const revocationReason =
      "The local operator no longer permits this project capability envelope.";
    const revocationReview = await localAdmin.revokeReview(
      approved.project.id,
      revocationReason,
    );
    // Simulate a process loss after durable ledger append but before lock
    // convergence. The original review must remain exactly replayable without
    // asking for another human decision.
    interruptNextLockSave = true;
    await assertRejects(
      () =>
        authorization.revoke(
          approved.project.id,
          finalized.effectiveEnvelope!.effectiveEnvelopeFingerprint,
          revocationReason,
        ),
      Error,
      "ledger-to-lock interruption",
    );
    const revoked = await ledgers.get(approved.project.id);
    assertEquals(revoked?.effectiveEnvelope?.status, "revoked");
    assertEquals(
      (await lock.read()).units.find((unit) =>
        unit.id === "casys.mcp-build123d-observation"
      )?.desired,
      "active",
    );
    // A retry after ledger persistence but before lock convergence is exact
    // and never needs a second human decision.
    await assertRejects(
      () =>
        localAdmin.revokeApply(
          approved.project.id,
          revocationReason,
          { algorithm: "sha256", digest: "b".repeat(64) },
          true,
        ),
      Error,
      "stale",
    );
    await localAdmin.revokeApply(
      approved.project.id,
      revocationReason,
      revocationReview.reviewFingerprint,
      true,
    );
    assertEquals((await ledgers.get(approved.project.id))?.revision, revoked?.revision);
    assertEquals(
      (await lock.read()).units.find((unit) =>
        unit.id === "casys.mcp-build123d-observation"
      )?.desired,
      "inactive",
    );
    await assertRejects(
      () => localAdmin.revokeReview(approved.project.id, "A different reason."),
      Error,
      "authorized project envelope",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("initial capability preparation resumes the exact unclaimed file revision after a crash", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-pending-retry-" });
  try {
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-08-29T01:00:00.000Z") + ++tick * 1_000).toISOString();
    const projects = new FileEngineeringProjectRevisionStore(directory);
    const briefs = new ProjectBriefCommandService(projects, now);
    const storeDirectory = `${directory}/capability-ledgers`;
    const crashingStore = new CrashAfterPendingLedgerStore(storeDirectory);
    const first = await authorizationService(crashingStore, now);
    const started = await briefs.startProject(
      { kind: "agent", actorId: "test" },
      {
        commandId: "start",
        projectId: "capability-pending-retry",
        projectName: "Capability pending retry",
        issuedAt: "2026-08-29T00:59:00.000Z",
        intent: "Verify an assembly.",
        intentSource: { kind: "human", reference: "conversation" },
      },
    );
    const pendingBrief = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: "2026-08-29T00:59:10.000Z",
        items: baselineItems(),
      },
    );
    const proposal = await first.proposeForPendingBrief(pendingBrief);
    await assertRejects(
      () => first.prepareInitial(proposal),
      Error,
      "simulated crash after pending persistence",
    );

    // A fresh service and a fresh file-store instance must reuse the persisted
    // event body rather than rebuilding it with its later `now()` value.
    const resumed = await authorizationService(
      new FileProjectCapabilityLedgerStore(storeDirectory),
      now,
    );
    const recovered = await resumed.prepareInitial(proposal);
    assertEquals(recovered.revision, 1);
    assertEquals(recovered.events[0]?.kind, "initial-prepared");
    assertEquals(
      (await resumed.inspect(proposal.projectId)).authorization,
      "not-authorized",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function authorizationService(
  ledgers: ProjectCapabilityLedgerStore,
  now: () => string,
): Promise<ProjectCapabilityAuthorizationService> {
  return new ProjectCapabilityAuthorizationService({
    ledgers,
    registry: { list: listRegisteredEngineeringOperations },
    catalog: await createFirstPartyCapabilityRuntimeCatalog(),
    qualificationSpecs: [],
    qualificationCandidates: [],
    policy: {
      schemaVersion: "capability-runtime-admin-policy/1.0",
      disabledBindingIds: [],
      preferences: [],
    },
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
}

function baselineItems() {
  return [
    item("objective", "objective", "Verify an assembly."),
    item("mission", "mission-scenario", "Assemble a product."),
    {
      ...item("success", "success-criterion", "The result is reviewable."),
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
  ];
}

class CrashAfterPendingLedgerStore implements ProjectCapabilityLedgerStore {
  #crashed = false;
  readonly #delegate: FileProjectCapabilityLedgerStore;

  constructor(private readonly directory: string) {
    this.#delegate = new FileProjectCapabilityLedgerStore(directory);
  }

  get(projectId: string) {
    return this.#delegate.get(projectId);
  }

  list() {
    return this.#delegate.list();
  }

  listPending() {
    return this.#delegate.listPending();
  }

  getPending(projectId: string) {
    return this.#delegate.getPending(projectId);
  }

  async append(
    ledger: ProjectCapabilityLedger,
    expectedRevision: number,
  ): Promise<ProjectCapabilityLedger> {
    if (this.#crashed) return await this.#delegate.append(ledger, expectedRevision);
    this.#crashed = true;
    const path = `${this.directory}/${encodeURIComponent(ledger.projectId)}`;
    await Deno.mkdir(path, { recursive: true });
    await Deno.writeTextFile(
      `${path}/${String(ledger.revision).padStart(10, "0")}.json.pending`,
      `${deterministicJson(ledger)}\n`,
      { createNew: true },
    );
    throw new Error("simulated crash after pending persistence");
  }
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

Deno.test("SysON seed after documentary baseline amends the brief ceiling instead of switching methods", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-seed-amendment-" });
  try {
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-08-29T00:00:00.000Z") + ++tick * 1_000).toISOString();
    const projects = new FileEngineeringProjectRevisionStore(directory);
    const briefs = new ProjectBriefCommandService(projects, now);
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const lock = new FileCapabilityRuntimeAdminLockStore(
      `${directory}/host/admin-lock.json`,
      catalog,
    );
    const authorization = new ProjectCapabilityAuthorizationService({
      ledgers: new InMemoryProjectCapabilityLedgerStore(),
      registry: { list: listRegisteredEngineeringOperations },
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
      lock,
      now,
    });
    const started = await briefs.startProject(
      { kind: "agent", actorId: "test" },
      {
        commandId: "start",
        projectId: "tps-capability-seed",
        projectName: "Capability seed amendment",
        issuedAt: "2026-08-28T23:59:00.000Z",
        intent: "Author a SysML container after a documentary baseline.",
        intentSource: { kind: "human", reference: "conversation" },
      },
    );
    const proposed = await briefs.proposeBrief(
      { kind: "agent", actorId: "test" },
      {
        commandId: "propose",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: "2026-08-28T23:59:10.000Z",
        items: [
          item("objective", "objective", "Seed a system model."),
          item("mission", "mission-scenario", "Create a blank SysON container."),
          {
            ...item("success", "success-criterion", "The seed is reviewable."),
            dependsOnItemIds: [],
          },
          {
            ...item(
              "assembly",
              "verification-activity",
              "Observe exact assembly facts later.",
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
        issuedAt: "2026-08-28T23:59:20.000Z",
        briefSnapshotId: review.briefSnapshotId,
        briefRevision: review.briefRevision,
        inputFingerprint: review.inputFingerprint,
        rationale: "Confirmed.",
      },
    );
    await authorization.finalizeInitial(approved, proposal);
    const seeded = {
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
      workItems: [
        plannedWorkItem({
          id: "wi-baseline",
          status: "completed",
          kind: "define",
          operationId: "baseline.from-approved-brief",
          operationVersion: "1",
        }),
        plannedWorkItem({
          id: "wi-seed",
          status: "ready",
          kind: "architect",
          operationId: "architecture.seed-syson-model",
          operationVersion: "2",
        }),
      ],
    };
    const change = await authorization.reviewPublishedPlan(seeded);
    assertEquals(change.status, "amendment-required");
    if (change.status !== "amendment-required") return;
    assertEquals(change.delta.removedRequirementKeys, []);
    assertEquals(change.delta.addedRequirementKeys, [
      "model.author-system\u00001\u0000execution",
    ]);
    assertEquals(
      change.proposal.semanticRequirements.map((requirement) => requirement.id)
        .toSorted(),
      ["geometry.observe-assembly-integrity", "model.author-system"],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function plannedWorkItem(input: {
  readonly id: string;
  readonly status: "completed" | "ready";
  readonly kind: "define" | "architect";
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
