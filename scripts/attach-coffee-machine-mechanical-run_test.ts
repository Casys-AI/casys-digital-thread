import { assertEquals, assertRejects } from "@std/assert";
import type {
  AppendLiveThreadUpdate,
  LiveThreadUpdate,
  LiveThreadUpdateJournal,
} from "../src/adapters/stores/live-thread-update-store.ts";
import {
  EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../src/domain/engineering-project-command-service.ts";
import { sha256Fingerprint } from "../src/domain/kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
} from "../src/domain/engineering-project.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import {
  applyThreadSnapshotExtension,
  type ThreadSnapshotExtension,
} from "../src/domain/thread-snapshot-extension.ts";
import {
  attachCoffeeMachineMechanicalRun,
  type MechanicalPublicationSnapshotStore,
} from "./attach-coffee-machine-mechanical-run.ts";

const BASELINE = new URL(
  "../config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
  import.meta.url,
);
const PROJECT = new URL(
  "../config/projects/coffee-machine-cm01.project.json",
  import.meta.url,
);
const RUN_ID = "run:mechanical-attach-test";
const CAPTURED_AT = "2026-08-02T06:30:00.000Z";
const HUMAN = { kind: "human" as const, actorId: "erwan" };
const AGENT = {
  kind: "agent" as const,
  actorId: "mcp:casys-digital-thread-orchestrator@0.1.0",
};

Deno.test("mechanical attachment saves exact canonical evidence before reconciling and is idempotent", async () => {
  const base = await baseline();
  const authority = await authorizedProject();
  const events: string[] = [];
  const store = new MemorySnapshotStore([base], events);
  const journal = new RecordingJournal(events);
  const extension = evidenceExtension();
  const options = {
    runId: RUN_ID,
    snapshotStore: store,
    projectStore: authority.store,
    liveUpdates: journal,
    readCapture: () =>
      Promise.resolve(JSON.stringify(captureFor(base, authority.project))),
    materialize: () => Promise.resolve(structuredClone(extension)),
    now: () => new Date("2026-08-02T06:31:00.000Z"),
  };

  const first = await attachCoffeeMachineMechanicalRun(options);
  assertEquals(first.applied, true);
  assertEquals(first.snapshot.revision, 6);
  assertEquals(first.resultSnapshot, {
    snapshotId: first.snapshot.id,
    revision: 6,
    subjectId: "coffee-machine-cm01",
  });
  assertEquals(first.evidenceRefs, [{
    snapshotId: first.snapshot.id,
    snapshotRevision: 6,
    kind: "artifact",
    id: extension.artifacts[0].id,
  }]);
  assertEquals(events, [
    `save:${first.snapshot.id}`,
    `reconcile:coffee-machine-cm01:${RUN_ID}`,
  ]);
  assertEquals(authority.store.reads, [{
    projectId: authority.project.project.id,
    revision: authority.project.revision,
  }]);

  const laterExtension = evidenceExtension({
    extensionId: "later-unrelated-extension",
    artifactId: "later-unrelated-artifact",
    capturedAt: "2026-08-02T06:32:00.000Z",
  });
  const laterHead = applyThreadSnapshotExtension(first.snapshot, laterExtension);
  const repeatedStore = new MemorySnapshotStore(
    [base, first.snapshot, laterHead],
    events,
  );
  events.length = 0;
  const repeated = await attachCoffeeMachineMechanicalRun({
    ...options,
    snapshotStore: repeatedStore,
  });
  assertEquals(repeated.applied, false);
  assertEquals(repeated.snapshot.id, laterHead.id);
  assertEquals(events, [`reconcile:coffee-machine-cm01:${RUN_ID}`]);
});

Deno.test("mechanical attachment never reconciles when canonical save fails", async () => {
  const base = await baseline();
  const authority = await authorizedProject();
  const events: string[] = [];
  const store = new MemorySnapshotStore([base], events);
  store.saveError = new Error("disk write failed");
  const journal = new RecordingJournal(events);

  await assertRejects(
    () =>
      attachCoffeeMachineMechanicalRun({
        runId: RUN_ID,
        snapshotStore: store,
        projectStore: authority.store,
        liveUpdates: journal,
        readCapture: () =>
          Promise.resolve(JSON.stringify(captureFor(base, authority.project))),
        materialize: () => Promise.resolve(evidenceExtension()),
      }),
    Error,
    "disk write failed",
  );
  assertEquals(events, [`save:${base.subject.id}:failed`]);
  assertEquals(journal.reconciliations, 0);
});

