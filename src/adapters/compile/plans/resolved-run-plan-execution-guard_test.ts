import { assertEquals, assertRejects } from "@std/assert";
import {
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanRef,
  type ResolvedOperationPlanV2,
  sameResolvedOperationPlanRef,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  EngineeringProjectCommandService,
  type EngineeringProjectPlanningDependencies,
  type EngineeringProjectPlanOperationRegistry,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type {
  CapabilityRuntimeExecutionEligibility,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  requireRecordedResolvedRunPlanExecution,
  requireResolvedRunPlanExecution,
} from "./resolved-run-plan-execution-guard.ts";

const PROJECT_ID = "project-rop2-guard";
const AGENT = { kind: "agent" as const, actorId: "agent:rop2-guard" };
const HUMAN = { kind: "human" as const, actorId: "human:rop2-guard" };
const AT = "2026-08-12T08:00:00.000Z";
const CALCULIX_PROOF_CASE = "generic-calculix-proof-case";
const CALCULIX_GEOMETRY = "generic-calculix-geometry";

type RecordedKind = "isolated" | "calculix";

type MutableFixture<T> = T extends readonly (infer Item)[] ? MutableFixture<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: MutableFixture<T[Key]> }
  : T;

interface Fixture {
  readonly kind: RecordedKind;
  readonly project: EngineeringProjectSnapshot;
  readonly plan: ResolvedOperationPlanV2;
  readonly ref: ResolvedOperationPlanRef;
  readonly snapshot: ThreadSnapshot;
  readonly store: MemoryProjectStore;
}

Deno.test("resolved run-plan execution guard admits one fully reread local CalculiX authorization", async () => {
  const fixture = await createFixture("isolated");
  const admitted = await admit(fixture);

  assertEquals(admitted.plan.action.kind, "isolated-static-structural-analysis");
  assertEquals(admitted.run.id, fixture.plan.run.runId);
  assertEquals(admitted.decision.id, fixture.plan.authorization.mrtr.decisionId);
  assertEquals(
    admitted.artifactsByBinding.get("proofCase")?.id,
    fixture.plan.sources.find((source) => source.bindingName === "proofCase")
      ?.threadRef.id,
  );
});

Deno.test("recorded run-plan guard reopens exact seals without a current runtime authorization", async () => {
  const fixture = await createFixture("isolated");
  let planReads = 0;
  const recorded = await requireRecordedResolvedRunPlanExecution({
    project: fixture.project,
    runId: fixture.plan.run.runId,
    expectedOperation: operationFor(fixture.kind),
    expectedRunStatuses: ["queued"],
    projects: fixture.store,
    snapshots: { get: () => Promise.resolve(fixture.snapshot) },
    plans: {
      read: (ref) => {
        planReads += 1;
        if (!sameResolvedOperationPlanRef(ref, fixture.ref)) {
          throw new TypeError("Plan reader refuses an arbitrary CAS reference.");
        }
        return Promise.resolve(fixture.plan);
      },
    },
  });

  assertEquals(planReads, 1);
  assertEquals(
    recorded.capabilityRuntime,
    fixture.plan.operationalCapability,
  );
});

Deno.test("resolved run-plan execution guard admits one fully reread CalculiX authorization", async () => {
  const fixture = await createFixture("calculix");
  const admitted = await admit(fixture);

  assertEquals(admitted.plan.action.kind, "static-structural-analysis");
  assertEquals(
    admitted.artifactsByBinding.get("geometry")?.mediaType,
    "model/step",
  );
  assertEquals(
    admitted.artifactsByBinding.get("geometry")?.uri,
    `/api/thread/assets/${"9".repeat(64)}.step`,
  );
  assertEquals(
    admitted.plan.sources.find((source) => source.bindingName === "geometry")
      ?.artifact.casUri,
    `casys://thread-asset/sha256/${"9".repeat(64)}`,
  );
});

Deno.test("resolved run-plan execution guard rechecks the capability runtime before an executor boundary", async () => {
  const fixture = await createFixture("isolated");
  const calls: string[] = [];
  const capabilityRuntime: CapabilityRuntimeExecutionEligibility = {
    requireExecution(input) {
      calls.push(`${input.project.id}:${input.run.id}:${input.operation.id}`);
      return Promise.resolve(undefined);
    },
  };

  await assertRejects(
    () => admit(fixture, undefined, ["queued"], capabilityRuntime),
    TypeError,
    "resolved none",
  );

  assertEquals(calls, [
    `${fixture.project.id}:${fixture.plan.run.runId}:verify.run-fea-static-proof`,
  ]);
});

