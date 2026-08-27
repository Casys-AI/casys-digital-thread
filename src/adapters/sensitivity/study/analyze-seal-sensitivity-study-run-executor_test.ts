import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ReopenedTechnicalCompilationAdmission } from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectSensitivityStudySealReview } from "../../../application/use-cases/sensitivity/study/prepare-project-sensitivity-study-seal-review.ts";
import {
  SIGNED_OFFER_AT,
  SIGNED_OFFER_CASE_ID,
  SIGNED_OFFER_PROJECT_ID,
  SIGNED_OFFER_SUBJECT_ID,
  signedCatalogOfferFixture,
  snapshotWithAdmissionTool,
} from "../../../testing/signed-catalog-offer-test-support.ts";
import { parseSensitivityStudyDecisionParameters } from "../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  AnalyzeSealSensitivityStudyRunExecutor,
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
} from "./analyze-seal-sensitivity-study-run-executor.ts";
import { FileCataloguedSensitivityStudyCaseReader } from "./file-catalogued-sensitivity-study-case-reader.ts";

const AT = SIGNED_OFFER_AT;
const PROJECT_ID = SIGNED_OFFER_PROJECT_ID;
const SUBJECT_ID = SIGNED_OFFER_SUBJECT_ID;
const RUN_ID = "run.sensitivity-seal";
const WORK_ID = "wi-sensitivity-seal-desk-lamp-dl06-arm-cantilever-arm_thickness";
const DECISION_ID = "dec-sensitivity-seal-desk-lamp-dl06-arm-cantilever-arm_thickness";
const APPROVAL_ID = "approval.sensitivity-seal";
const COMMAND_ID = "command.sensitivity-seal";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const REAL_CATALOG = new FileCataloguedSensitivityStudyCaseReader();

Deno.test(
  "analyze.seal-sensitivity-study@1 seals the unique signed catalog offer",
  async () => {
    const fixture = await createOfferFixture();
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
  },
);

Deno.test(
  "the sealed case digest matches the human-signed MRTR parameter",
  async () => {
    const fixture = await createOfferFixture();
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
      catalog: {} as never,
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

Deno.test(
  "an offer-compiled id without a unique signed offer is refused before claim",
  async () => {
    const fixture = await createOfferFixture({ omitOffer: true });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "not in the server-owned catalog manifest",
    );
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
  },
);

Deno.test(
  "several signed offers refuse the seal before claim",
  async () => {
    const fixture = await createOfferFixture({ extraOffer: true });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "Several signed sensitivity catalog offers",
    );
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
  },
);

Deno.test(
  "a named id that is not the compiled offer id is catalog-offer-case-mismatch",
  async () => {
    const fixture = await createOfferFixture({ namedCaseId: "invented-dl06-case" });
    const error = await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
    );
    assertStringIncludes(error.message, "invented-dl06-case");
    assertStringIncludes(error.message, SIGNED_OFFER_CASE_ID);
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
  },
);

Deno.test(
  "a truncated offer is catalog-offer-integrity-failed and does not throw TypeError",
  async () => {
    const fixture = await createOfferFixture({ truncatedOffer: true });
    const error = await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
    );
    assertStringIncludes(error.message, "authority");
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
  },
);

Deno.test(
  "a constructor-only admission refuses the offer-compiled seal",
  async () => {
    const fixture = await createOfferFixture({
      admissionSource: "from build123d import Box\nresult = Box(220, 20, 10)\n",
    });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "no longer compiles",
    );
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
  },
);

Deno.test(
  "cadSource sha256 that is not the recompiled offer admission is refused",
  async () => {
    const fixture = await createOfferFixture({
      cadSourceSha256: "b".repeat(64),
    });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "cadSource",
    );
  },
);

Deno.test(
  "cadSource that is not a compile.seal-admission@3 admission is rejected",
  async () => {
    const fixture = await createOfferFixture({
      admissionTool: "design.execute-build123d@1",
    });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "compile.seal-admission@3",
    );
  },
);

Deno.test(
  "a sibling sensitivity case sealed earlier never blocks a new digest",
  async () => {
    const fixture = await createOfferFixture({ siblingCaseDigest: "b".repeat(64) });
    const project = await fixture.executor.execute(AGENT, fixture.command);
    const run = project.agentRuns[0]!;
    assertEquals(run.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(run.resultSnapshot!.snapshotId);
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "analyze.seal-sensitivity-study@1"
    );
    assertEquals(sealed?.length, 2);
  },
);

Deno.test(
  "a completed run replays without writing a second capture",
  async () => {
    const fixture = await createOfferFixture();
    await fixture.executor.execute(AGENT, fixture.command);
    const firstCaptures = [...fixture.captures.values()].length;
    const again = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(again.agentRuns[0]?.status, "completed");
    assertEquals([...fixture.captures.values()].length, firstCaptures);
  },
);

Deno.test(
  "a digest-valid offer whose inputManifest lacks the lever still seals",
  async () => {
    const fixture = await createOfferFixture({ emptyInputManifest: true });
    const project = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(project.agentRuns[0]?.status, "completed");
  },
);

Deno.test(
  "an offer on the tip without capture readers is refused, not a catalog fallback",
  async () => {
    const fixture = await createOfferFixture({ omitReaders: true });
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "no offer or proof capture reader",
    );
    assertEquals(fixture.project.agentRuns[0]?.status, "queued");
  },
);