Deno.test("mechanical attachment rejects a canonical head outside the authorized lineage", async () => {
  const base = await baseline();
  const authority = await authorizedProject();
  const foreignHead: ThreadSnapshot = {
    ...structuredClone(base),
    id: "coffee-machine-cm01:r6:foreign-branch",
    revision: 6,
    previous: { snapshotId: "missing-parent", revision: 5 },
  };
  const events: string[] = [];
  const store = new MemorySnapshotStore([base, foreignHead], events);

  await assertRejects(
    () =>
      attachCoffeeMachineMechanicalRun({
        runId: RUN_ID,
        snapshotStore: store,
        projectStore: authority.store,
        liveUpdates: new RecordingJournal(events),
        readCapture: () =>
          Promise.resolve(JSON.stringify(captureFor(base, authority.project))),
        materialize: () => Promise.resolve(evidenceExtension()),
      }),
    Error,
    "does not descend from authorized run base",
  );
  assertEquals(events, []);
});

Deno.test("mechanical attachment refuses an idempotent no-op with partial provenance", async () => {
  const base = await baseline();
  const authority = await authorizedProject();
  const extension = evidenceExtension();
  extension.provenance.push({
    id: `${extension.id}:supersedes-baseline-model`,
    relation: "supersedes",
    from: { kind: "artifact", id: extension.artifacts[0].id },
    to: { kind: "artifact", id: base.subject.modelArtifactId },
    rationale: "Regression fixture proving extension provenance is canonical evidence.",
  });
  const firstEvents: string[] = [];
  const first = await attachCoffeeMachineMechanicalRun({
    runId: RUN_ID,
    snapshotStore: new MemorySnapshotStore([base], firstEvents),
    projectStore: authority.store,
    liveUpdates: new RecordingJournal(firstEvents),
    readCapture: () =>
      Promise.resolve(JSON.stringify(captureFor(base, authority.project))),
    materialize: () => Promise.resolve(structuredClone(extension)),
  });
  const partial = structuredClone(first.snapshot);
  partial.provenance = partial.provenance.filter((link) =>
    link.id !== extension.provenance[0].id
  );
  const events: string[] = [];

  await assertRejects(
    () =>
      attachCoffeeMachineMechanicalRun({
        runId: RUN_ID,
        snapshotStore: new MemorySnapshotStore([base, partial], events),
        projectStore: authority.store,
        liveUpdates: new RecordingJournal(events),
        readCapture: () =>
          Promise.resolve(JSON.stringify(captureFor(base, authority.project))),
        materialize: () => Promise.resolve(structuredClone(extension)),
      }),
    Error,
    `missing or different provenance:${extension.provenance[0].id}`,
  );
  assertEquals(events, []);
});

Deno.test("mechanical attachment refuses a newly delayed extension without saving or reconciling", async () => {
  const base = await baseline();
  const authority = await authorizedProject();
  const events: string[] = [];
  const delayed = evidenceExtension({
    capturedAt: "2026-08-01T10:00:00.000Z",
  });

  await assertRejects(
    () =>
      attachCoffeeMachineMechanicalRun({
        runId: RUN_ID,
        snapshotStore: new MemorySnapshotStore([base], events),
        projectStore: authority.store,
        liveUpdates: new RecordingJournal(events),
        readCapture: () =>
          Promise.resolve(JSON.stringify(captureFor(base, authority.project))),
        materialize: () => Promise.resolve(delayed),
      }),
    Error,
    "predates current canonical head",
  );
  assertEquals(events, []);
});

Deno.test("mechanical attachment rejects a self-consistent forged capture against the immutable project", async () => {
  const base = await baseline();
  const authority = await authorizedProject();
  const forged = captureFor(base, authority.project);
  forged.authorization.approvedProposal.summary =
    "Forged but internally fingerprinted proposal.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: captureBase(forged),
    inputEvidenceRefs: forged.authorization.inputEvidenceRefs,
    proposal: forged.authorization.approvedProposal,
  });
  forged.authorization.decisionInputFingerprint = decisionFingerprint.digest;
  forged.authorization.runInputFingerprint = (await sha256Fingerprint({
    workItemId: "verify-current-mechanical-design",
    baseSnapshot: captureBase(forged),
    decisionBindings: [{
      id: "review-mechanical-proof-case",
      inputFingerprint: decisionFingerprint,
    }],
  })).digest;
  const events: string[] = [];

  await assertRejects(
    () =>
      attachCoffeeMachineMechanicalRun({
        runId: RUN_ID,
        snapshotStore: new MemorySnapshotStore([base], events),
        projectStore: authority.store,
        liveUpdates: new RecordingJournal(events),
        readCapture: () => Promise.resolve(JSON.stringify(forged)),
        materialize: () => Promise.resolve(evidenceExtension()),
      }),
    Error,
    "approved proposal does not match the immutable project decision",
  );
  assertEquals(events, []);
});