Deno.test("resolved run-plan execution guard rejects a runtime binding drift after queueing", async () => {
  const fixture = await createFixture("isolated");
  const capabilityRuntime: CapabilityRuntimeExecutionEligibility = {
    requireExecution: () =>
      Promise.resolve({
        ...fixture.plan.operationalCapability,
        bindings: fixture.plan.operationalCapability.bindings.map((binding) => ({
          ...binding,
          profile: binding.profile && {
            ...binding.profile,
            fingerprint: fingerprint("f"),
          },
        })),
      }),
  };

  await assertRejects(
    () => admit(fixture, undefined, ["queued"], capabilityRuntime),
    TypeError,
    "binding changed after queueing",
  );
});

Deno.test("resolved run-plan execution guard permits the plan reader to follow only the run-stamped reference", async () => {
  const fixture = await createFixture("isolated");
  const forged = await relinkPlanReference(
    fixture.project,
    fixture.plan,
    fingerprint("f"),
  );
  let readerCalled = false;

  await assertRejects(
    () =>
      requireResolvedRunPlanExecution({
        project: forged.project,
        runId: fixture.plan.run.runId,
        expectedOperation: operationFor(fixture.kind),
        expectedRunStatuses: ["queued"],
        projects: fixture.store,
        snapshots: { get: () => Promise.resolve(fixture.snapshot) },
        plans: {
          read: (ref) => {
            readerCalled = true;
            if (!sameResolvedOperationPlanRef(ref, fixture.ref)) {
              throw new TypeError("Plan reader refuses an arbitrary CAS reference.");
            }
            return Promise.resolve(fixture.plan);
          },
        },
      }),
    TypeError,
    "arbitrary CAS reference",
  );
  assertEquals(readerCalled, true);
});

Deno.test("resolved run-plan execution guard rejects a forged queue receipt reference", async () => {
  const fixture = await createFixture("isolated");
  const forged = structuredClone(fixture.project);
  const receipt = queueReceiptFor(forged, fixture.plan.run.runId);
  (receipt.queuedRun as { resolvedOperationPlan?: ResolvedOperationPlanRef })
    .resolvedOperationPlan = {
      ...fixture.ref,
      fingerprint: fingerprint("f"),
      casUri: `casys://resolved-operation-plan/sha256/${"f".repeat(64)}`,
    };

  await assertRejects(
    () => admit({ ...fixture, project: forged }),
    Error,
    "resolved operation plan",
  );
});

Deno.test("resolved run-plan execution guard rejects a plan whose pre-queue revision hash was transplanted", async () => {
  const fixture = await createFixture("isolated");
  const plan = {
    ...fixture.plan,
    run: {
      ...fixture.plan.run,
      queueBasisProject: {
        ...fixture.plan.run.queueBasisProject,
        fingerprint: fingerprint("f"),
      },
    },
  };
  const relinked = await relinkPlanReference(fixture.project, plan);

  await assertRejects(
    () => admit({ ...fixture, plan, ...relinked }),
    TypeError,
    "pre-queue project revision",
  );
});

Deno.test("resolved run-plan execution guard rejects an MRTR authorization transplanted from another decision", async () => {
  const fixture = await createFixture("calculix");
  const plan = {
    ...fixture.plan,
    authorization: {
      ...fixture.plan.authorization,
      mrtr: {
        ...fixture.plan.authorization.mrtr,
        decisionId: "decision:another-human-review",
        approvalId: "approval:another-human-review",
        decisionInputFingerprint: fingerprint("a"),
        approvalFingerprint: fingerprint("b"),
      },
    },
  };
  const relinked = await relinkPlanReference(fixture.project, plan);

  await assertRejects(
    () => admit({ ...fixture, plan, ...relinked }),
    TypeError,
    "direct approved MRTR decision",
  );
});

