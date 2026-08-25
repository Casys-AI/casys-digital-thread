import { assertEquals } from "@std/assert";
import type {
  AssemblyIntegrityInputResolver,
  ExactAssemblyIntegrityInputRequest,
  ResolvedAssemblyIntegrityInput,
} from "../../../application/ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type {
  AssemblyIntegrityObserverProfileCatalog,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import type {
  AssemblyIntegrityReviewResolutionRequest,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-review-resolver.ts";
import type {
  EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import { PrepareProjectAssemblyIntegrityReview } from "../../../application/use-cases/cad/assembly-integrity/prepare-project-assembly-integrity-review.ts";
import { EngineeringProjectCommandService } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import {
  type AssemblyIntegrityObserverProfile,
  createAssemblyIntegrityObserverProfile,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import { ProjectAssemblyIntegrityReviewResolver } from "./project-assembly-integrity-review-resolver.ts";

const PROJECT_ID = "project.assembly-review";
const SUBJECT_ID = `project:${PROJECT_ID}`;
const SNAPSHOT_ID = "snapshot.assembly-review-r1";
const AT = "2026-08-26T04:00:00.000Z";
const AGENT = { kind: "agent" as const, actorId: "agent:assembly-review" };
const HUMAN = { kind: "human" as const, actorId: "human:assembly-review" };

function fingerprint(character: string) {
  return { algorithm: "sha256", digest: character.repeat(64) } as const;
}

function request(): AssemblyIntegrityReviewResolutionRequest {
  return {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot",
      snapshotId: SNAPSHOT_ID,
      revision: 1,
      subjectId: SUBJECT_ID,
    },
    geometryModule: {
      artifactId: `geometry-${"a".repeat(64)}`,
      fingerprint: fingerprint("a"),
    },
  };
}

async function profile(): Promise<AssemblyIntegrityObserverProfile> {
  return await createAssemblyIntegrityObserverProfile({
    schemaVersion: "assembly-integrity-observer-profile/1.0",
    profile: { id: "assembly-integrity-observer", version: "1.0.0" },
    capability: { id: "assembly-integrity-observer", version: "1.0.0" },
    method: {
      id: "assembly-integrity-factual-v1",
      version: "1.0.0",
      linearToleranceMm: 0.000001,
    },
    producer: {
      rawSchemaVersion: "provider-observation/1.0",
      engine: { id: "engine", version: "1.0.0" },
      package: { id: "package", version: "1.0.0" },
    },
    configuredRuntime: { kind: "image-digest", imageDigest: fingerprint("b") },
    maximumStepBytes: 1,
    maximumOccurrences: 2,
    maximumPairs: 1,
  });
}

class FixedProfiles implements AssemblyIntegrityObserverProfileCatalog {
  constructor(private readonly value: AssemblyIntegrityObserverProfile) {}

  initial(): Promise<AssemblyIntegrityObserverProfile> {
    return Promise.resolve(this.value);
  }

  resolve(): Promise<AssemblyIntegrityObserverProfile> {
    return Promise.resolve(this.value);
  }
}

class CapturingInputs implements AssemblyIntegrityInputResolver {
  readonly calls: ExactAssemblyIntegrityInputRequest[] = [];

  constructor(private readonly selected: AssemblyIntegrityObserverProfile) {}

  resolve(
    value: ExactAssemblyIntegrityInputRequest,
  ): Promise<ResolvedAssemblyIntegrityInput> {
    this.calls.push(structuredClone(value));
    return Promise.resolve({
      basis: value.basis,
      geometryModule: value.geometryModule,
      profile: this.selected,
      observerProfile: value.observerProfile,
    } as ResolvedAssemblyIntegrityInput);
  }
}

Deno.test("assembly-integrity review resolver reopens one current basis and passes its exact server profile to the lower resolver", async () => {
  const selected = await profile();
  const snapshot = threadSnapshot();
  const inputs = new CapturingInputs(selected);
  let snapshotReads = 0;
  const resolver = new ProjectAssemblyIntegrityReviewResolver({
    projects: { get: () => Promise.resolve(projectSnapshot(snapshot)) },
    snapshots: {
      get: () => {
        snapshotReads += 1;
        return Promise.resolve(snapshot);
      },
    },
    inputs,
    profiles: new FixedProfiles(selected),
  });

  const result = await resolver.resolve(request());

  assertEquals(result.status, "resolved");
  assertEquals(snapshotReads, 1);
  assertEquals(inputs.calls, [{
    basis: {
      snapshotId: SNAPSHOT_ID,
      revision: 1,
      subjectId: SUBJECT_ID,
    },
    snapshot,
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${"a".repeat(64)}`,
      fingerprint: fingerprint("a"),
    },
    observerProfile: {
      profile: selected.profile,
      fingerprint: selected.profileFingerprint,
    },
  }]);
  if (result.status !== "resolved") throw new Error("Expected resolved review.");
  assertEquals(result.admission.observer.configuredRuntime, selected.configuredRuntime);
  assertEquals("existingWork" in result, false);
});

Deno.test("assembly-integrity review resolver refuses a non-current basis before snapshot or lower-input reopening", async () => {
  const selected = await profile();
  const snapshot = threadSnapshot();
  const inputs = new CapturingInputs(selected);
  let snapshotReads = 0;
  const resolver = new ProjectAssemblyIntegrityReviewResolver({
    projects: { get: () => Promise.resolve(projectSnapshot(snapshot)) },
    snapshots: {
      get: () => {
        snapshotReads += 1;
        return Promise.resolve(snapshot);
      },
    },
    inputs,
    profiles: new FixedProfiles(selected),
  });

  const stale = request();
  const result = await resolver.resolve({
    ...stale,
    basis: { ...stale.basis, revision: 4 },
  });

  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") throw new Error("Expected unresolved review.");
  assertEquals(result.diagnostics[0]?.code, "basis-not-current");
  assertEquals(snapshotReads, 0);
  assertEquals(inputs.calls, []);
});

Deno.test("assembly-integrity review resolver uses one structurally exact planned leaf and produces proposal-only review output", async () => {
  const selected = await profile();
  const planned = await plannedProject({
    gateRole: "contributes-to",
  });
  const inputs = new CapturingInputs(selected);
  const resolver = reviewResolver(planned.store, inputs, selected);

  const resolution = await resolver.resolve(request());
  if (resolution.status !== "resolved") {
    throw new Error(`Expected resolved leaf: ${JSON.stringify(resolution)}`);
  }
  assertEquals(resolution.existingWork, {
    phaseId: "assembly-phase-1",
    workItemId: "assembly-work-1",
    decision: {
      id: "assembly-decision-1",
      title: "Approve factual assembly observation",
      question: "May the exact factual assembly observation run?",
    },
    gateClaims: [{
      gateItemId: "verify-assembly",
      role: "contributes-to",
      status: "current",
    }],
  });

  const review = await new PrepareProjectAssemblyIntegrityReview({ resolver })
    .execute(request());
  if (review.status !== "resolved") throw new Error("Expected resolved review.");
  assertEquals("append" in review.next, false);
  assertEquals(review.next.propose.arguments.decisionId, "assembly-decision-1");
  assertEquals(inputs.calls.length, 2);
});

Deno.test("assembly-integrity review resolver permits multiple distinct matching authority claims", async () => {
  const selected = await profile();
  const planned = await plannedProject({
    gateRole: "contributes-to",
    gateItemIds: ["verify-assembly", "verify-assembly-alt"],
  });
  const resolution = await reviewResolver(
    planned.store,
    new CapturingInputs(selected),
    selected,
  ).resolve(request());

  assertEquals(resolution.status, "resolved");
  if (resolution.status !== "resolved") return;
  assertEquals(resolution.existingWork?.gateClaims.map((claim) => claim.gateItemId), [
    "verify-assembly",
    "verify-assembly-alt",
  ]);
});

Deno.test("assembly-integrity review resolver leaves zero matching planned leaves on the bounded append fallback", async () => {
  const selected = await profile();
  const planned = await plannedProject({ workCount: 0 });
  const resolver = reviewResolver(
    planned.store,
    new CapturingInputs(selected),
    selected,
  );

  const resolution = await resolver.resolve(request());
  if (resolution.status !== "resolved") throw new Error("Expected resolved fallback.");
  assertEquals("existingWork" in resolution, false);

  const review = await new PrepareProjectAssemblyIntegrityReview({ resolver })
    .execute(request());
  if (review.status !== "resolved") throw new Error("Expected resolved review.");
  assertEquals("append" in review.next, true);
});

Deno.test("assembly-integrity review resolver fails closed on ambiguous, satisfies, or stale-brief planned leaves", async () => {
  const selected = await profile();
  for (
    const scenario of [
      { name: "ambiguous", workCount: 2 },
      { name: "satisfies", workCount: 1, gateRole: "satisfies" as const },
      { name: "stale-brief", workCount: 1, reviseBrief: true },
    ]
  ) {
    const planned = await plannedProject(scenario);
    const inputs = new CapturingInputs(selected);
    const resolution = await reviewResolver(planned.store, inputs, selected)
      .resolve(request());

    assertEquals(resolution.status, "unresolved", scenario.name);
    if (resolution.status !== "unresolved") {
      throw new Error(`Expected unresolved ${scenario.name} review.`);
    }
    assertEquals(resolution.diagnostics[0]?.code, "planned-observation-invalid");
    assertEquals(inputs.calls, [], scenario.name);
  }
});

Deno.test("assembly-integrity review resolver refuses unrelated, other-authority, or unqualified gate claims", async () => {
  const selected = await profile();
  for (
    const gateItemId of [
      "success",
      "verify-other",
      "verify-unqualified",
    ] as const
  ) {
    const planned = await plannedProject({
      gateRole: "contributes-to",
      gateItemId,
    });
    const inputs = new CapturingInputs(selected);
    const resolution = await reviewResolver(planned.store, inputs, selected)
      .resolve(request());

    assertEquals(resolution.status, "unresolved", gateItemId);
    if (resolution.status !== "unresolved") {
      throw new Error(`Expected unresolved ${gateItemId} review.`);
    }
    assertEquals(resolution.diagnostics[0]?.code, "planned-observation-invalid");
    assertEquals(inputs.calls, [], gateItemId);
  }
});

Deno.test("assembly-integrity review resolver accepts a successor leaf but refuses a reviewed revision with a successor", async () => {
  const selected = await profile();
  const current = await plannedProject({ successor: "exact" });
  const accepted = await reviewResolver(
    current.store,
    new CapturingInputs(selected),
    selected,
  ).resolve(request());
  if (accepted.status !== "resolved") {
    throw new Error(`Expected current successor leaf: ${JSON.stringify(accepted)}`);
  }
  assertEquals(accepted.existingWork?.workItemId, "assembly-work-successor");

  const superseded = await plannedProject({ successor: "nonmatching" });
  const inputs = new CapturingInputs(selected);
  const refused = await reviewResolver(superseded.store, inputs, selected)
    .resolve(request());
  assertEquals(refused.status, "unresolved");
  if (refused.status !== "unresolved") {
    throw new Error("Expected a superseded revision to be unresolved.");
  }
  assertEquals(refused.diagnostics[0]?.code, "planned-observation-invalid");
  assertEquals(inputs.calls, []);
});

interface PlannedProjectOptions {
  readonly workCount?: number;
  readonly gateRole?: "contributes-to" | "satisfies";
  readonly gateItemId?:
    | "success"
    | "verify-assembly"
    | "verify-other"
    | "verify-unqualified";
  readonly gateItemIds?: readonly (
    | "success"
    | "verify-assembly"
    | "verify-assembly-alt"
    | "verify-other"
    | "verify-unqualified"
  )[];
  readonly reviseBrief?: boolean;
  readonly successor?: "exact" | "nonmatching";
}

function reviewResolver(
  projects: Pick<EngineeringProjectRevisionStore, "get">,
  inputs: AssemblyIntegrityInputResolver,
  selected: AssemblyIntegrityObserverProfile,
): ProjectAssemblyIntegrityReviewResolver {
  const snapshot = threadSnapshot();
  return new ProjectAssemblyIntegrityReviewResolver({
    projects,
    snapshots: {
      get: (snapshotId) =>
        Promise.resolve(
          snapshotId === snapshot.id ? snapshot : undefined,
        ),
    },
    inputs,
    profiles: new FixedProfiles(selected),
  });
}

async function plannedProject(
  options: PlannedProjectOptions,
): Promise<{ readonly store: MemoryProjectStore }> {
  const store = new MemoryProjectStore();
  let tick = 0;
  const now = () => new Date(Date.parse(AT) + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(store, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-assembly-review",
    projectId: PROJECT_ID,
    projectName: "Assembly review fixture",
    issuedAt: AT,
    intent: "Prepare a factual assembly observation from exact evidence.",
    intentSource: { kind: "human", reference: "conversation:assembly-review" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...command("propose-assembly-brief", project.revision),
    items: briefItems("Prepare a factual assembly observation from exact evidence."),
  });
  project = await briefs.approveBrief(HUMAN, {
    ...command("approve-assembly-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The factual observation boundary is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    store,
    { validate: () => Promise.resolve() },
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  project = await commands.publishPlan(AGENT, {
    ...command("publish-assembly-baseline", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline-phase",
      name: "Baseline",
      description: "Record the approved brief before factual observation.",
    }],
    workItems: [{
      id: "baseline-work",
      phaseId: "baseline-phase",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...command("queue-assembly-baseline", project.revision),
    runId: "run:assembly-baseline",
    workItemId: "baseline-work",
    summary: "Queue the approved documentary baseline.",
    basis: project.plan!.basis,
  });
  project = await commands.claimRun(AGENT, {
    ...command("claim-assembly-baseline", project.revision),
    runId: "run:assembly-baseline",
    summary: "Claim the approved documentary baseline.",
  });
  project = await commands.publishRun(AGENT, {
    ...command("publish-run-assembly-baseline", project.revision),
    runId: "run:assembly-baseline",
    summary: "Publish the approved documentary baseline.",
  });
  const basis = {
    snapshotId: SNAPSHOT_ID,
    revision: 1,
    subjectId: SUBJECT_ID,
  };
  project = await commands.completeRun(AGENT, {
    ...command("complete-assembly-baseline", project.revision),
    runId: "run:assembly-baseline",
    summary: "Complete the approved documentary baseline.",
    resultSnapshot: basis,
    evidenceRefs: [{
      snapshotId: basis.snapshotId,
      snapshotRevision: basis.revision,
      kind: "artifact",
      id: request().geometryModule.artifactId,
    }],
  });

  const gateRole = options.gateRole;
  const gateClaims = gateRole === undefined
    ? undefined
    : (options.gateItemIds ?? [options.gateItemId ?? "verify-assembly"])
      .map((gateItemId) => ({
        gateItemId,
        role: gateRole,
        status: "current" as const,
      }));

  for (let index = 1; index <= (options.workCount ?? 1); index += 1) {
    const phaseId = `assembly-phase-${index}`;
    const workItemId = `assembly-work-${index}`;
    const decisionId = `assembly-decision-${index}`;
    project = await commands.appendChange(AGENT, {
      ...command(`append-assembly-observation-${index}`, project.revision),
      baseSnapshot: basis,
      phases: [{
        id: phaseId,
        name: "Factual assembly observation",
        description: "Prepare one exact factual assembly observation.",
      }],
      workItems: [{
        id: workItemId,
        phaseId,
        owner: "agent",
        dependsOnWorkItemIds: ["baseline-work"],
        decisionIds: [decisionId],
        operation: assemblyObservationOperation(),
        ...(gateClaims === undefined ? {} : { gateClaims }),
      }],
      requiredDecisions: [{
        id: decisionId,
        phaseId,
        title: "Approve factual assembly observation",
        question: "May the exact factual assembly observation run?",
      }],
    });
  }

  if (options.successor !== undefined) {
    if ((options.workCount ?? 1) !== 1) {
      throw new TypeError("Successor test fixtures require exactly one root revision.");
    }
    if (options.successor === "exact") {
      project = await commands.appendChange(AGENT, {
        ...command("append-assembly-observation-successor", project.revision),
        baseSnapshot: basis,
        phases: [{
          id: "assembly-phase-successor",
          name: "Factual assembly observation successor",
          description: "Revise the exact factual assembly observation leaf.",
        }],
        workItems: [{
          id: "assembly-work-successor",
          phaseId: "assembly-phase-successor",
          owner: "agent",
          predecessorRevisionId: "assembly-work-1",
          dependsOnWorkItemIds: ["baseline-work"],
          decisionIds: ["assembly-decision-successor"],
          operation: assemblyObservationOperation(),
        }],
        requiredDecisions: [{
          id: "assembly-decision-successor",
          phaseId: "assembly-phase-successor",
          title: "Approve factual assembly observation successor",
          question: "May the revised exact factual assembly observation run?",
        }],
      });
    } else {
      project = await commands.appendChange(AGENT, {
        ...command("append-nonmatching-assembly-successor", project.revision),
        baseSnapshot: basis,
        phases: [{
          id: "assembly-phase-nonmatching-successor",
          name: "Nonmatching successor fixture",
          description: "Make the prior factual observation revision historical.",
        }],
        workItems: [{
          id: "assembly-work-nonmatching-successor",
          phaseId: "assembly-phase-nonmatching-successor",
          owner: "agent",
          predecessorRevisionId: "assembly-work-1",
          dependsOnWorkItemIds: ["baseline-work"],
          decisionIds: [],
          operation: {
            id: "simulate.run-qualified-modelica-kit",
            version: "1",
            bindings: [],
          },
        }],
        requiredDecisions: [],
      });
    }
  }

  if (options.reviseBrief === true) {
    project = await briefs.proposeBrief(AGENT, {
      ...command("propose-revised-assembly-brief", project.revision),
      items: briefItems("Prepare a revised factual assembly observation mandate."),
    });
    project = await briefs.approveBrief(HUMAN, {
      ...command("approve-revised-assembly-brief", project.revision),
      briefSnapshotId: project.framing!.proposedBrief!.id,
      briefRevision: project.framing!.proposedBrief!.revision,
      rationale: "The revised factual observation mandate is clear.",
      inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
    });
  }
  return { store };
}

function command(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: AT,
  };
}

function briefItems(objective: string) {
  const source = [{
    kind: "intent" as const,
    reference: "conversation:assembly-review",
  }];
  return [{
    id: "objective",
    kind: "objective" as const,
    statement: objective,
    sourceRefs: source,
  }, {
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Observe factual numerical assembly integrity only.",
    sourceRefs: source,
  }, {
    id: "success",
    kind: "success-criterion" as const,
    statement: "Keep a reviewable factual assembly observation path.",
    sourceRefs: source,
    dependsOnItemIds: [],
  }, {
    id: "verify-assembly",
    kind: "verification-activity" as const,
    statement: "Observe one exact current assembly module without deriving a verdict.",
    sourceRefs: source,
    dependsOnItemIds: ["success"],
    verificationAuthority: { id: "assembly-integrity", version: "1.0" },
  }, {
    id: "verify-assembly-alt",
    kind: "verification-activity" as const,
    statement: "Observe the same bounded digital assembly method.",
    sourceRefs: source,
    dependsOnItemIds: ["success"],
    verificationAuthority: { id: "assembly-integrity", version: "1.0" },
  }, {
    id: "verify-other",
    kind: "verification-activity" as const,
    statement: "Observe a different, deliberately incompatible method.",
    sourceRefs: source,
    dependsOnItemIds: ["success"],
    verificationAuthority: { id: "other-method", version: "1.0" },
  }, {
    id: "verify-unqualified",
    kind: "verification-activity" as const,
    statement: "Observe an activity without a declared method authority.",
    sourceRefs: source,
    dependsOnItemIds: ["success"],
  }];
}

function assemblyObservationOperation() {
  const input = request();
  return {
    id: "verify.observe-assembly-integrity",
    version: "1",
    bindings: [{
      name: "geometryModule",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: input.basis.snapshotId,
          snapshotRevision: input.basis.revision,
          kind: "artifact" as const,
          id: input.geometryModule.artifactId,
        },
      },
    }],
  };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((candidate) => candidate.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(
      current === undefined ? undefined : structuredClone(current),
    );
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = this.#revisions.get(revision);
    return Promise.resolve(
      project?.project.id === projectId ? structuredClone(project) : undefined,
    );
  }

  createInitial(
    project: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size !== 0) throw new Error("Project already exists.");
    this.#revisions.set(project.revision, structuredClone(project));
    return Promise.resolve(structuredClone(project));
  }

  async commit(
    project: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(project.project.id);
    if (current?.revision !== expectedRevision) throw new Error("Stale project.");
    this.#revisions.set(project.revision, structuredClone(project));
    return structuredClone(project);
  }
}

function projectSnapshot(snapshot: ThreadSnapshot): EngineeringProjectSnapshot {
  const objective = "Resolve an exact factual assembly observation review.";
  return {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Assembly review fixture",
      subjectId: SUBJECT_ID,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:assembly-review" },
        capturedAt: AT,
        capturedBy: { id: "agent:review-fixture", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:review-fixture", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: fingerprint("1"),
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }, {
      commandId: "project-question-propose",
      type: "project.question-propose",
      actor: { id: "agent:review-fixture", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: fingerprint("2"),
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r2`, revision: 2 },
    }],
  };
}

function threadSnapshot(): ThreadSnapshot {
  const artifactId = request().geometryModule.artifactId;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: SNAPSHOT_ID,
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Assembly review fixture",
      kind: "assembly",
      version: "r1",
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "changes.assembly-review",
      name: "Assembly review fixture",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [{
      id: artifactId,
      name: artifactId,
      kind: "other",
      version: "1",
      fingerprint: fingerprint("a"),
      producer: {
        serverId: "fixture",
        tool: "fixture",
        runId: "fixture-run",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: AT,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });
}
