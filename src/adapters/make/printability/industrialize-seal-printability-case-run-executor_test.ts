import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { validatePrintabilityCheckCase } from "../../../domain/make/printability/printability-case.ts";
import { encodePrintabilityDecisionParameters } from "../../../domain/make/printability/printability-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  IndustrializeSealPrintabilityCaseRunExecutor,
  PRINTABILITY_CASE_CAPTURE_URI_PREFIX,
} from "./industrialize-seal-printability-case-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.printability-seal";
const WORK_ID = "work.printability-seal";
const DECISION_ID = "decision.printability-seal";
const APPROVAL_ID = "approval.printability-seal";
const COMMAND_ID = "command.printability-seal";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

function caseJson() {
  return {
    schemaVersion: "printability-check-case/1.0",
    id: "reviewed-printability-v1",
    revision: 1,
    scope: "FDM printability check for the isolated component.",
    evidenceBoundary: "Observations only; not a verdict or certification.",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    target: { componentKey: "support-bracket" },
    thresholds: {
      minWallThicknessMm: { value: 1.2, unit: "mm" },
      maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
      maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
    },
    meshSizeMm: { value: 2.0, unit: "mm" },
    buildDirection: [0, 0, 1],
    provider: {
      build123dTool: "build123d_export",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: [
      "Thresholds are provisional FDM candidate values.",
      "This check covers only min wall thickness and max overhang angle.",
    ],
    provenance: {
      status: "provisional",
      note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
    },
  };
}

Deno.test(
  "industrialize.seal-printability-case@1 publishes a document and never calls a provider",
  async () => {
    const fixture = await createFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(project.agentRuns[0]?.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(
      project.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "industrialize.seal-printability-case@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(sealed?.[0]?.kind, "document");
    assertEquals(
      sealed?.[0]?.uri?.startsWith(PRINTABILITY_CASE_CAPTURE_URI_PREFIX),
      true,
    );
    assertEquals(snapshot?.observations.length, 0);
    assertEquals(snapshot?.evaluations.length, 0);
    assertEquals(snapshot?.violations.length, 0);
  },
);

Deno.test("an unknown printability catalog id is refused", async () => {
  const fixture = await createFixture({ caseId: "unknown-case" });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "not in the server-side catalog",
  );
});

Deno.test("a signed printability digest that diverges from the catalog is refused", async () => {
  const fixture = await createFixture({ digestOverride: "f".repeat(64) });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "digest divergence",
  );
});

Deno.test("a human origin is refused before any store access", async () => {
  const executor = new IndustrializeSealPrintabilityCaseRunExecutor({
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
  readonly caseId?: string;
  readonly digestOverride?: string;
} = {}) {
  const printabilityCase = validatePrintabilityCheckCase({
    ...caseJson(),
    id: options.caseId ?? "reviewed-printability-v1",
  });
  const caseDigest = options.digestOverride ??
    (await sha256Fingerprint(printabilityCase)).digest;
  const parameters = encodePrintabilityDecisionParameters(caseDigest, printabilityCase);
  const caseText = JSON.stringify(printabilityCase);
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.printability.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Printability fixture",
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
    id: "industrialize.seal-printability-case",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const summary = "Seal the reviewed printability case.";
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
      name: "Printability fixture",
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
      title: "Seal printability case",
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
      summary: "Seal printability case.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.industrialize",
      title: "Approve printability seal",
      question: "Seal the exact printability case?",
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
    executor: new IndustrializeSealPrintabilityCaseRunExecutor({
      projects,
      commands,
      snapshots,
      captures: captures as never,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      caseSources: new Map([[
        "reviewed-printability-v1",
        "catalog/reviewed-printability-v1.json",
      ]]),
      readTextFile: (path) => {
        if (path.endsWith("reviewed-printability-v1.json")) {
          return Promise.resolve(caseText);
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
    return `${PRINTABILITY_CASE_CAPTURE_URI_PREFIX}${fingerprint.digest}`;
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