Deno.test("resolved run-plan execution guard rejects exact-source URI or fingerprint drift", async () => {
  const fixture = await createFixture("isolated");
  const plan = {
    ...fixture.plan,
    sources: fixture.plan.sources.map((source) =>
      source.bindingName === "proofCase"
        ? {
          ...source,
          artifact: {
            ...source.artifact,
            fingerprint: fingerprint("f"),
            casUri: `casys://fea-proof-case-capture/sha256/${"f".repeat(64)}`,
          },
        }
        : source
    ),
  };
  const relinked = await relinkPlanReference(fixture.project, plan);

  await assertRejects(
    () => admit({ ...fixture, plan, ...relinked }),
    TypeError,
    "does not match its exact Thread artifact",
  );
});

Deno.test("resolved run-plan execution guard rejects CalculiX STEP projection or internal-CAS drift", async () => {
  const wrongDigest = "0".repeat(64);
  for (
    const [label, mutateArtifact] of [
      [
        "wrong digest",
        (artifact: ThreadArtifact) => {
          (artifact as { uri?: string }).uri = `/api/thread/assets/${wrongDigest}.step`;
        },
      ],
      [
        "wrong extension",
        (artifact: ThreadArtifact) => {
          (artifact as { uri?: string }).uri =
            `/api/thread/assets/${artifact.fingerprint.digest}.stp`;
        },
      ],
      [
        "query suffix",
        (artifact: ThreadArtifact) => {
          (artifact as { uri?: string }).uri =
            `/api/thread/assets/${artifact.fingerprint.digest}.step?download=1`;
        },
      ],
      [
        "internal CAS exposed by Thread",
        (artifact: ThreadArtifact) => {
          (artifact as { uri?: string }).uri =
            `casys://thread-asset/sha256/${artifact.fingerprint.digest}`;
        },
      ],
      [
        "wrong kind",
        (artifact: ThreadArtifact) => {
          (artifact as { kind: ThreadArtifact["kind"] }).kind = "document";
        },
      ],
      [
        "wrong media type",
        (artifact: ThreadArtifact) => {
          (artifact as { mediaType?: string }).mediaType = "application/step";
        },
      ],
    ] as const
  ) {
    const fixture = await createFixture("calculix");
    const snapshot = structuredClone(fixture.snapshot);
    const geometry = snapshot.artifacts.find((artifact) =>
      artifact.id === CALCULIX_GEOMETRY
    )!;
    mutateArtifact?.(geometry);
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    const plan = structuredClone(fixture.plan);
    (plan.basis as { fingerprint: ReturnType<typeof fingerprint> }).fingerprint =
      await sha256Fingerprint(validatedSnapshot);
    const relinked = await relinkPlanReference(fixture.project, plan);

    await assertRejects(
      () =>
        admit({
          ...fixture,
          snapshot: validatedSnapshot,
          plan,
          ...relinked,
        }),
      TypeError,
      "does not match its exact Thread artifact",
      label,
    );
  }
});

Deno.test("resolved run-plan execution guard rejects an aliased CalculiX geometry CAS plan before basis admission", async () => {
  const fixture = await createFixture("calculix");
  const plan = structuredClone(fixture.plan);
  const geometry = plan.sources.find((source) => source.bindingName === "geometry")!;
  (geometry.artifact as { casUri: string }).casUri =
    `casys://thread-asset-alias/sha256/${geometry.artifact.fingerprint.digest}`;

  await assertRejects(
    () =>
      requireResolvedRunPlanExecution({
        project: fixture.project,
        runId: fixture.plan.run.runId,
        expectedOperation: operationFor(fixture.kind),
        expectedRunStatuses: ["queued"],
        projects: fixture.store,
        snapshots: { get: () => Promise.resolve(fixture.snapshot) },
        plans: { read: () => Promise.resolve(plan) },
      }),
    TypeError,
    "must seal the exact thread-asset CAS URI",
  );
});

Deno.test("resolved run-plan execution guard rejects a changed ThreadSnapshot basis after validation", async () => {
  const fixture = await createFixture("calculix");
  const tampered = structuredClone(fixture.snapshot) as MutableFixture<
    ThreadSnapshot
  >;
  tampered.generatedAt = "2026-08-12T08:01:00.000Z";
  const validatedTamper = validateThreadSnapshot(tampered);

  await assertRejects(
    () => admit(fixture, { get: () => Promise.resolve(validatedTamper) }),
    TypeError,
    "exact canonical hash",
  );
});

