import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  DFM_CHECK_CASE_SCHEMA,
  validateDfmCheckCase,
} from "../../../domain/make/dfm/dfm-case.ts";
import { encodeDfmDecisionParameters } from "../../../domain/make/dfm/dfm-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  DFM_CASE_CAPTURE_URI_PREFIX,
  IndustrializeSealDfmCaseRunExecutor,
} from "./industrialize-seal-dfm-case-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.dfm-seal";
const WORK_ID = "work.dfm-seal";
const DECISION_ID = "decision.dfm-seal";
const APPROVAL_ID = "approval.dfm-seal";
const COMMAND_ID = "command.dfm-seal";
const GEOMETRY_ID = "geometry-step-support-bracket";
const GEOMETRY_SHA256 =
  "9273149a5203a13ef3b14f7e70062e76ee106eaaf5ba474e98e1cd9116cdc270";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

function caseJson(sha256 = GEOMETRY_SHA256) {
  return {
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id: "reviewed-dfm-v1",
    revision: 1,
    scope: "Measured DFM checks for the isolated component.",
    evidenceBoundary: "Measured verdicts against the sealed case.",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    target: {
      componentKey: "support-bracket",
      artifactUri: `thread-artifact://${PROJECT_ID}/${GEOMETRY_ID}`,
      sha256,
      mediaType: "model/step",
    },
    buildVolumeMm: {
      x: { value: 250, unit: "mm" },
      y: { value: 210, unit: "mm" },
      z: { value: 200, unit: "mm" },
    },
    minThicknessMm: { value: 2, unit: "mm" },
    maxOverhangAngleDeg: { value: 45, unit: "deg" },
    meshSizeMm: { value: 2, unit: "mm" },
    buildDirection: [0, 0, 1],
    zMinFilter: {
      enabled: true,
      planeZMm: { value: -3, unit: "mm" },
      toleranceMm: { value: 0.1, unit: "mm" },
    },
    provider: {
      envelopeTool: "dfm_check_envelope",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
    provenance: {
      status: "provisional",
      note: "Limits copied from the archived mcp-dfm qualification call.",
    },
  };
}

Deno.test(
  "industrialize.seal-dfm-case@1 publishes a document and never calls a provider",
  async () => {
    const fixture = await createFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(project.agentRuns[0]?.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(
      project.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "industrialize.seal-dfm-case@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(sealed?.[0]?.uri?.startsWith(DFM_CASE_CAPTURE_URI_PREFIX), true);
    assertEquals(snapshot?.evaluations.length, 0);
    assertEquals(snapshot?.violations.length, 0);
  },
);

Deno.test("seal DFM case refuses a target SHA-256 that does not match the basis artefact", async () => {
  const fixture = await createFixture({
    signedSha256: "0".repeat(64),
    basisSha256: GEOMETRY_SHA256,
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "SHA-256 mismatch",
  );
});

Deno.test("seal DFM case refuses a missing attested STEP artefact", async () => {
  const fixture = await createFixture({ omitGeometry: true });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "absent from the basis snapshot",
  );
});

Deno.test("a human origin is refused before any store access", async () => {
  const executor = new IndustrializeSealDfmCaseRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
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
});

async function createFixture(options: {
  readonly signedSha256?: string;
  readonly basisSha256?: string;
  readonly omitGeometry?: boolean;
} = {}) {
  const signedSha256 = options.signedSha256 ?? GEOMETRY_SHA256;
  const basisSha256 = options.basisSha256 ?? signedSha256;
  const dfmCase = validateDfmCheckCase(caseJson(signedSha256));
  const caseDigest = (await sha256Fingerprint(dfmCase)).digest;
  const parameters = encodeDfmDecisionParameters(caseDigest, dfmCase);
  const geometryArtifact = {
    id: GEOMETRY_ID,
    name: "Canonical STEP",
    kind: "step" as const,
    version: basisSha256,
    fingerprint: { algorithm: "sha256" as const, digest: basisSha256 },
    uri: `/api/thread/assets/${basisSha256}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
  const artifacts = [
    {
      id: "artifact.brief",
      name: "Brief",
      kind: "document" as const,
      version: "1",
      fingerprint: { algorithm: "sha256" as const, digest: "1".repeat(64) },
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [],
      freshness: fresh(AT),
    },
    ...(options.omitGeometry ? [] : [geometryArtifact]),
  ];
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.dfm.seal.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "DFM seal fixture",
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
        summary: "Created the brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts,
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
      rationale: "The applied change introduced the brief.",
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
    id: "industrialize.seal-dfm-case",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const summary = "Seal the reviewed DFM case.";
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
      name: "DFM seal fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Seal", statement: "Seal the case." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Seal the case.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.industrialize",
      title: "Seal DFM case",
      description: "Seal the reviewed case.",
      kind: "industrialize",
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
      summary: "Seal DFM case.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.industrialize",
      title: "Approve DFM seal",
      question: "Seal the exact DFM case?",
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
  const commands = new MemoryCommands(project);
  const projects: EngineeringProjectRevisionStore = {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  return {
    command: {
      commandId: COMMAND_ID,
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN_ID,
    },
    snapshots,
    executor: new IndustrializeSealDfmCaseRunExecutor({
      projects,
      commands,
      snapshots,
      captures: captures as never,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
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
  latest(_subjectId?: string) {
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
    return `${DFM_CASE_CAPTURE_URI_PREFIX}${fingerprint.digest}`;
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
