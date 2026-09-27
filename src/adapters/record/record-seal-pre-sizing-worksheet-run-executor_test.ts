import { assertEquals, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import {
  parsePreSizingWorksheetCapture,
  preSizingWorksheetArtifactId,
  preSizingWorksheetParameters,
  type PreSizingWorksheetProposal,
  type PreSizingWorksheetRecordReference,
  RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
} from "../../domain/record/pre-sizing-worksheet.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  startSyntheticApprovedBriefBaseline,
  SYNTHETIC_BASELINE_AGENT,
  SYNTHETIC_BASELINE_HUMAN,
} from "../../testing/synthetic-approved-brief-baseline.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { projectThreadWorkbenchSnapshot } from "../thread/thread-workbench-projector.ts";
import { enrichThreadWorkbenchWithEngineeringCases } from "../thread/verification-case-workbench-enricher.ts";
import {
  applyPreSizingWorksheetDocumentExtension,
  RecordSealPreSizingWorksheetRunExecutor,
} from "./record-seal-pre-sizing-worksheet-run-executor.ts";

const COMMAND = {
  commandId: "worksheet-command",
  projectId: "project:worksheet",
  expectedRevision: 1,
  issuedAt: "2026-09-13T10:00:00.000Z",
  runId: "run:worksheet",
};

Deno.test("worksheet executor refuses a human before reading project state", async () => {
  const executor = new RecordSealPreSizingWorksheetRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read project")) },
    commands: {} as never,
    snapshots: {} as never,
    lease: {} as never,
    captures: {} as never,
    resources: {} as never,
  } as never);
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, COMMAND),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
});

Deno.test("worksheet executor refuses a lookalike operation before snapshot access", async () => {
  let snapshotRead = false;
  const executor = new RecordSealPreSizingWorksheetRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "4.0",
          project: { id: COMMAND.projectId, subjectId: COMMAND.projectId },
          agentRuns: [{
            id: COMMAND.runId,
            workItemId: "work:worksheet",
            status: "queued",
            summary: "worksheet",
            queuedAt: COMMAND.issuedAt,
            basis: {
              kind: "thread-snapshot",
              snapshotId: "thread:r1",
              revision: 1,
              subjectId: COMMAND.projectId,
            },
            evidenceRefs: [],
          }],
          workItems: [{
            id: "work:worksheet",
            operation: { id: "record.lookalike", version: "1", bindings: [] },
            decisionIds: [],
          }],
        } as never),
    },
    commands: {} as never,
    snapshots: {
      get: () => {
        snapshotRead = true;
        return Promise.reject(new Error("must not read snapshots"));
      },
    } as never,
    lease: {} as never,
    captures: {} as never,
    resources: {} as never,
  } as never);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:worksheet" }, COMMAND),
    EngineeringProjectCommandError,
    "exact @1 operation",
  );
  if (snapshotRead) throw new Error("lookalike operation reached snapshot access");
});

Deno.test("worksheet extension consumes Thread sources and preserves prior documents", () => {
  const source = artifact("source-doc", "a", []);
  const base = snapshot([artifact("model", "0", []), source]);
  const baseBefore = structuredClone(base);
  const first = applyPreSizingWorksheetDocumentExtension({
    base,
    artifact: artifact("worksheet:first", "b", [source.id]),
    capturedAt: COMMAND.issuedAt,
  });
  assertEquals(base, baseBefore);
  assertEquals(first.consumptions, [{
    id: "consume-source-doc-by-worksheet:first",
    artifactId: "source-doc",
    consumer: first.artifacts.at(-1)!.producer,
    observedFingerprint: source.fingerprint,
    verifiedAt: COMMAND.issuedAt,
    status: "verified",
  }]);
  const successor = applyPreSizingWorksheetDocumentExtension({
    base: first,
    artifact: artifact("worksheet:successor", "c", [source.id, "worksheet:first"]),
    capturedAt: "2026-09-13T10:01:00.000Z",
  });
  assertEquals(successor.artifacts.some((item) => item.id === "worksheet:first"), true);
  assertEquals(
    successor.artifacts.some((item) => item.id === "worksheet:successor"),
    true,
  );
});

function artifact(
  id: string,
  digit: string,
  inputArtifactIds: readonly string[],
): ThreadArtifact {
  return {
    id,
    name: id,
    kind: id === "model" ? "sysml-model" : "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: digit.repeat(64) },
    producer: { serverId: "digital-thread", tool: "test", runId: "run:test" },
    inputArtifactIds,
    freshness: {
      status: "fresh",
      changedAt: COMMAND.issuedAt,
      invalidatedByChangeIds: [],
    },
  };
}

