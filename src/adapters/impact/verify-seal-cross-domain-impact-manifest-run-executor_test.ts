import { assertEquals, assertRejects } from "@std/assert";
import type { ProjectCrossDomainImpactManifestSealReviewUseCase } from "../../application/ports/in/impact/project-cross-domain-impact-manifest-seal-review.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactManifestSealCaptureStore } from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import type {
  CompleteRunCommand,
  FailRunCommand,
  RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
  type CrossDomainImpactManifestSealAdmission,
  crossDomainImpactManifestUri,
  encodeCrossDomainImpactManifestSealAdmission,
} from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import type { CrossDomainImpactManifestSealCapture } from "../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type CrossDomainImpactThreadSnapshotStore,
  VerifySealCrossDomainImpactManifestRunExecutor,
} from "./verify-seal-cross-domain-impact-manifest-run-executor.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project.impact";
const SUBJECT = "subject.impact";
const RUN = "run.impact";
const WORK = "work.impact";
const DECISION = "decision.impact";
const APPROVAL = "approval.impact";
const AGENT = { kind: "agent" as const, actorId: "agent.impact" };

Deno.test("impact-manifest seal requires exact human MRTR, writes one documentary document, and replays idempotently without a solver", async () => {
  const fixture = await executorFixture();
  const first = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(first.agentRuns[0]!.status, "completed");
  const result = first.agentRuns[0]!.resultSnapshot!;
  const sealed = await fixture.snapshots.getFresh(result.snapshotId);
  const documents =
    sealed?.artifacts.filter((artifact) =>
      artifact.producer.tool === "verify.seal-cross-domain-impact-manifest@2"
    ) ?? [];
  assertEquals(documents.length, 1);
  const document = documents[0]!;
  assertEquals(document.inputArtifactIds, ["artifact.brief"]);
  const sealConsumptions = (sealed?.consumptions ?? []).filter((consumption) =>
    deterministicJson(consumption.consumer) === deterministicJson(document.producer)
  );
  assertEquals(sealConsumptions, [{
    id: `verify-seal-cross-domain-impact-manifest-${RUN}:consume:artifact.brief`,
    artifactId: "artifact.brief",
    consumer: document.producer,
    observedFingerprint: hash("1"),
    verifiedAt: AT,
    status: "verified",
  }]);
  assertEquals(sealed?.provenance.filter((link) => link.relation === "derived_from"), [{
    id: `verify-seal-cross-domain-impact-manifest-${RUN}:derived-from:artifact.brief`,
    relation: "derived_from",
    from: { kind: "artifact", id: document.id },
    to: { kind: "artifact", id: "artifact.brief" },
    rationale:
      "The sealed impact manifest recrossed this exact declared artifact identity.",
  }]);
  assertEquals(sealed?.provenance.filter((link) => link.relation === "uses"), [{
    id: `verify-seal-cross-domain-impact-manifest-${RUN}:uses:artifact.brief`,
    relation: "uses",
    from: { kind: "consumption", id: sealConsumptions[0]!.id },
    to: { kind: "artifact", id: "artifact.brief" },
    rationale: "The seal executor reread and fingerprint-attested the exact input.",
  }]);
  validateThreadSnapshot(sealed!);
  // This is the narrow X05/X06 documentary successor, not the later X08
  // impact-evaluation transition: it preserves every evaluative surface.
  assertEquals(sealed?.evaluations, fixture.basis.evaluations);
  assertEquals(sealed?.requirements, fixture.basis.requirements);
  assertEquals(sealed?.observations, fixture.basis.observations);
  assertEquals(sealed?.violations, fixture.basis.violations);
  assertEquals(sealed?.proposedActions, fixture.basis.proposedActions);
  assertEquals(first.workItems.length, 1);
  assertEquals(first.workItems[0]?.gateClaims, undefined);
  assertEquals(fixture.solverCalls, 0);
  const revision = first.revision;
  const replay = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(replay.revision, revision);
  assertEquals(fixture.snapshots.saves, 1);
  assertEquals(fixture.review.calls >= 2, true);
});

Deno.test("impact-manifest seal refuses a non-human or fingerprint-inexact MRTR approval", async () => {
  for (const mutation of ["origin", "fingerprint"] as const) {
    const fixture = await executorFixture();
    if (mutation === "origin") {
      (fixture.project.approvals[0] as { decidedByOrigin?: string }).decidedByOrigin =
        "agent";
    } else {
      (fixture.project.approvals[0] as { inputFingerprint?: ContentFingerprint })
        .inputFingerprint = hash("0");
    }
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      Error,
      "human-approved",
      mutation,
    );
    assertEquals(fixture.captures.saves, 0, mutation);
  }
});