async function createOfferFixture(
  options: {
    readonly omitOffer?: boolean;
    readonly extraOffer?: boolean;
    readonly truncatedOffer?: boolean;
    readonly admissionSource?: string;
    readonly namedCaseId?: string;
    readonly cadSourceSha256?: string;
    readonly admissionTool?: string;
    readonly siblingCaseDigest?: string;
    readonly emptyInputManifest?: boolean;
    readonly omitReaders?: boolean;
  } = {},
) {
  const compiled = await signedCatalogOfferFixture();
  const review = new PrepareProjectSensitivityStudySealReview({
    snapshots: {
      get: (id: string) =>
        Promise.resolve(id === compiled.snapshot.id ? compiled.snapshot : undefined),
      latest: () => Promise.resolve(compiled.snapshot),
      save: () => Promise.reject(new Error("review must not persist")),
    },
    projects: {
      get: (projectId: string) =>
        Promise.resolve(
          projectId === PROJECT_ID ? emptyProject(compiled.snapshot) : undefined,
        ),
    },
    catalogReader: REAL_CATALOG,
    admissions: compiled.admissions,
    catalogOffers: compiled.catalogOffers,
    proofCaptures: compiled.proofCaptures,
  });
  const compiledReview = await review.execute({
    projectId: PROJECT_ID,
    basis: compiled.basis,
  });
  if (compiledReview.status !== "resolved") {
    throw new Error(
      `Expected a compiled offer, got ${compiledReview.status}: ${
        compiledReview.diagnostics.map((item) => item.code).join(", ")
      }`,
    );
  }
  const parameters = compiledReview.decisionParameters.map((item) => {
    if (options.namedCaseId && item.key === "sensitivity.case.id") {
      return { ...item, value: options.namedCaseId };
    }
    if (
      options.cadSourceSha256 &&
      item.key === "sensitivity.case.cadSource.sha256"
    ) {
      return { ...item, value: options.cadSourceSha256 };
    }
    return item;
  });
  const caseDigest = parseSensitivityStudyDecisionParameters(
    compiledReview.decisionParameters,
  ).caseDigest;

  const live = options.omitOffer ? compiled : await signedCatalogOfferFixture({
    extraOffer: options.extraOffer,
    truncatedOffer: options.truncatedOffer,
    admissionSource: options.admissionSource,
    emptyInputManifest: options.emptyInputManifest,
  });
  let snapshot = options.omitOffer
    ? snapshotWithoutOffers(compiled.snapshot)
    : live.snapshot;
  if (options.admissionTool) {
    snapshot = snapshotWithAdmissionTool(snapshot, options.admissionTool);
  }
  if (options.siblingCaseDigest) {
    snapshot = snapshotWithSiblingCase(snapshot, options.siblingCaseDigest);
  }

  const reviewBasis = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
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
    schemaVersion: "4.0",
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
      activityId: `activity:${WORK_ID}`,
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
  const snapshots = new MemorySnapshots(snapshot);
  const captures = new MemoryCaptures();
  const admissions = new RecordingAdmissions(live.admissions);
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
    project,
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
      catalog: REAL_CATALOG,
      ...(options.omitReaders ? {} : {
        catalogOffers: live.catalogOffers,
        proofCaptures: live.proofCaptures,
      }),
    }),
  };
}

function emptyProject(snapshot: ThreadSnapshot): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r12`,
    revision: 12,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Desk Lamp",
      subjectId: snapshot.subject.id,
      objective: { title: "Study", statement: "Seal the sensitivity study." },
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
  } as EngineeringProjectSnapshot;
}

function snapshotWithoutOffers(snapshot: ThreadSnapshot): ThreadSnapshot {
  const artifacts = snapshot.artifacts.filter((item) =>
    !item.id.startsWith("sensitivity-catalog-offer-")
  );
  return validateThreadSnapshot({
    ...snapshot,
    artifacts,
    changeSet: {
      ...snapshot.changeSet,
      changes: snapshot.changeSet.changes.filter((change) =>
        !change.target.id.startsWith("sensitivity-catalog-offer-")
      ),
    },
    provenance: snapshot.provenance.filter((item) =>
      !("id" in item.to && item.to.id.startsWith("sensitivity-catalog-offer-"))
    ),
  });
}

function snapshotWithSiblingCase(
  snapshot: ThreadSnapshot,
  digest: string,
): ThreadSnapshot {
  const fingerprint = { algorithm: "sha256" as const, digest };
  const sibling = {
    id: `sensitivity-case-${digest}`,
    name: "Sensitivity study case sibling",
    kind: "document" as const,
    version: digest,
    fingerprint,
    uri: `${SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX}${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "analyze.seal-sensitivity-study@1",
      runId: "run.sibling-seal",
    },
    inputArtifactIds: [] as string[],
    freshness: {
      status: "fresh" as const,
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
  };
  return validateThreadSnapshot({
    ...snapshot,
    artifacts: [...snapshot.artifacts, sibling],
    changeSet: {
      ...snapshot.changeSet,
      changes: [...snapshot.changeSet.changes, {
        id: `change.${sibling.id}`,
        kind: "created" as const,
        target: { kind: "artifact" as const, id: sibling.id },
        summary: "Seal the reviewed FEA sensitivity study case: captured sibling.",
        afterFingerprint: fingerprint,
      }],
    },
    provenance: [...snapshot.provenance, {
      id: `provenance.${sibling.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: `change.${sibling.id}` },
      to: { kind: "artifact" as const, id: sibling.id },
      rationale: "The applied change introduced the sibling sensitivity case.",
    }],
  });
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

class RecordingAdmissions {
  readonly reads: unknown[] = [];
  constructor(
    private readonly inner: {
      read(
        request: unknown,
      ): Promise<ReopenedTechnicalCompilationAdmission | undefined>;
    },
  ) {}
  read(request: unknown) {
    this.reads.push(request);
    return this.inner.read(request);
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