function snapshot(artifacts: readonly ThreadArtifact[]): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "thread:r1",
    revision: 1,
    generatedAt: COMMAND.issuedAt,
    subject: {
      id: COMMAND.projectId,
      name: "Test",
      kind: "system",
      version: "1",
      modelArtifactId: "model",
    },
    freshness: {
      status: "fresh",
      changedAt: COMMAND.issuedAt,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change:r1",
      name: "base",
      status: "applied",
      createdAt: COMMAND.issuedAt,
      appliedAt: COMMAND.issuedAt,
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
  };
}

const E2E_PROJECT_ID = "project:worksheet-e2e";
const E2E_ISSUED_AT = "2026-09-13T10:00:00.000Z";

function e2eBriefItems() {
  return [{
    id: "objective",
    kind: "objective" as const,
    statement: "Record a sourced pre-sizing worksheet.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:synthetic" }],
  }, {
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Keep documentary records distinct from proofs.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:synthetic" }],
  }, {
    id: "success",
    kind: "success-criterion" as const,
    statement: "Every quantity cites its exact source.",
    sourceRefs: [{ kind: "document" as const, reference: "brief:source" }],
    dependsOnItemIds: [],
  }];
}

interface WorksheetE2E {
  readonly baseline: Awaited<
    ReturnType<typeof startSyntheticApprovedBriefBaseline>
  >;
  readonly executor: RecordSealPreSizingWorksheetRunExecutor;
  readonly captures: Map<string, string>;
  readonly captureSaves: () => number;
  readonly resource: AgentResourceReference;
  readonly resourceBytes: Uint8Array;
}

async function startWorksheetE2E(
  directory: string,
  commands?: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >,
): Promise<WorksheetE2E> {
  const baseline = await startSyntheticApprovedBriefBaseline({
    directory,
    projectId: E2E_PROJECT_ID,
    projectName: "Worksheet E2E",
    intent: "Record pre-sizing evidence.",
    items: e2eBriefItems(),
  });
  const resourceBytes = new TextEncoder().encode("supplier load table v1");
  const resourceDigest = await sha256Hex(resourceBytes);
  const resource: AgentResourceReference = {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${resourceDigest}`,
    name: "load-table.txt",
    mimeType: "text/plain",
    representation: "text",
    byteCount: resourceBytes.byteLength,
    fingerprint: { algorithm: "sha256", digest: resourceDigest },
  };
  const captures = new Map<string, string>();
  let saves = 0;
  const executor = new RecordSealPreSizingWorksheetRunExecutor({
    projects: baseline.projects,
    commands: commands ?? baseline.commands,
    snapshots: baseline.snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/worksheet-leases`),
    captures: {
      save: (fingerprint, text) => {
        saves++;
        captures.set(fingerprint.digest, text);
        return Promise.resolve();
      },
      read: (fingerprint) => Promise.resolve(captures.get(fingerprint.digest)),
    },
    resources: {
      reopenExact: (expected) =>
        expected.uri === resource.uri
          ? Promise.resolve({ bytes: resourceBytes })
          : Promise.reject(new Error(`unknown agent resource ${expected.uri}`)),
    },
  });
  return {
    baseline,
    executor,
    captures,
    captureSaves: () => saves,
    resource,
    resourceBytes,
  };
}

function worksheetProposal(
  resource: AgentResourceReference,
  revision: number,
  input?: {
    readonly predecessor?: PreSizingWorksheetRecordReference;
    readonly quantities?: PreSizingWorksheetProposal["quantities"];
  },
): PreSizingWorksheetProposal {
  return {
    worksheetId: "ws-bracket",
    revision,
    title: "Bracket pre-sizing",
    quantities: input?.quantities ?? [{
      id: "mass",
      label: "Estimated mass",
      value: "1.25",
      unit: "kg",
      sourceIndex: 0,
    }],
    sources: [{ kind: "agent-resource", resourceRef: resource }],
    ...(input?.predecessor ? { predecessor: input.predecessor } : {}),
  };
}

async function currentTip(
  e2e: WorksheetE2E,
): Promise<{ snapshotId: string; revision: number; subjectId: string }> {
  const project = (await e2e.baseline.projects.get(E2E_PROJECT_ID))!;
  const tip = project.threadSnapshots.reduce((latest, candidate) =>
    candidate.revision > latest.revision ? candidate : latest
  );
  return {
    snapshotId: tip.snapshotId,
    revision: tip.revision,
    subjectId: tip.subjectId,
  };
}