Deno.test("mechanical attachment binds exact project and human/agent authority identities", async () => {
  const base = await baseline();
  const cases = [
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.project.snapshotId = `${capture.project.snapshotId}:forged`;
      },
      message: "is not readable exactly",
    },
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.approvedBy = "someone-else";
      },
      message: "no unique exact human approval receipt",
    },
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.queuedBy = "someone-else";
      },
      message: "no exact human queue receipt",
    },
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.claimedBy = "some-other-agent";
      },
      message: "no exact running agent claim",
    },
  ];

  for (const testCase of cases) {
    const authority = await authorizedProject();
    const capture = captureFor(base, authority.project);
    testCase.mutate(capture);
    const events: string[] = [];
    await assertRejects(
      () =>
        attachCoffeeMachineMechanicalRun({
          runId: RUN_ID,
          snapshotStore: new MemorySnapshotStore([base], events),
          projectStore: authority.store,
          liveUpdates: new RecordingJournal(events),
          readCapture: () => Promise.resolve(JSON.stringify(capture)),
          materialize: () => Promise.resolve(evidenceExtension()),
        }),
      Error,
      testCase.message,
    );
    assertEquals(events, []);
  }
});

Deno.test("mechanical attachment binds exact decision evidence, base and run fingerprints", async () => {
  const base = await baseline();
  const cases = [
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.decisionInputFingerprint = "f".repeat(64);
      },
      message: "decision fingerprint does not match",
    },
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.inputEvidenceRefs = [
          ...capture.authorization.inputEvidenceRefs,
          {
            snapshotId: base.id,
            snapshotRevision: base.revision,
            kind: "artifact",
            id: "forged-extra-evidence",
          },
        ];
      },
      message: "input evidence does not match",
    },
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.baseSnapshotRevision += 1;
      },
      message: "base snapshot does not match",
    },
    {
      mutate: (capture: MechanicalPublisherCapture) => {
        capture.authorization.runInputFingerprint = "e".repeat(64);
      },
      message: "run fingerprint does not match",
    },
  ];

  for (const testCase of cases) {
    const authority = await authorizedProject();
    const capture = captureFor(base, authority.project);
    testCase.mutate(capture);
    await assertRejects(
      () =>
        attachCoffeeMachineMechanicalRun({
          runId: RUN_ID,
          snapshotStore: new MemorySnapshotStore([base], []),
          projectStore: authority.store,
          liveUpdates: new RecordingJournal([]),
          readCapture: () => Promise.resolve(JSON.stringify(capture)),
          materialize: () => Promise.resolve(evidenceExtension()),
        }),
      Error,
      testCase.message,
    );
  }
});

class MemorySnapshotStore implements MechanicalPublicationSnapshotStore {
  readonly #snapshots = new Map<string, ThreadSnapshot>();
  saveError?: Error;