Deno.test("resolved run-plan execution guard rejects a different fixed executor operation", async () => {
  const fixture = await createFixture("isolated");

  await assertRejects(
    () =>
      requireResolvedRunPlanExecution({
        project: fixture.project,
        runId: fixture.plan.run.runId,
        expectedOperation: operationFor("calculix"),
        expectedRunStatuses: ["queued"],
        projects: fixture.store,
        snapshots: { get: () => Promise.resolve(fixture.snapshot) },
        plans: { read: () => Promise.resolve(fixture.plan) },
      }),
    TypeError,
    "fixed executor",
  );
});

Deno.test("resolved run-plan execution guard lets each executor declare its fresh or recovery lifecycle states", async () => {
  const fixture = await createFixture("isolated");

  for (const status of ["queued", "running", "publishing"] as const) {
    const lifecycleFixture = fixtureWithActiveRunStatus(fixture, status);
    const admitted = await admit(lifecycleFixture, undefined, [status]);
    assertEquals(admitted.run.status, status);
  }
});

Deno.test("resolved run-plan execution guard rejects terminal and cancelled states before reading a plan", async () => {
  const fixture = await createFixture("calculix");

  for (const status of ["cancelled", "failed", "completed"] as const) {
    const project = fixtureWithUncheckedRunStatus(fixture.project, status);
    let planRead = false;
    await assertRejects(
      () =>
        requireResolvedRunPlanExecution({
          project,
          runId: fixture.plan.run.runId,
          expectedOperation: operationFor(fixture.kind),
          expectedRunStatuses: ["queued"],
          projects: fixture.store,
          snapshots: { get: () => Promise.resolve(fixture.snapshot) },
          plans: {
            read: () => {
              planRead = true;
              return Promise.resolve(fixture.plan);
            },
          },
        }),
      TypeError,
      "expectedRunStatuses",
    );
    assertEquals(planRead, false);
  }
});

async function admit(
  fixture: Fixture,
  snapshots: { get(snapshotId: string): Promise<ThreadSnapshot | undefined> } = {
    get: () => Promise.resolve(fixture.snapshot),
  },
  expectedRunStatuses: readonly [
    "queued" | "running" | "publishing",
    ...("queued" | "running" | "publishing")[],
  ] = ["queued"],
  capabilityRuntime?: CapabilityRuntimeExecutionEligibility,
) {
  return await requireResolvedRunPlanExecution({
    project: fixture.project,
    runId: fixture.plan.run.runId,
    expectedOperation: operationFor(fixture.kind),
    expectedRunStatuses,
    projects: fixture.store,
    snapshots,
    plans: {
      read: (ref) => {
        if (!sameResolvedOperationPlanRef(ref, fixture.ref)) {
          throw new TypeError("Plan reader refuses an arbitrary CAS reference.");
        }
        return Promise.resolve(fixture.plan);
      },
    },
    capabilityRuntime: capabilityRuntime ?? {
      requireExecution: () => Promise.resolve(fixture.plan.operationalCapability),
    },
  });
}

function fixtureWithActiveRunStatus(
  fixture: Fixture,
  status: "queued" | "running" | "publishing",
): Fixture {
  return {
    ...fixture,
    project: fixtureWithUncheckedRunStatus(fixture.project, status),
  };
}

function fixtureWithUncheckedRunStatus(
  project: EngineeringProjectSnapshot,
  status: "queued" | "running" | "publishing" | "cancelled" | "failed" | "completed",
): EngineeringProjectSnapshot {
  const run = project.agentRuns[0]!;
  if (status === "queued") return project;
  if (status === "running" || status === "publishing") {
    const activeRun = {
      ...run,
      status,
      claimedAt: AT,
      claimedBy: { id: AGENT.actorId, origin: AGENT.kind },
      startedAt: AT,
      statusHistory: [
        ...run.statusHistory!,
        {
          commandId: `command:claim-${status}`,
          status: "running" as const,
          at: AT,
          actor: { id: AGENT.actorId, origin: AGENT.kind },
          summary: "Claim the recorded run.",
        },
        ...(status === "publishing"
          ? [{
            commandId: "command:publish",
            status: "publishing" as const,
            at: AT,
            actor: { id: AGENT.actorId, origin: AGENT.kind },
            summary: "Publish the recorded run.",
          }]
          : []),
      ],
    };
    return { ...project, agentRuns: [activeRun] };
  }
  // The rejected-state assertions deliberately use an otherwise stale
  // snapshot: admission must stop at the lifecycle boundary before it reads a
  // plan or attempts full provenance validation.
  return { ...project, agentRuns: [{ ...run, status }] };
}

