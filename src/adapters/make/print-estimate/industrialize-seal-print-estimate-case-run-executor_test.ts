import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type FailRunCommand,
  type RunCommand,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { validatePrintEstimateCase } from "../../../domain/make/print-estimate/print-estimate-case.ts";
import { encodePrintEstimateDecisionParameters } from "../../../domain/make/print-estimate/print-estimate-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  IndustrializeSealPrintEstimateCaseRunExecutor,
  PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX,
} from "./industrialize-seal-print-estimate-case-run-executor.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.print-estimate-seal";
const WORK_ID = "work.print-estimate-seal";
const DECISION_ID = "decision.print-estimate-seal";
const APPROVAL_ID = "approval.print-estimate-seal";
const COMMAND_ID = "command.print-estimate-seal";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

function caseJson() {
  return {
    schemaVersion: "print-estimate-case/1.0",
    id: "reviewed-fff-estimate-v1",
    revision: 1,
    scope: "FFF print-time-and-material estimate for the isolated component.",
    evidenceBoundary: "Observations only; not a cost quote or verdict.",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    target: { componentKey: "support-bracket" },
    profile: {
      repoPath: "config/print-estimate-cases/reviewed-fff-0.2-pla.ini",
      exportName: "reviewed-fff-0.2-pla",
      sha256: "a".repeat(64),
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: [
      "Profile parameters are provisional engineering candidates.",
      "gcode_sha256 is an audit reference, not a deterministic attestation.",
    ],
    provenance: {
      status: "provisional",
      note: "Profile parameters are reviewed candidates, not supplier data.",
    },
  };
}

Deno.test(
  "industrialize.seal-print-estimate-case@1 publishes a document and never calls a provider",
  async () => {
    const fixture = await createFixture();
    const project = await fixture.executor.execute(AGENT, fixture.command);
    assertEquals(project.agentRuns[0]?.status, "completed");
    const snapshot = await fixture.snapshots.getFresh(
      project.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const sealed = snapshot?.artifacts.filter((item) =>
      item.producer.tool === "industrialize.seal-print-estimate-case@1"
    );
    assertEquals(sealed?.length, 1);
    assertEquals(
      sealed?.[0]?.uri?.startsWith(PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX),
      true,
    );
    assertEquals(snapshot?.observations.length, 0);
  },
);

Deno.test("an unknown print-estimate catalog id is refused", async () => {
  const fixture = await createFixture({ caseId: "unknown-case" });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "not in the server-side catalog",
  );
});

Deno.test("a signed print-estimate digest that diverges from the catalog is refused", async () => {
  const fixture = await createFixture({ digestOverride: "f".repeat(64) });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "digest divergence",
  );
});

async function createFixture(options: {
  readonly caseId?: string;
  readonly digestOverride?: string;
} = {}) {
  const printEstimateCase = validatePrintEstimateCase({
    ...caseJson(),
    id: options.caseId ?? "reviewed-fff-estimate-v1",
  });
  const caseDigest = options.digestOverride ??
    (await sha256Fingerprint(printEstimateCase)).digest;
  const parameters = encodePrintEstimateDecisionParameters(
    caseDigest,
    printEstimateCase,
  );
  const caseText = JSON.stringify(printEstimateCase);
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.print-estimate.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Print-estimate fixture",
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
    id: "industrialize.seal-print-estimate-case",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const summary = "Seal the reviewed print-estimate case.";
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
      name: "Print-estimate fixture",
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
      title: "Seal print-estimate case",
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
      summary: "Seal print-estimate case.",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION_ID,
      phaseId: "phase.industrialize",
      title: "Approve print-estimate seal",
      question: "Seal the exact print-estimate case?",
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
    executor: new IndustrializeSealPrintEstimateCaseRunExecutor({
      projects,
      commands,
      snapshots,
      captures: captures as never,
      lease: { withLease: (_projectId, _scope, operation) => operation() },
      caseSources: new Map([[
        "reviewed-fff-estimate-v1",
        "catalog/reviewed-fff-estimate-v1.json",
      ]]),
      readTextFile: (path) => {
        if (path.endsWith("reviewed-fff-estimate-v1.json")) {
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
    return `${PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX}${fingerprint.digest}`;
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
  failRun(_origin: typeof AGENT, _command: FailRunCommand) {
    (this.project.agentRuns[0] as { status: string }).status = "failed";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
