import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { ReopenedTechnicalCompilationAdmission } from "../../application/ports/out/technical-compilation-admission-reader.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  encodeSensitivityStudyDecisionParameters,
} from "../../domain/analysis/sensitivity-study-proposal.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "../../domain/analysis/sensitivity-study-template.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  AnalyzeSealSensitivityStudyRunExecutor,
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
} from "./analyze-seal-sensitivity-study-run-executor.ts";

const AT = "2026-08-14T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl04";
const SUBJECT_ID = "lamp-arm";
const RUN_ID = "run.sensitivity-seal";
const WORK_ID = "work.sensitivity-seal";
const DECISION_ID = "decision.sensitivity-seal";
const APPROVAL_ID = "approval.sensitivity-seal";
const COMMAND_ID = "command.sensitivity-seal";
const ADMISSION_ID = "compile-admission-1";
const ADMISSION_DIGEST = "a".repeat(64);
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test(
  "analyze.seal-sensitivity-study@1 publishes a document artifact and never calls a provider",
  async () => {
    const fixture = await createFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "analyze.seal-sensitivity-study@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(
      sealed?.[0]?.uri?.startsWith(SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX),
      true,
    );
    assertEquals(snapshot?.observations.length, 0);
    assertEquals(snapshot?.evaluations.length, 0);
    assertEquals(snapshot?.violations.length, 0);
    assertEquals(fixture.admissions.reads.length, 1);
  },
);

Deno.test(
  "the sealed case digest matches the human-signed MRTR parameter",
  async () => {
    const fixture = await createFixture();
    await fixture.executor.execute(AGENT, fixture.command);
    const captureText = [...fixture.captures.values()][0]!;
    const capture = JSON.parse(captureText) as { caseDigest: string };
    assertEquals(capture.caseDigest, fixture.caseDigest);
  },
);

Deno.test(
  "analyze.seal-sensitivity-study@1 refuses a human origin before any store access",
  async () => {
    const executor = new AnalyzeSealSensitivityStudyRunExecutor({
      projects: { get: () => Promise.reject(new Error("must not read")) } as never,
      commands: {} as never,
      snapshots: {} as never,
      admissions: {} as never,
      captures: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: COMMAND_ID,
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: AT,
          runId: RUN_ID,
        }),
      EngineeringProjectCommandError,
      "authenticated agent",
    );
  },
);

Deno.test("an unknown catalog id is indistinguishable from an absent case", async () => {
  const fixture = await createFixture({ caseId: "unknown-case" });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "not in the server-side catalog",
  );
});

Deno.test("cadSource is re-read from the Thread and rejected on sha256 mismatch", async () => {
  const fixture = await createFixture({ admissionDigest: "b".repeat(64) });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "sha256",
  );
});

Deno.test(
  "cadSource that is not a compile.seal-admission@1 admission is rejected",
  async () => {
    const fixture = await createFixture({
      admissionTool: "design.execute-build123d@1",
    });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "compile.seal-admission@1",
    );
  },
);

Deno.test("a completed run replays the capture without a second provider call", async () => {
  const fixture = await createFixture();
  await fixture.executor.execute(AGENT, fixture.command);
  const firstReads = fixture.admissions.reads.length;
  const again = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(again.agentRuns[0]?.status, "completed");
  assertEquals(fixture.admissions.reads.length, firstReads);
});