async function createFixture(kind: RecordedKind): Promise<Fixture> {
  const snapshot = await exactSnapshotFor(kind);
  const store = new MemoryProjectStore();
  const briefs = new ProjectBriefCommandService(store, () => AT);
  let project = await approvedProject(briefs);
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
  let sealed:
    | { plan: ResolvedOperationPlanV2; ref: ResolvedOperationPlanRef }
    | undefined;
  const planning: EngineeringProjectPlanningDependencies = {
    operations: recordedOperationRegistry(kind),
    queueEligibility: {
      validate: ({ project, operation }) =>
        Promise.resolve(operationalCapabilityFor(project.project.id, operation)),
    },
    runPlanSealer: {
      seal: async (input) => {
        const plan = await planFor(kind, input, snapshot);
        const ref = await planReference(plan);
        sealed = { plan, ref };
        return ref;
      },
    },
  };
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    () => AT,
    planning,
  );
  const operation = operationFor(kind);
  const sourceBindings = sourcesFor(kind, snapshot).directBindings;
  project = await commands.publishPlan(AGENT, {
    ...context(`publish-${kind}`, project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "phase-recorded-analysis",
      name: "Recorded analysis",
      description: "Execute one reviewed recorded analysis with exact evidence.",
    }],
    workItems: [{
      id: `work-${kind}`,
      phaseId: "phase-recorded-analysis",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [`decision:${kind}`],
      operation: {
        ...operation,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: `decision:${kind}`,
      phaseId: "phase-recorded-analysis",
      title: `Human approval for ${kind}`,
      question: `Approve the exact ${kind} recorded inputs?`,
    }],
  });
  // The initial plan is deliberately published from the approved brief.  The
  // fixture then models the post-baseline point at which the exact Thread
  // basis and its direct recorded sources become available for MRTR review.
  const inputEvidenceRefs: readonly EngineeringThreadEntityRef[] = sourceBindings.map((
    binding,
  ) => {
    if (binding.source.kind !== "thread-entity") {
      throw new Error("Fixture recorded source must be a Thread entity.");
    }
    return binding.source.reference;
  });
  const prepared = {
    ...project,
    threadSnapshots: [{
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
    }],
    workItems: project.workItems.map((item) =>
      item.id === `work-${kind}`
        ? {
          ...item,
          operation: { ...item.operation!, bindings: sourceBindings },
        }
        : item
    ),
    decisions: project.decisions.map((item) =>
      item.id === `decision:${kind}` ? { ...item, inputEvidenceRefs } : item
    ),
  };
  await store.commit(prepared, project.revision);
  project = (await store.get(PROJECT_ID))!;
  project = await commands.proposeDecision(AGENT, {
    ...context(`propose-${kind}`, project.revision),
    decisionId: `decision:${kind}`,
    baseSnapshot: {
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
    },
    proposal: {
      summary: `Use the exact ${kind} recorded inputs.`,
      parameters: [{ key: "method", label: "Method", value: kind }],
    },
  });
  const decision = project.decisions.find((candidate) =>
    candidate.id === `decision:${kind}`
  )!;
  project = await commands.approveDecision(HUMAN, {
    ...context(`approve-${kind}`, project.revision),
    decisionId: decision.id,
    inputFingerprint: decision.inputFingerprint!,
    rationale: `The exact ${kind} inputs are approved.`,
  });
  project = await commands.queueRun(AGENT, {
    ...context(`queue-${kind}`, project.revision),
    runId: `run:${kind}-recorded-guard`,
    workItemId: `work-${kind}`,
    summary: `Queue the exact ${kind} recorded run.`,
    basis,
  });
  if (!sealed) throw new Error("Fixture plan sealer was not called.");
  return { kind, project, snapshot, store, ...sealed };
}

function exactSnapshotFor(kind: RecordedKind): ThreadSnapshot {
  const artifacts = [
    sourceArtifact(CALCULIX_PROOF_CASE, "f", "application/json"),
    sourceArtifact(CALCULIX_GEOMETRY, "9", "model/step", "step"),
  ];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `thread:${PROJECT_ID}:${kind}:r1`,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: `project:${PROJECT_ID}`,
      name: "Generic recorded-analysis subject",
      kind: "system",
      version: "1",
      modelArtifactId: artifacts[0].id,
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: `change:${kind}:baseline`,
      name: "Capture exact generic recorded-analysis sources",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });
}