async function executorFixture(): Promise<{
  readonly executor: VerifySealCrossDomainImpactManifestRunExecutor;
  readonly command: {
    commandId: string;
    projectId: string;
    expectedRevision: number;
    issuedAt: string;
    runId: string;
  };
  readonly project: MutableProject;
  readonly basis: ThreadSnapshot;
  readonly snapshots: MemorySnapshots;
  readonly captures: MemoryCaptures;
  readonly review: FixedReview;
  readonly solverCalls: number;
}> {
  const basis = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread.impact.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Impact subject",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes.impact.r1",
      name: "Initial impact basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Initial documentary brief.",
        afterFingerprint: hash("1"),
      }],
    },
    artifacts: [{
      id: "artifact.brief",
      name: "Brief",
      kind: "document",
      version: "1",
      fingerprint: hash("1"),
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [],
      freshness: fresh(),
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
      rationale: "Initial documentary brief.",
    }],
    proposedActions: [],
  });
  const basisFingerprint = await sha256Fingerprint(basis);
  const projectIdentity = {
    id: PROJECT,
    name: "Impact project",
    subjectId: SUBJECT,
    objective: { title: "Impact", statement: "Seal exact impact manifest." },
  };
  const admission = admissionFixture(basisFingerprint);
  const parameters = encodeCrossDomainImpactManifestSealAdmission(admission);
  const reviewBasis = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: SUBJECT,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    id: "verify.seal-cross-domain-impact-manifest",
    version: "2",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const summary = "Seal the exact cross-domain impact manifest.";
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary, parameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK,
    basis: runBasis,
    operation,
    approvedDecisions: [{ id: DECISION, inputFingerprint: decisionFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: "project.impact.r1",
    revision: 1,
    generatedAt: AT,
    project: projectIdentity,
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.impact",
      name: "Impact",
      order: 1,
      description: "Seal impact",
      workItemIds: [WORK],
      requiredDecisionIds: [DECISION],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK,
      phaseId: "phase.impact",
      title: "Seal impact",
      description: "Seal exact impact",
      kind: "review",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DECISION],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN,
      workItemId: WORK,
      status: "queued",
      summary: "Seal impact",
      queuedAt: AT,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: DECISION,
      phaseId: "phase.impact",
      title: "Approve impact",
      question: "Seal?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: [APPROVAL],
      proposal: {
        summary,
        parameters,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: APPROVAL,
      decisionId: DECISION,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: "human.impact",
      decidedByOrigin: "human",
      rationale: "Reviewed exact manifest.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  const snapshots = new MemorySnapshots(basis);
  const captures = new MemoryCaptures();
  const review = new FixedReview(admission, parameters);
  const commands = new MemoryCommands(project);
  const projects: Pick<EngineeringProjectRevisionStore, "get"> = {
    get: () => Promise.resolve(project),
  };
  return {
    executor: new VerifySealCrossDomainImpactManifestRunExecutor({
      projects,
      commands,
      snapshots,
      review,
      captures,
      lease: { withLease: (_projectId, _scope, work) => work() },
    }),
    command: {
      commandId: "command.impact",
      projectId: PROJECT,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN,
    },
    project,
    basis,
    snapshots,
    captures,
    review,
    solverCalls: 0,
  };
}

function admissionFixture(
  basisFingerprint: ContentFingerprint,
): CrossDomainImpactManifestSealAdmission {
  const reference = hash("e");
  return {
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
    manifest: {
      schemaVersion: "cross-domain-impact-manifest/2.0",
      id: "manifest.impact",
      revision: 1,
      fingerprint: hash("d"),
      reference,
      uri: crossDomainImpactManifestUri(reference),
    },
    project: { id: PROJECT, fingerprint: hash("a") },
    subject: { id: SUBJECT, fingerprint: hash("b") },
    basis: {
      snapshotId: "thread.impact.r1",
      revision: 1,
      fingerprint: basisFingerprint,
    },
    brief: {
      contractVersion: "2.0",
      id: "brief.impact",
      revision: 2,
      fingerprint: hash("c"),
      gates: [
        {
          gateItemId: "gate.electrical",
          kind: "success-criterion",
          branchId: "electrical",
          role: "satisfies",
          fingerprint: hash("1"),
          dependsOnItemIds: [],
        },
        {
          gateItemId: "gate.mechanical",
          kind: "success-criterion",
          branchId: "mechanical",
          role: "satisfies",
          fingerprint: hash("2"),
          dependsOnItemIds: [],
        },
        {
          gateItemId: "gate.thermal",
          kind: "success-criterion",
          branchId: "thermal",
          role: "contributes-to",
          fingerprint: hash("3"),
          dependsOnItemIds: [],
        },
      ],
    },
    sourceAnchors: [
      sourceAnchor(
        "anchor.brief",
        "brief",
        "change.brief",
        "artifact.brief",
        "1",
        "artifact",
      ),
      sourceAnchor(
        "anchor.brightness",
        "brightness",
        "change.brightness",
        "requirement.brightness",
        "2",
      ),
      sourceAnchor(
        "anchor.power",
        "electrical-power",
        "change.power",
        "requirement.power",
        "3",
      ),
    ],
    mechanicalEvidence: [],
  };
}

function sourceAnchor(
  id: string,
  changeKind: string,
  changeId: string,
  sourceId: string,
  digest: string,
  sourceKind: "artifact" | "requirement" = "requirement",
) {
  return {
    id,
    changeKind,
    role: "reviewed-change-source" as const,
    threadChange: {
      id: changeId,
      kind: "modified" as const,
      fingerprint: hash(digest),
    },
    source: { kind: sourceKind, id: sourceId, fingerprint: hash(digest) },
  };
}

class FixedReview implements ProjectCrossDomainImpactManifestSealReviewUseCase {
  calls = 0;
  constructor(
    readonly admission: CrossDomainImpactManifestSealAdmission,
    readonly parameters: ReturnType<
      typeof encodeCrossDomainImpactManifestSealAdmission
    >,
  ) {}
  execute() {
    this.calls += 1;
    return Promise.resolve({
      status: "resolved" as const,
      admission: this.admission,
      decisionParameters: this.parameters,
      diagnostics: [],
    });
  }
}

class MemorySnapshots implements CrossDomainImpactThreadSnapshotStore {
  readonly items = new Map<string, ThreadSnapshot>();
  saves = 0;
  constructor(basis: ThreadSnapshot) {
    this.items.set(basis.id, structuredClone(basis));
  }
  get(id: string) {
    const value = this.items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }
  getFresh(id: string) {
    return this.get(id);
  }
  latest(subjectId: string) {
    const values = [...this.items.values()].filter((item) =>
      item.subject.id === subjectId
    );
    return Promise.resolve(
      values.sort((left, right) => right.revision - left.revision)[0],
    );
  }
  save(snapshot: ThreadSnapshot) {
    const existing = this.items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(new Error("non-idempotent snapshot"));
    }
    if (!existing) {
      this.items.set(snapshot.id, structuredClone(snapshot));
      this.saves += 1;
    }
    return Promise.resolve();
  }
}

