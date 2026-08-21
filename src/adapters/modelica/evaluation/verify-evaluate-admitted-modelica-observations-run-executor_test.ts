import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  McpToolCall,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { AdmittedObservationEvidenceReader } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  deriveAdmittedObservationEvaluationMethod,
  fingerprintAdmittedObservationEvaluationMethod,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import { encodeAdmittedObservationEvaluationAdmission } from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
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
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import { FileAdmittedObservationEvaluationAttemptStore } from "./file-admitted-observation-evaluation-attempt-store.ts";
import {
  VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
  VerifyEvaluateAdmittedModelicaObservationsRunExecutor,
} from "./verify-evaluate-admitted-modelica-observations-run-executor.ts";

const AT = "2026-08-21T12:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const RUN_ID = "run.evaluate-observations";
const WORK_ID = "work.evaluate-observations";
const DECISION_ID = "decision.evaluate-observations";
const APPROVAL_ID = "approval.evaluate-observations";
const COMMAND_ID = "command.evaluate-observations";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const EVIDENCE_DIGEST = "c".repeat(64);

Deno.test(
  "evaluate-admitted-modelica-observations writes unresolved evaluations without a local fail",
  async () => {
    const fixture = await executeFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      const run = project.agentRuns[0]!;
      assertEquals(run.status, "completed");
      const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
      const sealed = snapshot?.artifacts.filter((item) =>
        item.producer.tool ===
          "verify.evaluate-admitted-modelica-observations@1"
      );
      assertEquals(sealed?.length, 1);
      assertEquals(sealed?.[0]?.kind, "document");
      assertEquals(
        snapshot?.evaluations.every((item) => item.status === "unresolved"),
        true,
      );
      assertEquals(snapshot?.violations.length, 0);
      assertEquals(fixture.syson.calls.length, 1);
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations refuses a non-agent origin",
  async () => {
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
  },
);

Deno.test(
  "evaluate-admitted-modelica-observations WAL refuses replay of an unknown dispatch",
  async () => {
    const fixture = await executeFixture();
    try {
      await fixture.attempts.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        dispatchedAt: AT,
      });
      await assertRejects(
        () => fixture.executor.execute(AGENT, fixture.command),
        Error,
        "unknown",
      );
      assertEquals(fixture.syson.calls.length, 0);
    } finally {
      await fixture.dispose();
    }
  },
);