async function createFixture(options: {
  readonly caseId?: string;
  readonly admissionDigest?: string;
  readonly admissionTool?: string;
} = {}) {
  const templateText = await Deno.readTextFile(
    "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
  );
  const template = validateSensitivityStudyCaseTemplate(JSON.parse(templateText));
  const cadSource = {
    artifactUri: `thread-artifact://${PROJECT_ID}/${ADMISSION_ID}`,
    sha256: ADMISSION_DIGEST,
  };
  const studyCase = assembleSensitivityStudyCaseV2(template, cadSource);
  const caseDigest = options.caseId === undefined
    ? (await sha256Fingerprint(studyCase)).digest
    : "c".repeat(64);
  const parameters = encodeSensitivityStudyDecisionParameters(
    caseDigest,
    options.caseId ? { ...studyCase, id: options.caseId } : studyCase,
  );
  const admissionFingerprint = {
    algorithm: "sha256" as const,
    digest: options.admissionDigest ?? ADMISSION_DIGEST,
  };
  const admissionArtifact = {
    id: ADMISSION_ID,
    name: "Compilation admission",
    kind: "document" as const,
    version: admissionFingerprint.digest,
    fingerprint: admissionFingerprint,
    uri:
      `casys://technical-compilation-admission-capture/sha256/${admissionFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: options.admissionTool ?? "compile.seal-admission@1",
      runId: "run.admission",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.sensitivity.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Sensitivity fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.admission",
      name: "Admission",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.admission",
        kind: "created",
        target: { kind: "artifact", id: admissionArtifact.id },
        summary: "Sealed the compilation admission.",
        afterFingerprint: admissionFingerprint,
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
    }, admissionArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.admission",
      relation: "changes",
      from: { kind: "change", id: "change.admission" },
      to: { kind: "artifact", id: admissionArtifact.id },
      rationale: "The applied change introduced the admission.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    id: "analyze.seal-sensitivity-study",
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const summary = "Seal the reviewed sensitivity study.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters },
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
      name: "Sensitivity fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Seal", statement: "Seal the study case." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.review",
      name: "Review",
      order: 1,
      description: "Seal the study.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      phaseId: "phase.review",
      title: "Seal sensitivity study",
      description: "Seal the reviewed case.",
      kind: "review",
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
      summary: "Seal sensitivity study.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.review",
      title: "Approve sensitivity seal",
      question: "Seal the exact sensitivity study?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary,
        parameters,
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
      rationale: "Reviewed the case.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(basisSnapshot);
  const captures = new MemoryCaptures();
  const admissions = new FakeAdmissions();
  const commands = new MemoryCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    caseDigest,
    captures,
    admissions,
    snapshots,
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    executor: new AnalyzeSealSensitivityStudyRunExecutor({
      projects,
      commands,
      snapshots,
      admissions,
      captures: captures as never,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      readTextFile: (path) => {
        if (path.endsWith("dl04-size-z-sensitivity.json")) {
          return Promise.resolve(templateText);
        }
        return Promise.reject(new Error(`unexpected path ${path}`));
      },
    }),
  };
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  getFresh(snapshotId: string) {
    return this.get(snapshotId);
  }
  latest() {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryCaptures {
  readonly #byDigest = new Map<string, string>();
  values() {
    return this.#byDigest.values();
  }
  save(fingerprint: ContentFingerprint, text: string) {
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({
      uri: this.uriFor(fingerprint),
      path: `${fingerprint.digest}.json`,
    });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `${SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX}${fingerprint.digest}`;
  }
}

class FakeAdmissions {
  readonly reads: unknown[] = [];
  read(request: unknown) {
    this.reads.push(request);
    return Promise.resolve({
      document: {
        inputManifest: {
          sources: [{
            sourceText: "size_z = 50\nresult = Box(1, 1, size_z)\n",
            analysis: {
              symbols: [{
                id: "sym:size_z",
                kind: "parameter",
                name: "size_z",
                span: {
                  start: { line: 1, column: 0 },
                  end: { line: 1, column: 6 },
                },
              }],
            },
          }],
        },
      },
    } as unknown as ReopenedTechnicalCompilationAdmission);
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  commandReceipts: unknown[];
};

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0]!;
    if (run.status === "queued") {
      (run as { status: string }).status = "running";
      (run as { startedAt?: string }).startedAt = AT;
      (run as { claimedAt?: string }).claimedAt = AT;
      (run as { claimedBy?: { id: string; origin: "agent" } }).claimedBy = {
        id: origin.actorId,
        origin: "agent",
      };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as { status: string }).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  completeRun(_origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns[0] as unknown as {
      status: string;
      completedAt?: string;
      resultSnapshot?: CompleteRunCommand["resultSnapshot"];
      evidenceRefs: unknown[];
    };
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    if (
      !this.project.threadSnapshots.some((item) =>
        item.snapshotId === command.resultSnapshot.snapshotId
      )
    ) {
      (this.project as { threadSnapshots: unknown }).threadSnapshots = [
        ...this.project.threadSnapshots,
        command.resultSnapshot,
      ];
    }
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(_origin: typeof AGENT, command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    (this.project.agentRuns[0] as { failure?: unknown }).failure = {
      code: command.code,
      message: command.message,
    };
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