function sourcesFor(_kind: RecordedKind, snapshot: ThreadSnapshot) {
  const source = (bindingName: string, role: string, value: ThreadArtifact) => ({
    bindingName,
    role,
    threadRef: {
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: value.id,
    },
    artifact: {
      fingerprint: value.fingerprint,
      byteCount: value.id.length,
      mediaType: value.mediaType!,
      casUri: bindingName === "geometry"
        ? `casys://thread-asset/sha256/${value.fingerprint.digest}`
        : value.uri!,
    },
  });
  const proofCase = artifact(
    snapshot,
    CALCULIX_PROOF_CASE,
  );
  const geometry = artifact(
    snapshot,
    CALCULIX_GEOMETRY,
  );
  return {
    directBindings: [
      threadBinding("proofCase", proofCase, snapshot),
      threadBinding("geometry", geometry, snapshot),
    ],
    sources: [
      source("proofCase", "proof-case", proofCase),
      source("geometry", "geometry-source", geometry),
    ],
  };
}

async function planFor(
  kind: RecordedKind,
  input: RegisteredRunPlanSealInput,
  snapshot: ThreadSnapshot,
): Promise<ResolvedOperationPlanV2> {
  const sources = sourcesFor(kind, snapshot);
  const decision = input.project.decisions.find((candidate) =>
    candidate.id === input.workItem.decisionIds[0]
  )!;
  const approval = input.project.approvals.find((candidate) =>
    candidate.id === decision.approvalIds.at(-1)
  )!;
  const basis = input.run.basis;
  if (!basis || basis.kind !== "thread-snapshot" || !input.run.inputFingerprint) {
    throw new Error("Fixture requires an exact V3 ThreadSnapshot candidate.");
  }
  const common = {
    schemaVersion: "resolved-operation-plan/2.0" as const,
    id: input.run.id,
    run: {
      projectId: input.project.project.id,
      runId: input.run.id,
      workItemId: input.workItem.id,
      inputFingerprint: input.run.inputFingerprint,
      queueBasisProject: input.queueBasisProject,
    },
    workItem: {
      id: input.workItem.id,
      operation: {
        id: input.workItem.operation!.id,
        version: input.workItem.operation!.version,
      },
      operationFingerprint: await sha256Fingerprint(input.workItem.operation!),
    },
    operationalCapability: input.operationalCapability!,
    authorization: {
      kind: "human-mrtr-and-qualified-method" as const,
      mrtr: {
        decisionId: decision.id,
        decisionInputFingerprint: decision.inputFingerprint!,
        approvalId: approval.id,
        approvalFingerprint: await sha256Fingerprint(approval),
      },
      methodQualification: {
        id: kind === "isolated"
          ? "qualified-calculix-isolated-static-proof"
          : "qualified-static-structural-proof-case",
        version: "1.0",
        fingerprint: kind === "isolated"
          ? fingerprint("e")
          : sources.sources.find((source) => source.bindingName === "proofCase")!
            .artifact.fingerprint,
      },
    },
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
      fingerprint: await sha256Fingerprint(snapshot),
    },
  };
  if (kind === "isolated") {
    const proofCase = sources.sources.find((source) =>
      source.bindingName === "proofCase"
    )!;
    return {
      ...common,
      sources: sources.sources,
      action: {
        kind: "isolated-static-structural-analysis",
        executor: {
          id: "casys-local-microsandbox",
          contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
          profileFingerprint: fingerprint("e"),
        },
        lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
        requestId: "request.calculix.local.guard",
        input: {
          proofCase: {
            id: "recorded-calculix-proof",
            fingerprint: proofCase.artifact.fingerprint,
            sourceBinding: "proofCase",
          },
          geometrySourceBinding: "geometry",
          effectiveElementOrder: 1,
          effectiveTimeoutMs: 60_000,
        },
      },
      expectedProviderResources: {
        receiptSchema: "isolated-code-execution-receipt-record/1.0",
        evidenceSchema: "calculix-isolated-static-evidence/1.0",
        resourceProfile: {
          id: "calculix-isolated.static-artifacts",
          version: "1.0",
        },
      },
      recovery: {
        policy: "calculix-isolated-generation-recovery@1.0",
        requestId: "request.calculix.local.guard",
        mode: "same-request-readback-no-blind-redispatch",
        ambiguousOutcome: "quarantine-for-human-review",
        capturedOutcome: "cas-only-recovery",
      },
    };
  }
  const proofCase = sources.sources.find((source) =>
    source.bindingName === "proofCase"
  )!;
  return {
    ...common,
    sources: sources.sources,
    action: {
      kind: "static-structural-analysis",
      provider: {
        id: "mcp-calculix",
        contract: { id: "calculix_solve_static_recorded", version: "1.0" },
        executionIdentitySchema: "1.0",
        runSchema: "2.0",
        resultSchema: "2.0",
      },
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      requestId: "request.calculix.guard",
      input: {
        proofCase: {
          id: "recorded-calculix-proof",
          fingerprint: proofCase.artifact.fingerprint,
          sourceBinding: "proofCase",
        },
        geometrySourceBinding: "geometry",
        effectiveElementOrder: 1,
        effectiveTimeoutMs: 60_000,
      },
    },
    expectedProviderResources: {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-calculix.recorded-static-artifacts",
        version: "1.0",
      },
    },
    recovery: {
      policy: "mcp-calculix.recorded-static-recovery@1.0",
      requestId: "request.calculix.guard",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
}

