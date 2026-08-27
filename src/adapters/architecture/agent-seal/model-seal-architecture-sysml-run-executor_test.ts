import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  encodeArchitectureSysmlSealParameters,
} from "../../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE } from "./qualified-architecture-sysml-analyzer.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "./architecture-sysml-source-analysis-composition.ts";
import {
  type ArchitectureSysmlSealCaptureStore,
  type ArchitectureSysmlThreadSnapshotStore,
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  ModelSealArchitectureSysmlRunExecutor,
} from "./model-seal-architecture-sysml-run-executor.ts";

const AT = "2026-08-14T00:00:00.000Z";
const PROJECT_ID = "project.architecture-sysml";
const SUBJECT_ID = "subject.architecture-sysml";
const RUN_ID = "run.architecture-sysml";
const WORK_ID = "work.architecture-sysml";
const DECISION_ID = "decision.architecture-sysml";
const APPROVAL_ID = "approval.architecture-sysml";
const COMMAND_ID = "command.architecture-sysml";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
]);

Deno.test("model.seal-architecture-sysml@1 writes a Thread document and no SysON artifact", async () => {
  const fixture = await executeFixture();
  try {
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "model.seal-architecture-sysml@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(
      snapshot?.artifacts.some((item) => item.kind === "sysml-model"),
      false,
    );
    const captureText = await fixture.captures.read(sealed![0]!.fingerprint);
    const capture = JSON.parse(captureText!);
    assertEquals(capture.unresolvedConstructs, []);
    assertEquals(capture.kind, "architecture-sysml-seal");
  } finally {
    await fixture.dispose();
  }
});

Deno.test("model.seal-architecture-sysml@1 refuses a non-agent origin", async () => {
  const fixture = await executeFixture();
  try {
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      "authenticated agent",
    );
  } finally {
    await fixture.dispose();
  }
});

async function executeFixture(): Promise<{
  readonly executor: ModelSealArchitectureSysmlRunExecutor;
  readonly command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  };
  readonly snapshots: ExecuteMemorySnapshots;
  readonly captures: ExecuteMemoryCaptures;
  readonly dispose: () => Promise<void>;
}> {
  const directory = await Deno.makeTempDir({ prefix: "architecture-sysml-seal-" });
  const sources = createArchitectureSysmlSourceAnalysisCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "architecture-sysml-source",
      directory: `${directory}/sources`,
      uriNamespace: "architecture-sysml-source",
      label: "architecture SysML source",
    }),
    analysisCaptures: new FileByteStore({
      kind: "architecture-sysml-source-analysis",
      directory: `${directory}/analyses`,
      uriNamespace: "architecture-sysml-source-analysis",
      label: "architecture SysML analysis",
    }),
  });
  const reference = await sources.capture({
    profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
    sourceId: "source.architecture",
    sourceText: renderArchitectureSysmlWithManifest(proposal).sourceText,
  });
  const admission = encodeArchitectureSysmlSealParameters({
    schemaVersion: "architecture-sysml-seal-admission/1.0",
    sourceId: reference.source.id,
    profile: reference.profile,
    source: {
      sha256: reference.source.sha256,
      byteCount: reference.source.byteCount,
      casUri: reference.source.casUri,
    },
    analysis: {
      analyzer: reference.analysis.analyzer,
      policy: { ...reference.analysis.policy, status: "passed" },
      sha256: reference.analysis.sha256,
      byteCount: reference.analysis.byteCount,
      casUri: reference.analysis.casUri,
    },
  });
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.architecture-sysml.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Architecture SysML fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Recorded the documentary brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts: [{
      id: "artifact.brief",
      name: "Brief",
      kind: "document",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief document.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = { ...MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION, bindings: [] };
  const summary = "Seal the exact reviewed architecture SysML analysis.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters: admission },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Architecture SysML fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Seal", statement: "Seal exact SysML." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.architect",
      name: "Architect",
      order: 1,
      description: "Seal architecture SysML.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.architect",
      title: "Seal architecture SysML",
      description: "Seal exact reviewed architecture SysML.",
      kind: "architect",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION_ID],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "queued",
      summary: "Seal architecture SysML.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.architect",
      title: "Approve architecture SysML",
      question: "Seal the exact architecture SysML analysis?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters: admission,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: APPROVAL_ID,
      decisionId: DECISION_ID,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Reviewed exact bytes.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot);
  const captures = new ExecuteMemoryCaptures();
  const commands = new ExecuteCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new ModelSealArchitectureSysmlRunExecutor({
      projects,
      commands,
      snapshots,
      sources,
      captures,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    snapshots,
    captures,
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  commandReceipts: EngineeringProjectCommandReceipt[];
};

class ExecuteMemorySnapshots implements ArchitectureSysmlThreadSnapshotStore {
  readonly #items = new Map<string, ThreadSnapshot>();

  constructor(basis: ThreadSnapshot) {
    this.#items.set(basis.id, structuredClone(basis));
  }

  get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }

  getFresh(id: string): Promise<ThreadSnapshot | undefined> {
    return this.get(id);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const result =
      [...this.#items.values()].filter((item) => item.subject.id === subjectId).sort((
        left,
        right,
      ) => right.revision - left.revision)[0];
    return Promise.resolve(result && structuredClone(result));
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    const attempted = structuredClone(snapshot);
    const existing = this.#items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(attempted)) {
      return Promise.reject(
        new Error(`immutable snapshot ${snapshot.id} was rewritten`),
      );
    }
    if (!existing) this.#items.set(snapshot.id, attempted);
    return Promise.resolve();
  }
}

class ExecuteMemoryCaptures implements ArchitectureSysmlSealCaptureStore {
  readonly #items = new Map<string, string>();

  save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve();
  }

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class ExecuteCommands {
  #claimIdentity?: string;
  #completeResult?: EngineeringProjectCommandReceipt["resultingSnapshot"];

  constructor(readonly project: MutableProject) {}

  claimRun(
    origin: typeof AGENT,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const identity = deterministicJson({ origin, command });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      this.#claimIdentity = identity;
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      this.project.revision += 1;
      return Promise.resolve(this.project);
    }
    if (identity !== this.#claimIdentity) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "command_id_conflict",
          "claim command differs from its immutable receipt",
        ),
      );
    }
    return Promise.resolve(this.project);
  }

  publishRun(): Promise<EngineeringProjectSnapshot> {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }

  async completeRun(
    origin: typeof AGENT,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const identity = deterministicJson({ origin, command });
    const requestFingerprint = await sha256Fingerprint({
      type: "agent-run.complete",
      origin,
      command,
    });
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "completed") {
      return this.project;
    }
    void identity;
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
    if (
      !this.project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.#completeResult = {
      snapshotId: `project.receipt.r${this.project.revision}`,
      revision: this.project.revision,
    };
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint,
      resultingSnapshot: this.#completeResult,
    });
    return this.project;
  }

  failRun(
    _origin: typeof AGENT,
    command: FailRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "failed";
    run.failure = { code: command.code, message: command.message };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}

type MutableRun = {
  -readonly [Key in keyof EngineeringProjectSnapshot["agentRuns"][number]]:
    EngineeringProjectSnapshot["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof EngineeringProjectSnapshot["workItems"][number]]:
    EngineeringProjectSnapshot["workItems"][number][Key];
};
type MutablePhase = {
  -readonly [Key in keyof EngineeringProjectSnapshot["phases"][number]]:
    EngineeringProjectSnapshot["phases"][number][Key];
};

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}