async function queueWorksheetRun(
  e2e: WorksheetE2E,
  input: {
    readonly proposal: PreSizingWorksheetProposal;
    readonly prefix: string;
    readonly workItemId: string;
    readonly decisionId: string;
    readonly runId: string;
  },
): Promise<EngineeringProjectSnapshot> {
  const { baseline } = e2e;
  const threadRef = await currentTip(e2e);
  const baseRevision = (await baseline.projects.get(E2E_PROJECT_ID))!.revision;
  let project = await baseline.commands.appendChange(SYNTHETIC_BASELINE_AGENT, {
    ...baseline.commandContext(`append-${input.prefix}`, baseRevision),
    baseSnapshot: threadRef,
    phases: [{
      id: `${input.prefix}-phase`,
      name: "Pre-sizing worksheet",
      description: "Record one documentary worksheet.",
    }],
    workItems: [{
      id: input.workItemId,
      phaseId: `${input.prefix}-phase`,
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [input.decisionId],
      operation: {
        id: RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.id,
        version: RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.version,
        bindings: [],
      },
    }],
    requiredDecisions: [{
      id: input.decisionId,
      phaseId: `${input.prefix}-phase`,
      title: "Record the pre-sizing worksheet",
      question: "Authorize recording this agent proposal?",
    }],
  });
  project = await baseline.commands.proposeDecision(SYNTHETIC_BASELINE_AGENT, {
    ...baseline.commandContext(`propose-${input.prefix}`, project.revision),
    decisionId: input.decisionId,
    baseSnapshot: threadRef,
    proposal: {
      summary: "Record one pre-sizing worksheet proposal.",
      parameters: [...preSizingWorksheetParameters(input.proposal)],
    },
  });
  const decision = project.decisions.find((item) => item.id === input.decisionId)!;
  project = await baseline.commands.approveDecision(SYNTHETIC_BASELINE_HUMAN, {
    ...baseline.commandContext(`approve-${input.prefix}`, project.revision),
    decisionId: input.decisionId,
    rationale: "Human authorizes the act of recording, not the content.",
    inputFingerprint: decision.inputFingerprint!,
  });
  return await baseline.commands.queueRun(SYNTHETIC_BASELINE_AGENT, {
    ...baseline.commandContext(`queue-${input.prefix}`, project.revision),
    runId: input.runId,
    workItemId: input.workItemId,
    summary: "Seal the pre-sizing worksheet.",
    basis: { kind: "thread-snapshot", ...threadRef },
  });
}

async function executeWorksheetRun(
  e2e: WorksheetE2E,
  runId: string,
  commandId: string,
): Promise<EngineeringProjectSnapshot> {
  const revision = (await e2e.baseline.projects.get(E2E_PROJECT_ID))!.revision;
  return await e2e.executor.execute(SYNTHETIC_BASELINE_AGENT, {
    commandId,
    projectId: E2E_PROJECT_ID,
    expectedRevision: revision,
    issuedAt: E2E_ISSUED_AT,
    runId,
  });
}

function worksheetReaders(captures: Map<string, string>) {
  const absent = { read: () => Promise.resolve(undefined) };
  return {
    mechanicalProof: absent,
    sensitivityStudy: absent,
    printabilityCheck: absent,
    printEstimate: absent,
    dfmCheck: absent,
    preSizingWorksheet: {
      read: (fingerprint: { digest: string }) =>
        Promise.resolve(captures.get(fingerprint.digest)),
    },
  };
}