async function planReference(
  plan: ResolvedOperationPlanV2,
): Promise<ResolvedOperationPlanRef> {
  const fingerprint = await fingerprintResolvedOperationPlanV2(plan);
  return {
    schemaVersion: "resolved-operation-plan-ref/1.0",
    planId: plan.id,
    fingerprint,
    byteCount: new TextEncoder().encode(canonicalResolvedOperationPlanV2Text(plan))
      .byteLength,
    casUri: `casys://resolved-operation-plan/sha256/${fingerprint.digest}`,
  };
}

async function relinkPlanReference(
  project: EngineeringProjectSnapshot,
  plan: ResolvedOperationPlanV2,
  forcedFingerprint?: ReturnType<typeof fingerprint>,
): Promise<
  {
    readonly project: EngineeringProjectSnapshot;
    readonly ref: ResolvedOperationPlanRef;
  }
> {
  const calculated = await planReference(plan);
  const ref = forcedFingerprint
    ? {
      ...calculated,
      fingerprint: forcedFingerprint,
      casUri: `casys://resolved-operation-plan/sha256/${forcedFingerprint.digest}`,
    }
    : calculated;
  const rewritten = structuredClone(project);
  const run = rewritten.agentRuns.find((candidate) => candidate.id === plan.run.runId)!;
  (run as { resolvedOperationPlan?: ResolvedOperationPlanRef }).resolvedOperationPlan =
    ref;
  (queueReceiptFor(rewritten, run.id).queuedRun as {
    resolvedOperationPlan?: ResolvedOperationPlanRef;
  }).resolvedOperationPlan = ref;
  return { project: rewritten, ref };
}

function operationFor(kind: RecordedKind) {
  return kind === "isolated"
    ? { id: "verify.run-fea-static-proof", version: "3" }
    : { id: "verify.run-fea-static-proof", version: "2" };
}

function operationalCapabilityFor(
  projectId: string,
  operation: { readonly id: string; readonly version: string },
): NonNullable<RegisteredRunPlanSealInput["operationalCapability"]> {
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId,
    operation: { id: operation.id, version: operation.version },
    authorizationFingerprint: fingerprint("a"),
    demandFingerprint: fingerprint("b"),
    registryFingerprint: fingerprint("c"),
    bindings: [{
      capability: {
        id: "mechanics.solve-static-structural",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "calculix-static-structural", version: "1" },
      effectiveQualification: "qualified",
      adapter: { id: "casys.calculix-worker", version: "1", source: "test" },
      profile: {
        id: "calculix-static",
        version: "1",
        fingerprint: fingerprint("d"),
      },
      materials: [{
        unitId: "casys.calculix-worker",
        materialId: "calculix-worker",
        imageDigest: "e".repeat(64),
      }],
      runtimeModes: [{
        material: {
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: "e".repeat(64),
        },
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material: {
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: "e".repeat(64),
        },
        kind: "ephemeral-microsandbox",
        launchGroup: null,
      }],
    }],
  };
}