  constructor(
    snapshots: readonly ThreadSnapshot[],
    private readonly events: string[],
  ) {
    for (const snapshot of snapshots) {
      this.#snapshots.set(snapshot.id, structuredClone(snapshot));
    }
  }

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    const snapshot = this.#snapshots.get(snapshotId);
    return Promise.resolve(snapshot ? structuredClone(snapshot) : undefined);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const snapshot = [...this.#snapshots.values()]
      .filter((item) => item.subject.id === subjectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(snapshot ? structuredClone(snapshot) : undefined);
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    if (this.saveError) {
      this.events.push(`save:${snapshot.subject.id}:failed`);
      return Promise.reject(this.saveError);
    }
    this.events.push(`save:${snapshot.id}`);
    this.#snapshots.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }

  pathFor(snapshotId: string): string {
    return `memory/${encodeURIComponent(snapshotId)}.json`;
  }
}

class RecordingJournal implements LiveThreadUpdateJournal {
  reconciliations = 0;

  constructor(private readonly events: string[]) {}

  append(_input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    return Promise.reject(new Error("append is not used by the publisher"));
  }

  reconcileRun(
    subjectId: string,
    runId: string,
    recordedAt = CAPTURED_AT,
  ): Promise<LiveThreadUpdate> {
    this.reconciliations += 1;
    this.events.push(`reconcile:${subjectId}:${runId}`);
    return Promise.resolve({
      schemaVersion: "live-thread-update/1.0",
      sequence: this.reconciliations,
      subjectId,
      runId,
      operationId: "$reconcile",
      baseRevision: 0,
      state: "reconciled",
      recordedAt,
      graph: { nodes: [], edges: [] },
    });
  }

  list(_subjectId: string): Promise<LiveThreadUpdate[]> {
    return Promise.resolve([]);
  }

  version(_subjectId: string): Promise<number> {
    return Promise.resolve(this.reconciliations);
  }
}

async function baseline(): Promise<ThreadSnapshot> {
  return JSON.parse(await Deno.readTextFile(BASELINE)) as ThreadSnapshot;
}

interface MechanicalPublisherCapture {
  project: {
    id: string;
    snapshotId: string;
    revision: number;
  };
  authorization: {
    decisionId: string;
    decisionInputFingerprint: string;
    approvedBy: string;
    approvedProposal: {
      summary: string;
      parameters: EngineeringDecisionProposalParameter[];
    };
    inputEvidenceRefs:
      EngineeringProjectSnapshot["decisions"][number]["inputEvidenceRefs"];
    runInputFingerprint: string;
    queuedBy: string;
    claimedBy: string;
    baseSnapshotId: string;
    baseSnapshotRevision: number;
    baseSnapshotSubjectId: string;
  };
}

function captureFor(
  base: ThreadSnapshot,
  project: EngineeringProjectSnapshot,
): MechanicalPublisherCapture {
  const decision = project.decisions.find((item) =>
    item.id === "review-mechanical-proof-case"
  );
  const run = project.agentRuns.find((item) => item.id === RUN_ID);
  const approval = project.approvals.find((item) =>
    decision?.approvalIds.includes(item.id) && item.status === "approved"
  );
  const queued = run?.statusHistory?.find((item) => item.status === "queued");
  if (
    !decision?.proposal || !decision.inputFingerprint || !run?.inputFingerprint ||
    !run.baseSnapshot || !run.claimedBy || !approval?.decidedBy || !queued ||
    run.baseSnapshot.snapshotId !== base.id ||
    run.baseSnapshot.revision !== base.revision ||
    run.baseSnapshot.subjectId !== base.subject.id
  ) {
    throw new Error("Authorized project fixture is incomplete.");
  }
  return {
    project: {
      id: project.project.id,
      snapshotId: project.id,
      revision: project.revision,
    },
    authorization: {
      decisionId: decision.id,
      decisionInputFingerprint: decision.inputFingerprint.digest,
      approvedBy: approval.decidedBy,
      approvedProposal: {
        summary: decision.proposal.summary,
        parameters: [...structuredClone(decision.proposal.parameters)],
      },
      inputEvidenceRefs: structuredClone(decision.inputEvidenceRefs),
      runInputFingerprint: run.inputFingerprint.digest,
      queuedBy: queued.actor.id,
      claimedBy: run.claimedBy.id,
      baseSnapshotId: run.baseSnapshot.snapshotId,
      baseSnapshotRevision: run.baseSnapshot.revision,
      baseSnapshotSubjectId: run.baseSnapshot.subjectId,
    },
  };
}

function captureBase(capture: MechanicalPublisherCapture) {
  return {
    snapshotId: capture.authorization.baseSnapshotId,
    revision: capture.authorization.baseSnapshotRevision,
    subjectId: capture.authorization.baseSnapshotSubjectId,
  };
}

function evidenceExtension(options: {
  extensionId?: string;
  artifactId?: string;
  capturedAt?: string;
} = {}): ThreadSnapshotExtension {
  const capturedAt = options.capturedAt ?? CAPTURED_AT;
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  return {
    id: options.extensionId ??
      "coffee-machine-mechanical-run-mechanical-attach-test-extension",
    name: "Publish deterministic mechanical evidence",
    subjectId: "coffee-machine-cm01",
    capturedAt,
    artifacts: [{
      id: options.artifactId ??
        "coffee-machine-mechanical-run-mechanical-attach-test-analysis-case",
      name: "Approved mechanical analysis case",
      kind: "document",
      version: "cccccccccccc",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "run_coffee_machine_mechanical",
        runId: RUN_ID,
      },
      inputArtifactIds: [],
      freshness,
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

async function authorizedProject(): Promise<{
  project: EngineeringProjectSnapshot;
  store: MemoryProjectRevisionStore;
}> {
  const initial = JSON.parse(await Deno.readTextFile(PROJECT));
  const store = new MemoryProjectRevisionStore(initial);
  let tick = 0;
  const service = new EngineeringProjectCommandService(
    store,
    undefined,
    () => new Date(Date.UTC(2026, 7, 2, 5, 0, ++tick)).toISOString(),
  );
  let project = await service.proposeDecision(AGENT, {
    commandId: "agent-propose-mechanical-attach-test",
    projectId: "coffee-machine-cm01",
    expectedRevision: 1,
    issuedAt: "2026-08-02T05:00:01.000Z",
    decisionId: "review-mechanical-proof-case",
    proposal: {
      summary: "One bounded component proof for publisher tests.",
      parameters: proposalParameters(),
    },
    baseSnapshot: initial.threadSnapshots[0],
  });
  const decision = project.decisions.find((item) =>
    item.id === "review-mechanical-proof-case"
  );
  if (!decision?.inputFingerprint) throw new Error("Decision proposal failed.");
  project = await service.approveDecision(HUMAN, {
    commandId: "human-approve-mechanical-attach-test",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-02T05:00:02.000Z",
    decisionId: decision.id,
    rationale: "Exact publisher test approval.",
    inputFingerprint: decision.inputFingerprint,
  });
  project = await service.queueRun(HUMAN, {
    commandId: "human-queue-mechanical-attach-test",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-02T05:00:03.000Z",
    runId: RUN_ID,
    workItemId: "verify-current-mechanical-design",
    summary: "Queue the exact publisher test run.",
    baseSnapshot: initial.threadSnapshots[0],
  });
  project = await service.claimRun(AGENT, {
    commandId: "agent-claim-mechanical-attach-test",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-02T05:00:04.000Z",
    runId: RUN_ID,
    summary: "Claim the exact publisher test run.",
  });
  return { project, store };
}

function proposalParameters(): EngineeringDecisionProposalParameter[] {
  return [
    {
      key: "analysis_scope",
      label: "Part and scope",
      value: "CM-01 drip tray; isolated current CAD component, 190 x 135 x 28 mm",
    },
    {
      key: "material_basis",
      label: "Material basis",
      value: "ABS-like concept model",
    },
    {
      key: "young_modulus_mpa",
      label: "Young modulus",
      value: 2200,
      unit: "MPa",
    },
    {
      key: "poisson_ratio",
      label: "Poisson ratio",
      value: 0.35,
      unit: "1",
    },
    {
      key: "fixed_region",
      label: "Support",
      value: "Rear vertical face fully fixed",
    },
    {
      key: "load_case",
      label: "Reference load",
      value:
        "100 N total downward force on the front vertical face (about 10 kg static load)",
    },
    {
      key: "mesh_size_mm",
      label: "Target mesh size",
      value: 5,
      unit: "mm",
    },
    {
      key: "max_von_mises_mpa",
      label: "Preliminary stress limit",
      value: 20,
      unit: "MPa",
    },
    {
      key: "max_displacement_mm",
      label: "Preliminary displacement limit",
      value: 1,
      unit: "mm",
    },
    {
      key: "evidence_boundary",
      label: "Evidence boundary",
      value: "Concept verification only",
    },
  ];
}

class MemoryProjectRevisionStore implements EngineeringProjectRevisionStore {
  readonly revisions = new Map<number, EngineeringProjectSnapshot>();
  readonly reads: Array<{ projectId: string; revision: number }> = [];

  constructor(initial: EngineeringProjectSnapshot) {
    this.revisions.set(initial.revision, structuredClone(initial));
  }

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const latest = Math.max(...this.revisions.keys());
    const project = this.revisions.get(latest);
    return Promise.resolve(
      project?.project.id === projectId ? structuredClone(project) : undefined,
    );
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    this.reads.push({ projectId, revision });
    const project = this.revisions.get(revision);
    return Promise.resolve(
      project?.project.id === projectId ? structuredClone(project) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.revisions.size > 0) {
      return Promise.reject(new EngineeringProjectStoreConflictError("exists"));
    }
    this.revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = Math.max(...this.revisions.keys());
    if (current !== expectedRevision) {
      return Promise.reject(new EngineeringProjectStoreConflictError("stale"));
    }
    this.revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}