Deno.test("worksheet executor seals r1 and projects an inspectable worksheet case", async () => {
  const directory = await Deno.makeTempDir({ prefix: "worksheet-e2e-r1-" });
  try {
    const e2e = await startWorksheetE2E(directory);
    await queueWorksheetRun(e2e, {
      proposal: worksheetProposal(e2e.resource, 1),
      prefix: "r1",
      workItemId: "work:worksheet-r1",
      decisionId: "decision:worksheet-r1",
      runId: "run:worksheet-r1",
    });
    const executed = await executeWorksheetRun(
      e2e,
      "run:worksheet-r1",
      "execute-r1",
    );
    const run = executed.agentRuns.find((item) => item.id === "run:worksheet-r1")!;
    assertEquals(run.status, "completed");
    assertEquals(e2e.captures.size, 1);
    const [digest, text] = [...e2e.captures.entries()][0]!;
    const capture = parsePreSizingWorksheetCapture(JSON.parse(text));
    assertEquals(capture.claim.revision, 1);
    assertEquals(capture.claim.predecessor, undefined);
    assertEquals(capture.quantities.length, 1);

    const successor = (await e2e.baseline.snapshots.get(
      run.resultSnapshot!.snapshotId,
    ))!;
    const sealed = successor.artifacts.filter((artifact) =>
      artifact.id === preSizingWorksheetArtifactId(digest)
    );
    assertEquals(sealed.length, 1);
    assertEquals(sealed[0]!.version, digest);
    assertEquals(
      successor.provenance.some((link) => link.relation === "supersedes"),
      false,
    );

    const workbench = projectThreadWorkbenchSnapshot(successor);
    assertEquals(workbench.evidenceFamilyGraph.families, []);
    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      workbench,
      worksheetReaders(e2e.captures),
      { projectId: E2E_PROJECT_ID },
    );
    assertEquals(enriched.engineeringCases.status, "observed");
    assertEquals(enriched.engineeringCases.issues, []);
    assertEquals(enriched.engineeringCases.cases.length, 1);
    assertEquals(enriched.engineeringCases.current.length, 1);
    assertEquals(enriched.engineeringCases.current[0]?.revision, 1);
    const only = enriched.engineeringCases.cases[0]!;
    assertEquals(only.family, "pre-sizing-worksheet");
    if (only.family !== "pre-sizing-worksheet") {
      throw new Error("unreachable");
    }
    assertEquals(only.id, "ws-bracket");
    assertEquals(only.revision, 1);
    assertEquals(only.title, "Bracket pre-sizing");
    assertEquals(only.recording, { status: "recorded", authorKind: "agent" });
    assertEquals(only.quantities, [{
      id: "mass",
      label: "Estimated mass",
      value: "1.25",
      unit: "kg",
      sourceIndex: 0,
    }]);
    assertEquals(only.sources, [{
      kind: "agent-resource",
      uri: e2e.resource.uri,
      digest: e2e.resource.fingerprint.digest,
    }]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("worksheet r1 to r2 projects a superseding family with current r2", async () => {
  const directory = await Deno.makeTempDir({ prefix: "worksheet-e2e-r2-" });
  try {
    const e2e = await startWorksheetE2E(directory);
    await queueWorksheetRun(e2e, {
      proposal: worksheetProposal(e2e.resource, 1),
      prefix: "r1",
      workItemId: "work:worksheet-r1",
      decisionId: "decision:worksheet-r1",
      runId: "run:worksheet-r1",
    });
    const first = await executeWorksheetRun(e2e, "run:worksheet-r1", "execute-r1");
    const firstRun = first.agentRuns.find((item) => item.id === "run:worksheet-r1")!;
    const firstSuccessor = (await e2e.baseline.snapshots.get(
      firstRun.resultSnapshot!.snapshotId,
    ))!;
    const [firstDigest] = [...e2e.captures.keys()];
    const r1 = firstSuccessor.artifacts.find((artifact) =>
      artifact.id === preSizingWorksheetArtifactId(firstDigest!)
    )!;

    await queueWorksheetRun(e2e, {
      proposal: worksheetProposal(e2e.resource, 2, {
        predecessor: {
          artifactId: r1.id,
          fingerprint: r1.fingerprint,
          producerRunId: "run:worksheet-r1",
        },
        quantities: [{
          id: "mass",
          label: "Estimated mass",
          value: "1.30",
          unit: "kg",
          sourceIndex: 0,
        }],
      }),
      prefix: "r2",
      workItemId: "work:worksheet-r2",
      decisionId: "decision:worksheet-r2",
      runId: "run:worksheet-r2",
    });
    const second = await executeWorksheetRun(
      e2e,
      "run:worksheet-r2",
      "execute-r2",
    );
    const secondRun = second.agentRuns.find((item) => item.id === "run:worksheet-r2")!;
    assertEquals(secondRun.status, "completed");
    const successor = (await e2e.baseline.snapshots.get(
      secondRun.resultSnapshot!.snapshotId,
    ))!;
    const digests = [...e2e.captures.keys()];
    const r2id = preSizingWorksheetArtifactId(
      digests.find((item) => item !== firstDigest)!,
    );

    const supersessions = successor.provenance.filter((link) =>
      link.relation === "supersedes"
    );
    assertEquals(supersessions.length, 1);
    assertEquals(supersessions[0]?.from, { kind: "artifact", id: r2id });
    assertEquals(supersessions[0]?.to, { kind: "artifact", id: r1.id });

    const workbench = projectThreadWorkbenchSnapshot(successor);
    assertEquals(workbench.evidenceFamilyGraph.families.length, 1);
    const family = workbench.evidenceFamilyGraph.families[0]!;
    assertEquals(
      family.currentRefs.map((ref) => ref.id),
      [r2id],
    );
    assertEquals(
      family.historicalRefs.map((ref) => ref.id),
      [r1.id],
    );
    assertEquals(family.revisionCount, 1);
    assertEquals(family.status, "current");
    assertEquals(family.relationship.relation, "supersedes");
    assertEquals(workbench.evidenceFamilyGraph.edges, []);
    assertEquals(workbench.evidenceFamilyGraph.omittedSelfLoops, [{
      familyId: family.id,
      memberEdgeRefs: [
        {
          id: `derived-from-${r1.id}-by-${r2id}`,
          relation: "derived_from",
          origin: "provenance",
        },
        {
          id: `supersedes-${r1.id}-by-${r2id}`,
          relation: "supersedes",
          origin: "provenance",
        },
        {
          id: `structure:input:${r1.id}:${r2id}`,
          relation: "input_to",
          origin: "structure",
        },
      ],
    }]);

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      workbench,
      worksheetReaders(e2e.captures),
      { projectId: E2E_PROJECT_ID },
    );
    assertEquals(enriched.engineeringCases.status, "observed");
    assertEquals(enriched.engineeringCases.issues, []);
    assertEquals(enriched.engineeringCases.cases.length, 2);
    assertEquals(enriched.engineeringCases.current.length, 1);
    assertEquals(enriched.engineeringCases.current[0]?.revision, 2);
    const revised = enriched.engineeringCases.cases.find((item) =>
      item.revision === 2
    )!;
    assertEquals(revised.family, "pre-sizing-worksheet");
    if (revised.family !== "pre-sizing-worksheet") {
      throw new Error("unreachable");
    }
    assertEquals(revised.quantities, [{
      id: "mass",
      label: "Estimated mass",
      value: "1.30",
      unit: "kg",
      sourceIndex: 0,
    }]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("worksheet seal refuses a second r1 that does not extend the head", async () => {
  const directory = await Deno.makeTempDir({ prefix: "worksheet-e2e-divergent-" });
  try {
    const e2e = await startWorksheetE2E(directory);
    await queueWorksheetRun(e2e, {
      proposal: worksheetProposal(e2e.resource, 1),
      prefix: "r1a",
      workItemId: "work:worksheet-r1a",
      decisionId: "decision:worksheet-r1a",
      runId: "run:worksheet-r1a",
    });
    await executeWorksheetRun(e2e, "run:worksheet-r1a", "execute-r1a");
    await queueWorksheetRun(e2e, {
      proposal: worksheetProposal(e2e.resource, 1, {
        quantities: [{
          id: "mass",
          label: "Estimated mass",
          value: "1.30",
          unit: "kg",
          sourceIndex: 0,
        }],
      }),
      prefix: "r1b",
      workItemId: "work:worksheet-r1b",
      decisionId: "decision:worksheet-r1b",
      runId: "run:worksheet-r1b",
    });
    // The linear head is enforced at seal time, so no divergent r1 pair can
    // reach the projection; only a successor of the latest revision seals.
    await assertRejects(
      () => executeWorksheetRun(e2e, "run:worksheet-r1b", "execute-r1b"),
      EngineeringProjectCommandError,
      "exact current worksheet head",
    );
    const project = (await e2e.baseline.projects.get(E2E_PROJECT_ID))!;
    assertEquals(
      project.agentRuns.find((item) => item.id === "run:worksheet-r1b")?.status,
      "queued",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("worksheet seal replays a completed run without a second write", async () => {
  const directory = await Deno.makeTempDir({ prefix: "worksheet-e2e-replay-" });
  try {
    const e2e = await startWorksheetE2E(directory);
    await queueWorksheetRun(e2e, {
      proposal: worksheetProposal(e2e.resource, 1),
      prefix: "r1",
      workItemId: "work:worksheet-r1",
      decisionId: "decision:worksheet-r1",
      runId: "run:worksheet-r1",
    });
    const firstRevision = (await e2e.baseline.projects.get(E2E_PROJECT_ID))!.revision;
    const command = {
      commandId: "execute-r1",
      projectId: E2E_PROJECT_ID,
      expectedRevision: firstRevision,
      issuedAt: E2E_ISSUED_AT,
      runId: "run:worksheet-r1",
    };
    const executed = await e2e.executor.execute(
      SYNTHETIC_BASELINE_AGENT,
      command,
    );
    assertEquals(e2e.captureSaves(), 1);
    const replayed = await e2e.executor.execute(
      SYNTHETIC_BASELINE_AGENT,
      { ...command },
    );
    const run = replayed.agentRuns.find((item) => item.id === "run:worksheet-r1")!;
    assertEquals(run.status, "completed");
    assertEquals(e2e.captureSaves(), 1);
    assertEquals(e2e.captures.size, 1);
    const firstRun = executed.agentRuns.find((item) => item.id === "run:worksheet-r1")!;
    assertEquals(run.resultSnapshot, firstRun.resultSnapshot);
    const successor = (await e2e.baseline.snapshots.get(
      run.resultSnapshot!.snapshotId,
    ))!;
    assertEquals(
      successor.artifacts.filter((artifact) =>
        artifact.producer.tool ===
          `${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.id}@${RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION.version}`
      ).length,
      1,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("worksheet seal resumes after a crash between durable Thread write and run completion", async () => {
  const directory = await Deno.makeTempDir({ prefix: "worksheet-e2e-resume-" });
  try {
    const setup = await startWorksheetE2E(directory);
    await queueWorksheetRun(setup, {
      proposal: worksheetProposal(setup.resource, 1),
      prefix: "r1",
      workItemId: "work:worksheet-r1",
      decisionId: "decision:worksheet-r1",
      runId: "run:worksheet-r1",
    });
    let completeCalls = 0;
    const flaky = {
      claimRun: setup.baseline.commands.claimRun.bind(setup.baseline.commands),
      publishRun: setup.baseline.commands.publishRun.bind(
        setup.baseline.commands,
      ),
      completeRun: (
        ...args: Parameters<EngineeringProjectCommandService["completeRun"]>
      ) => {
        completeCalls++;
        if (completeCalls === 1) {
          return Promise.reject(
            new Error("simulated crash after durable write"),
          );
        }
        return setup.baseline.commands.completeRun(...args);
      },
      failRun: setup.baseline.commands.failRun.bind(setup.baseline.commands),
    };
    const crashingExecutor = new RecordSealPreSizingWorksheetRunExecutor({
      projects: setup.baseline.projects,
      commands: flaky,
      snapshots: setup.baseline.snapshots,
      lease: new FileEngineeringProjectRunLease(`${directory}/resume-leases`),
      captures: {
        save: (fingerprint, text) => {
          setup.captures.set(fingerprint.digest, text);
          return Promise.resolve();
        },
        read: (fingerprint) => Promise.resolve(setup.captures.get(fingerprint.digest)),
      },
      resources: {
        reopenExact: (expected) =>
          expected.uri === setup.resource.uri
            ? Promise.resolve({ bytes: setup.resourceBytes })
            : Promise.reject(
              new Error(`unknown agent resource ${expected.uri}`),
            ),
      },
    });
    const revision = (await setup.baseline.projects.get(E2E_PROJECT_ID))!.revision;
    const command = {
      commandId: "execute-r1",
      projectId: E2E_PROJECT_ID,
      expectedRevision: revision,
      issuedAt: E2E_ISSUED_AT,
      runId: "run:worksheet-r1",
    };
    await assertRejects(
      () => crashingExecutor.execute(SYNTHETIC_BASELINE_AGENT, { ...command }),
      Error,
      "simulated crash after durable write",
    );
    const interrupted = (await setup.baseline.projects.get(E2E_PROJECT_ID))!;
    assertEquals(
      interrupted.agentRuns.find((item) => item.id === "run:worksheet-r1")?.status,
      "publishing",
    );
    const recovered = await setup.executor.execute(
      SYNTHETIC_BASELINE_AGENT,
      { ...command },
    );
    const run = recovered.agentRuns.find((item) => item.id === "run:worksheet-r1")!;
    assertEquals(run.status, "completed");
    assertEquals(setup.captures.size, 1);
    const successor = (await setup.baseline.snapshots.get(
      run.resultSnapshot!.snapshotId,
    ))!;
    assertEquals(
      successor.artifacts.filter((artifact) =>
        artifact.id.startsWith("pre-sizing-worksheet-")
      ).length,
      1,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