function recordedOperationRegistry(
  kind: RecordedKind,
): EngineeringProjectPlanOperationRegistry {
  const operation = operationFor(kind);
  return {
    validate(input) {
      if (
        input.operation.id !== operation.id ||
        input.operation.version !== operation.version
      ) {
        throw new TypeError(
          "Fixture registry only accepts its fixed recorded operation.",
        );
      }
      return {
        operation: {
          ...operation,
          startingPoint: "idea-or-spec" as const,
          title: `Recorded ${kind}`,
          description: "Test-only fixed recorded operation.",
          workItemKind: "verify" as const,
          execution: "trusted" as const,
          resolvedOperationPlan: "2.0" as const,
          decisionEvidenceScope: "thread-entity-bindings" as const,
        },
        bindings: input.operation.bindings,
      };
    },
  };
}

function threadBinding(
  name: string,
  artifact: ThreadArtifact,
  snapshot: ThreadSnapshot,
) {
  return {
    name,
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: snapshot.id,
        snapshotRevision: snapshot.revision,
        kind: "artifact" as const,
        id: artifact.id,
      },
    },
  };
}

function artifact(snapshot: ThreadSnapshot, id: string): ThreadArtifact {
  const value = snapshot.artifacts.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Fixture artifact ${id} is absent.`);
  return value;
}

function sourceArtifact(
  id: string,
  digestCharacter: string,
  mediaType: string,
  kind: ThreadArtifact["kind"] = "document",
): ThreadArtifact {
  const digest = digestCharacter.repeat(64);
  return {
    id,
    name: id,
    kind,
    version: "1",
    fingerprint: { algorithm: "sha256", digest },
    uri: kind === "step"
      ? `/api/thread/assets/${digest}.step`
      : `casys://guard-source/sha256/${digest}`,
    mediaType,
    producer: {
      serverId: "fixture-source",
      tool: "capture",
      runId: `run:${id}`,
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function queueReceiptFor(project: EngineeringProjectSnapshot, runId: string) {
  const receipt = project.commandReceipts?.find((candidate) =>
    candidate.type === "agent-run.queue" && candidate.queuedRun?.runId === runId
  );
  if (!receipt) throw new Error(`Queue receipt for ${runId} is absent.`);
  return receipt;
}

async function approvedProject(service: ProjectBriefCommandService) {
  let project = await service.startProject(AGENT, {
    commandId: "start-rop2-guard-project",
    projectId: PROJECT_ID,
    projectName: "ROP2 execution guard",
    issuedAt: AT,
    intent: "Prove that only exactly sealed recorded operations execute.",
    intentSource: { kind: "human", reference: "conversation:rop2-guard" },
  });
  project = await service.proposeBrief(AGENT, {
    ...context("propose-rop2-guard-brief", project.revision),
    items: briefItems(),
  });
  const brief = project.framing!.proposedBrief!;
  const review = project.framing!.proposalReview!;
  return await service.approveBrief(HUMAN, {
    ...context("approve-rop2-guard-brief", project.revision),
    briefSnapshotId: brief.id,
    briefRevision: brief.revision,
    rationale: "The bounded authorization objective is approved.",
    inputFingerprint: review.inputFingerprint,
  });
}

function briefItems(): readonly ProjectBriefItem[] {
  return [{
    id: "objective",
    kind: "objective",
    statement: "Execute a recorded analysis only from exactly reviewed evidence.",
    sourceRefs: [{ kind: "intent", reference: "conversation:rop2-guard" }],
  }, {
    id: "mission",
    kind: "mission-scenario",
    statement: "Run one bounded CalculiX case after human review.",
    sourceRefs: [{ kind: "intent", reference: "conversation:rop2-guard" }],
  }, {
    id: "success",
    kind: "success-criterion",
    statement: "The execution admission is tied to exact technical evidence.",
    sourceRefs: [{ kind: "intent", reference: "conversation:rop2-guard" }],
    dependsOnItemIds: [],
  }, {
    id: "verify",
    kind: "verification-activity",
    statement: "Verify the recorded authorization before provider execution.",
    sourceRefs: [{ kind: "intent", reference: "conversation:rop2-guard" }],
    dependsOnItemIds: ["success"],
  }];
}

function context(commandId: string, expectedRevision: number) {
  return { commandId, projectId: PROJECT_ID, expectedRevision, issuedAt: AT };
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((snapshot) => snapshot.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Project already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale project revision.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
