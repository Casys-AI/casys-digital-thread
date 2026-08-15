import { assertEquals, assertRejects } from "@std/assert";
import type { Build123dExecutionProfile } from "../../application/ports/out/build123d-execution-profile-catalog.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { IsolatedCodeRunner } from "../../application/ports/out/isolated-code-runner.ts";
import type { ReopenedTechnicalCompilationAdmission } from "../../application/ports/out/technical-compilation-admission-reader.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { BUILD123D_EXECUTION_PROFILE } from "../../domain/analysis/build123d-execution-proposal.ts";
import {
  fingerprintResourceBytes,
  immutableBytes,
} from "../../domain/analysis/provider-resource-reader.ts";
import type { IsolatedCodeExecutionReceipt } from "../../domain/analysis/isolated-code-execution.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "../../domain/analysis/sensitivity-study-template.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
} from "../captures/sensitivity-study-case-capture.ts";
import { validateSensitivityStudyCapture } from "../../domain/analysis/sensitivity-study-capture.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  FileFeaSensitivityAttemptStore,
} from "../wal/file-fea-sensitivity-attempt-store.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  AnalyzeRunFeaSensitivityRunExecutor,
} from "./analyze-run-fea-sensitivity-run-executor.ts";

const AT = "2026-08-14T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl04";
const SUBJECT_ID = "lamp-arm";
const RUN_ID = "run.sensitivity";
const WORK_ID = "work.sensitivity";
const DECISION_ID = "decision.sensitivity";
const APPROVAL_ID = "approval.sensitivity";
const CASE_ARTIFACT_ID = "sensitivity-case-sealed";
const ADMISSION_ID = "compile-admission-1";
const ADMISSION_DIGEST = "a".repeat(64);
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test(
  "analyze.run-fea-sensitivity@1 consumes only the sealed study-case artifact",
  async () => {
    const fixture = await createFixture();
    try {
      const project = await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(project.agentRuns[0]?.status, "completed");
      const snapshot = await fixture.snapshots.getFresh(
        project.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      assertEquals(
        snapshot?.artifacts.some((item) => item.kind === "cad-model"),
        false,
      );
      assertEquals(snapshot?.evaluations.length, 0);
      assertEquals(snapshot?.violations.length, 0);
      assertEquals(snapshot?.requirements.length, 0);
      assertEquals((snapshot?.observations.length ?? 0) > 0, true);
      assertEquals(
        snapshot?.observations.every((item) => item.quantity.unit.length > 0),
        true,
      );
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test("the step used for the finite difference is the sealed case step", async () => {
  const fixture = await createFixture();
  try {
    await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(fixture.runner.sources[0]?.includes("size_z = 50"), true);
    assertEquals(fixture.runner.sources[1]?.includes("size_z = 51"), true);
  } finally {
    await fixture.dispose();
  }
});

Deno.test(
  "proposal text is never substituted into IsolatedCodeRunner source",
  async () => {
    const fixture = await createFixture();
    try {
      await fixture.executor.execute(AGENT, fixture.command);
      assertEquals(fixture.runner.sources, [
        "size_z = 50\nresult = Box(1, 1, size_z)\n",
        "size_z = 51\nresult = Box(1, 1, size_z)\n",
      ]);
      assertEquals(
        fixture.runner.sources.some((text) => text.includes("agent-script-XXX")),
        false,
      );
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test("cadSource sha256 mismatch is rejected before CAD dispatch", async () => {
  const fixture = await createFixture({ admissionDigest: "b".repeat(64) });
  try {
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "sha256",
    );
    assertEquals(fixture.runner.sources.length, 0);
    assertEquals(fixture.solver.calls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("a retry after WAL completion does not re-dispatch CAD or CalculiX", async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.executor.execute(AGENT, fixture.command);
    const firstSnapshot = first.agentRuns[0]!.resultSnapshot!.snapshotId;
    assertEquals(fixture.runner.sources.length, 2);
    assertEquals(fixture.solver.calls, 2);
    fixture.resetRunToRunningOnOriginalBasis();
    const second = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(second.agentRuns[0]?.status, "completed");
    assertEquals(second.agentRuns[0]?.resultSnapshot?.snapshotId, firstSnapshot);
    assertEquals(fixture.runner.sources.length, 2);
    assertEquals(fixture.solver.calls, 2);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("dispatched CAD without a published STEP is terminal", async () => {
  const fixture = await createFixture();
  try {
    await fixture.attempts.prepare({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      planDigest: fixture.planDigest,
    });
    await fixture.attempts.markCadDispatched({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      phase: "base",
      executionRunId: `${RUN_ID}:cad-base`,
      dispatchedAt: AT,
      sourceSha256: "c".repeat(64),
    });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "dispatched without a published STEP",
    );
    assertEquals(fixture.runner.sources.length, 0);
    assertEquals(fixture.solver.calls, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("the published study capture has no isolated STEP bytes", async () => {
  const fixture = await createFixture();
  try {
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const snapshot = await fixture.snapshots.getFresh(
      project.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const artifact = snapshot?.artifacts.find((item) =>
      item.producer.tool === "analyze.run-fea-sensitivity@1"
    );
    const text = await fixture.studyCaptures.read(artifact!.fingerprint);
    const capture = await validateSensitivityStudyCapture(JSON.parse(text!));
    assertEquals("bytes" in capture.cad.base, false);
    assertEquals("bytes" in capture.cad.stepped, false);
    assertEquals(Object.keys(capture.cad.base).sort(), [
      "executionRunId",
      "sourceSha256",
      "stepBytes",
      "stepSha256",
    ]);
  } finally {
    await fixture.dispose();
  }
});

Deno.test(
  "analyze.run-fea-sensitivity@1 refuses a human origin before any store access",
  async () => {
    const executor = new AnalyzeRunFeaSensitivityRunExecutor({
      projects: { get: () => Promise.reject(new Error("must not read")) } as never,
      commands: {} as never,
      snapshots: {} as never,
      caseCaptures: {} as never,
      studyCaptures: {} as never,
      admissions: {} as never,
      profiles: {} as never,
      runner: {} as never,
      stager: {} as never,
      solver: {} as never,
      attempts: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: "c",
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

async function createFixture(options: { readonly admissionDigest?: string } = {}) {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-run-" });
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV2(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/${ADMISSION_ID}`,
    sha256: ADMISSION_DIGEST,
  });
  const caseDigest = (await sha256Fingerprint(studyCase)).digest;
  const caseCapture = {
    schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
    operation: { id: "analyze.seal-sensitivity-study", version: "1" },
    trustedRunId: "run.seal",
    caseDigest,
    canonicalCaseText: deterministicJson(studyCase),
    studyCase,
    admissionArtifact: {
      id: ADMISSION_ID,
      fingerprint: { algorithm: "sha256", digest: ADMISSION_DIGEST },
    },
    sealedAt: AT,
  };
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  const caseArtifact = {
    id: CASE_ARTIFACT_ID,
    name: "Sealed sensitivity case",
    kind: "document" as const,
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `casys://sensitivity-study-case-capture/sha256/${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "analyze.seal-sensitivity-study@1",
      runId: "run.seal",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const admissionArtifact = {
    id: ADMISSION_ID,
    name: "Admission",
    kind: "document" as const,
    version: options.admissionDigest ?? ADMISSION_DIGEST,
    fingerprint: {
      algorithm: "sha256" as const,
      digest: options.admissionDigest ?? ADMISSION_DIGEST,
    },
    uri: `casys://technical-compilation-admission-capture/sha256/${
      options.admissionDigest ?? ADMISSION_DIGEST
    }`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@1",
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
      id: "change-set.case",
      name: "Case",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.case",
        kind: "created",
        target: { kind: "artifact", id: CASE_ARTIFACT_ID },
        summary: "Sealed the sensitivity study case.",
        afterFingerprint: caseFingerprint,
      }],
    },
    artifacts: [
      {
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
      },
      admissionArtifact,
      caseArtifact,
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.case",
      relation: "changes",
      from: { kind: "change", id: "change.case" },
      to: { kind: "artifact", id: CASE_ARTIFACT_ID },
      rationale: "The applied change introduced the sealed case.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const evidenceRef = {
    snapshotId: basisSnapshot.id,
    snapshotRevision: basisSnapshot.revision,
    kind: "artifact" as const,
    id: CASE_ARTIFACT_ID,
  };
  const operation = {
    id: "analyze.run-fea-sensitivity",
    version: "1",
    bindings: [{
      name: "studyCase",
      source: { kind: "thread-entity" as const, reference: evidenceRef },
    }],
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [evidenceRef],
    proposal: { summary: "Run the study", parameters: [] },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK_ID,
    basis: { kind: "thread-snapshot", ...reviewBasis },
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
      name: "Sensitivity",
      subjectId: SUBJECT_ID,
      objective: { title: "Study", statement: "Measure derivatives." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.simulate",
      name: "Simulate",
      order: 1,
      description: "Run sensitivity.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      phaseId: "phase.simulate",
      title: "Run sensitivity",
      description: "Two-solve study.",
      kind: "simulate",
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
      summary: "Run sensitivity.",
      queuedAt: AT,
      basis: { kind: "thread-snapshot", ...reviewBasis },
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.simulate",
      title: "Approve run",
      question: "Run the sealed study?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
      approvalIds: [APPROVAL_ID],
      proposal: {
        summary: "Run the study",
        parameters: [{
          key: "agent.source",
          label: "Agent source",
          value: "agent-script-XXX",
        }],
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
      rationale: "Go.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [evidenceRef],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(basisSnapshot);
  const caseCaptures = new MemoryCaptures();
  await caseCaptures.save(caseFingerprint, deterministicJson(caseCapture));
  const studyCaptures = new MemoryCaptures();
  const runner = new FakeRunner();
  const solver = new FakeSolver();
  const stager = new FakeStager();
  const attempts = new FileFeaSensitivityAttemptStore(`${directory}/wal`);
  const commands = new MemoryCommands(project);
  const planDigest = (await sha256Fingerprint({
    caseDigest,
    cadSource: studyCase.cadSource,
    step: studyCase.step,
    executionProfile: BUILD123D_EXECUTION_PROFILE,
  })).digest;
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    runner,
    solver,
    attempts,
    planDigest,
    studyCaptures,
    snapshots,
    command: {
      commandId: "command.sensitivity",
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    resetRunToRunningOnOriginalBasis: () => {
      const run = project.agentRuns[0] as unknown as {
        status: string;
        startedAt?: string;
        claimedBy?: { id: string; origin: "agent" };
      };
      run.status = "running";
      run.startedAt = AT;
      run.claimedBy = { id: AGENT.actorId, origin: "agent" };
      (project as { threadSnapshots: unknown }).threadSnapshots = [reviewBasis];
    },
    executor: new AnalyzeRunFeaSensitivityRunExecutor({
      projects,
      commands,
      snapshots,
      caseCaptures: caseCaptures as never,
      studyCaptures: studyCaptures as never,
      admissions: {
        read: () =>
          Promise.resolve({
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
          } as unknown as ReopenedTechnicalCompilationAdmission),
      },
      profiles: {
        initial: () => Promise.reject(new Error("initial is latest; must resolve")),
        resolve: (ref) => {
          if (
            ref.id !== BUILD123D_EXECUTION_PROFILE.id ||
            ref.version !== BUILD123D_EXECUTION_PROFILE.version
          ) {
            return Promise.reject(new Error("unsealed execution profile"));
          }
          return Promise.resolve(fakeProfile());
        },
      },
      runner,
      stager,
      solver: solver as never,
      attempts,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
    }),
    dispose: () => Deno.remove(directory, { recursive: true }),
  };
}

function fakeProfile(): Build123dExecutionProfile {
  return {
    executionProfile: { id: "build123d-closed-subset-v1", version: "1.0.0" },
    isolationPolicy: {
      id: "isolation.build123d-closed-v1",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    outputManifest: [{
      role: "geometry",
      basename: "geometry.step",
      mediaType: "model/step",
      format: "step-ap214",
    }],
    maximumSourceBytes: 1_000_000,
  } as unknown as Build123dExecutionProfile;
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

class FakeRunner implements IsolatedCodeRunner {
  readonly sources: string[] = [];
  async run(request: { readonly source: { readonly bytes: Uint8Array } }) {
    const text = new TextDecoder().decode(request.source.bytes);
    this.sources.push(text);
    const step = new TextEncoder().encode(
      text.includes("= 51") ? "STEP-STEPPED" : "STEP-BASE",
    );
    const sha256 = await fingerprintResourceBytes(step);
    return {
      outputs: [{
        role: "geometry",
        basename: "geometry.step",
        mediaType: "model/step",
        format: "step-ap214",
        byteCount: step.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
        bytes: immutableBytes(step),
      }],
    } as unknown as IsolatedCodeExecutionReceipt;
  }
}

class FakeStager {
  readonly #byDigest = new Map<string, Uint8Array>();
  stage(input: {
    readonly bytes: Uint8Array;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }) {
    this.#byDigest.set(input.fingerprint.digest, input.bytes);
    return Promise.resolve({
      stagedAsset: { location: `/inputs/fea-${input.fingerprint.digest}.step` },
    });
  }
  read(input: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }) {
    const bytes = this.#byDigest.get(input.fingerprint.digest);
    if (!bytes || bytes.byteLength !== input.byteCount) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(bytes);
  }
}

class FakeSolver {
  calls = 0;
  resolve(
    input: { readonly inputArtifact: { readonly fingerprint: ContentFingerprint } },
  ) {
    return { input: input.inputArtifact.fingerprint.digest };
  }
  solve(plan: { readonly input: string }) {
    this.calls += 1;
    const stepped = this.calls > 1;
    const displacement = stepped ? 1.5 : 0.5;
    const stress = stepped ? 8 : 10;
    return Promise.resolve({
      result: {
        inputAttestation: {
          fingerprint: { algorithm: "sha256", digest: plan.input },
          byteCount: 10,
        },
        observations: {
          maximumDisplacement: {
            magnitude: { value: displacement, unit: "mm" },
            vector: { value: [0, 0, displacement], unit: "mm" },
          },
          maximumVonMisesStress: {
            magnitude: { value: stress, unit: "MPa" },
          },
        },
      },
    });
  }
}

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(id: string) {
    return Promise.resolve(this.#byId.get(id));
  }
  getFresh(id: string) {
    return this.get(id);
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
    return `casys://sensitivity-study-capture/sha256/${fingerprint.digest}`;
  }
}

type MutableProject = EngineeringProjectSnapshot & { revision: number };

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0] as unknown as {
      status: string;
      startedAt?: string;
      claimedBy?: { id: string; origin: "agent" };
    };
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: "agent" };
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
      resultSnapshot?: CompleteRunCommand["resultSnapshot"];
      evidenceRefs: unknown[];
    };
    run.status = "completed";
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
  failRun(_origin: typeof AGENT, _command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