async function executeFixture() {
  const directory = await Deno.makeTempDir({
    prefix: "evaluate-admitted-modelica-",
  });
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  const method = deriveAdmittedObservationEvaluationMethod(
    sheet,
    await admittedModelicaUnitIdentityPolicy(),
  );
  const methodFingerprint = await fingerprintAdmittedObservationEvaluationMethod(
    method,
  );
  const evidenceFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: EVIDENCE_DIGEST,
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "placeholder-thread-snapshot",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Evaluation fixture",
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
    }, {
      id: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
      name: "Admitted evidence",
      kind: "evidence",
      version: EVIDENCE_DIGEST,
      fingerprint: evidenceFingerprint,
      uri: `casys://isolated-output/sha256/${EVIDENCE_DIGEST}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: "run.admitted",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    }],
    consumptions: [],
    observations: [],
    requirements: [{
      id: "placeholder-requirement",
      name: "placeholder",
      statement: "Placeholder requirement. Not a thermal verdict.",
      version: "1",
      criterion: {
        metric: "placeholder-output",
        operator: "<=",
        limit: { value: 1, unit: "unit-pending-source" },
      },
      trace: {
        sourceArtifactId: "artifact.brief",
        elementId: "placeholder-requirement",
        targetArtifactIds: ["artifact.brief"],
      },
      freshness: fresh(AT),
    }],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief document.",
    }, {
      id: "trace-requirement-to-brief",
      relation: "traces_to",
      from: { kind: "requirement", id: "placeholder-requirement" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The placeholder requirement constrains the brief artifact.",
    }],
    proposedActions: [],
  });
  const basisFingerprint = await sha256Fingerprint(basisSnapshot);
  const admission = encodeAdmittedObservationEvaluationAdmission({
    schemaVersion: "modelica-admitted-observation-evaluation-admission/1.0",
    methodSchemaVersion: method.schemaVersion,
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    basis: {
      snapshotId: basisSnapshot.id,
      revision: basisSnapshot.revision,
      fingerprint: basisFingerprint,
    },
    sheet: { id: sheet.id, fingerprint: sheetFingerprint },
    evidence: {
      artifactId: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
      fingerprint: evidenceFingerprint,
    },
    methodFingerprint,
    profileId: method.profile.id,
    unitPolicy: {
      id: method.unitPolicy.id,
      fingerprint: method.unitPolicy.fingerprint,
    },
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    ...VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const summary = "Evaluate admitted Modelica observations.";
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
    schemaVersion: "3.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: SUBJECT_ID,
      objective: { title: "Evaluate", statement: summary },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.verify",
      name: "Verify",
      order: 1,
      description: "Evaluate observations.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      phaseId: "phase.verify",
      title: "Evaluate observations",
      description: summary,
      kind: "verify",
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
      summary,
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.verify",
      title: "Approve evaluation",
      question: "Evaluate the exact admitted observations?",
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
      rationale: "Reviewed identities.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new ExecuteMemorySnapshots(basisSnapshot);
  const captures = new ExecuteMemoryCaptures();
  const sheets = new MemorySheetStore(sheet, sheetFingerprint);
  const evidence = new MemoryEvidenceReader();
  const syson = new RecordingSysonClient({
    results: [{
      constraintId: "placeholder-requirement",
      status: "unresolved",
    }],
  });
  const attempts = new FileAdmittedObservationEvaluationAttemptStore(
    `${directory}/attempts`,
  );
  const commands = new ExecuteCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    executor: new VerifyEvaluateAdmittedModelicaObservationsRunExecutor({
      projects,
      commands,
      snapshots,
      sheets,
      evidence,
      captures,
      attempts,
      syson,
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
    attempts,
    syson,
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

class ExecuteMemorySnapshots {
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

class ExecuteMemoryCaptures {
  readonly #items = new Map<string, string>();
  save(fingerprint: ContentFingerprint, text: string) {
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve({ fingerprint, uri: `casys://x/${fingerprint.digest}` });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class MemorySheetStore implements ThermalMethodSheetStore {
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("unused"));
  }
  read(fingerprint: ContentFingerprint) {
    if (fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.sheet);
  }
}

class MemoryEvidenceReader implements AdmittedObservationEvidenceReader {
  read() {
    return Promise.resolve({
      modelName: "placeholder-module",
      outputs: [{ name: "placeholder-output", unit: "unit-pending-source" }],
      metrics: [{
        outputName: "placeholder-output",
        statistic: "final" as const,
        unit: "unit-pending-source",
        value: 0,
      }],
    });
  }
}

class RecordingSysonClient {
  readonly calls: McpToolCall[] = [];
  constructor(private readonly content: Record<string, unknown>) {}
  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(call);
    return Promise.resolve({
      structuredContent: structuredClone(this.content),
      text: "",
    });
  }
  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("unused"));
  }
}

class ExecuteCommands {
  #claimIdentity?: string;
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, command: RunCommand) {
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
          "claim command differs",
        ),
      );
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  async completeRun(origin: typeof AGENT, command: CompleteRunCommand) {
    const requestFingerprint = await sha256Fingerprint({
      type: "agent-run.complete",
      origin,
      command,
    });
    const run = this.project.agentRuns[0] as MutableRun;
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    if (
      !this.project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint,
      resultingSnapshot: {
        snapshotId: `project.receipt.r${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    return this.project;
  }
  failRun(_origin: typeof AGENT, command: FailRunCommand) {
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

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}