class MemoryCaptures implements CrossDomainImpactManifestSealCaptureStore {
  readonly items = new Map<string, CrossDomainImpactManifestSealCapture>();
  saves = 0;
  async save(capture: CrossDomainImpactManifestSealCapture) {
    const fingerprint = await sha256Fingerprint(capture);
    const existing = this.items.get(fingerprint.digest);
    if (existing && deterministicJson(existing) !== deterministicJson(capture)) {
      throw new Error("non-idempotent capture");
    }
    if (!existing) {
      this.items.set(fingerprint.digest, structuredClone(capture));
      this.saves += 1;
    }
    return {
      fingerprint,
      uri:
        `casys://cross-domain-impact-manifest-seal-capture/sha256/${fingerprint.digest}`,
    };
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.items.get(fingerprint.digest));
  }
}

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "queued") {
      run.status = "running";
      run.startedAt = AT;
      run.claimedAt = AT;
      run.claimedBy = { id: origin.actorId, origin: origin.kind };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    (this.project.agentRuns[0] as MutableRun).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  async completeRun(origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns[0] as MutableRun;
    if (run.status === "completed") return this.project;
    run.status = "completed";
    run.completedAt = AT;
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const work = this.project.workItems[0] as MutableWork;
    work.status = "completed";
    work.evidenceRefs = [...command.evidenceRefs];
    (this.project.phases[0] as MutablePhase).evidenceRefs = [...command.evidenceRefs];
    this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "agent-run.complete",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint: await sha256Fingerprint({ command }),
      resultingSnapshot: {
        snapshotId: `project.impact.r${this.project.revision}`,
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

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  phases: Array<EngineeringProjectSnapshot["phases"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  approvals: Array<EngineeringProjectSnapshot["approvals"][number]>;
  commandReceipts: Array<
    NonNullable<EngineeringProjectSnapshot["commandReceipts"]>[number]
  >;
};
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

function hash(character: string): ContentFingerprint {
  return { algorithm: "sha256", digest: character.repeat(64) };
}
function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
