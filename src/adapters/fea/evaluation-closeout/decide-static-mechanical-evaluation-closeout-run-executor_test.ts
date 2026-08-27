import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  encodeStaticMechanicalEvaluationCloseoutAdmission,
} from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import {
  createCompletedStaticMechanicalCloseoutFixture,
  STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
  STATIC_MECHANICAL_CLOSEOUT_FIXTURE_HUMAN,
  type StaticMechanicalCloseoutFixture,
} from "../../../testing/static-mechanical-closeout-fixture.ts";
import {
  resolveStaticMechanicalCloseoutEvidence,
  staticMechanicalCloseoutAdmission,
} from "./static-mechanical-closeout-evidence-resolver.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
  DecideStaticMechanicalEvaluationCloseoutRunExecutor,
} from "./decide-static-mechanical-evaluation-closeout-run-executor.ts";

const COMMAND_AT = "2026-08-22T00:10:00.000Z";

Deno.test(
  "human-approved accept closeout is agent-dispatched, provider-free, and replays no duplicate successor",
  async () => {
    const fixture = await createCompletedStaticMechanicalCloseoutFixture();
    try {
      const queued = await queueCloseout(fixture, "accept");
      const captures = new CountingCloseoutCaptures(fixture);
      const executor = closeoutExecutor(fixture, captures);
      await assertRejects(
        () =>
          executor.execute(STATIC_MECHANICAL_CLOSEOUT_FIXTURE_HUMAN, queued.command),
        Error,
        "registered agent dispatcher",
      );
      assertEquals(captures.saves, 0);

      const completed = await executor.execute(
        STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
        queued.command,
      );
      const run = completed.agentRuns.find((candidate) =>
        candidate.id === queued.command.runId
      )!;
      const successor = await fixture.fea.snapshots.get(run.resultSnapshot!.snapshotId);
      assertEquals(run.status, "completed");
      assertEquals(successor?.previous, {
        snapshotId: fixture.basis.snapshotId,
        revision: fixture.basis.revision,
      });
      const documents = successor?.artifacts.filter((artifact) =>
        artifact.producer.tool === "decide.accept-evaluation-closeout@1"
      ) ?? [];
      assertEquals(documents.length, 1);
      assertEquals(documents[0]?.inputArtifactIds.length, 4);
      assertEquals(captures.saves, 1);
      assertEquals(fixture.counts.executionEvidenceReads > 0, true);
      assertEquals(fixture.counts.evaluationCaptureReads > 0, true);
      assertEquals("solver" in fixture.dependencies, false);
      assertEquals("syson" in fixture.dependencies, false);

      const replayed = await executor.execute(
        STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
        queued.command,
      );
      const replayedRun = replayed.agentRuns.find((candidate) =>
        candidate.id === queued.command.runId
      )!;
      assertEquals(replayedRun.resultSnapshot, run.resultSnapshot);
      assertEquals(captures.saves, 1);
      const replayedSnapshot = await fixture.fea.snapshots.get(
        replayedRun.resultSnapshot!.snapshotId,
      );
      assertEquals(
        replayedSnapshot?.artifacts.filter((artifact) =>
          artifact.producer.tool === "decide.accept-evaluation-closeout@1"
        ).length,
        1,
      );
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test("an agent cannot substitute a nonhuman closeout disposition", async () => {
  const fixture = await createCompletedStaticMechanicalCloseoutFixture();
  try {
    const queued = await queueCloseout(fixture, "accept");
    const captures = new CountingCloseoutCaptures(fixture);
    const nonhumanApprovalProjects = projectView(fixture, (project) => {
      const approval = project.approvals.find((candidate) =>
        candidate.decisionId === "decision-closeout-accept"
      ) as unknown as { decidedByOrigin?: string } | undefined;
      if (!approval) throw new Error("The closeout fixture approval is absent.");
      approval.decidedByOrigin = "agent";
    });
    const executor = closeoutExecutor(fixture, captures, nonhumanApprovalProjects);
    await assertRejects(
      () => executor.execute(STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT, queued.command),
      Error,
      "No exact human-approved",
    );
    assertEquals(captures.saves, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("completed closeout replay rejects a tampered result attachment instead of accepting it", async () => {
  const fixture = await createCompletedStaticMechanicalCloseoutFixture();
  try {
    const queued = await queueCloseout(fixture, "accept");
    const captures = new CountingCloseoutCaptures(fixture);
    const normal = closeoutExecutor(fixture, captures);
    await normal.execute(STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT, queued.command);
    const tamperedProjects = projectView(fixture, (project) => {
      const run = (project as unknown as {
        agentRuns: Array<{ id: string; resultSnapshot?: { snapshotId: string } }>;
      }).agentRuns.find((candidate) => candidate.id === queued.command.runId)!;
      run.resultSnapshot = { ...run.resultSnapshot!, snapshotId: "tampered-successor" };
    });
    const replay = closeoutExecutor(fixture, captures, tamperedProjects);
    await assertRejects(
      () => replay.execute(STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT, queued.command),
      Error,
      "direct Thread successor",
    );
    assertEquals(captures.saves, 1);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("completed closeout replay rejects a tampered durable capture", async () => {
  const fixture = await createCompletedStaticMechanicalCloseoutFixture();
  try {
    const queued = await queueCloseout(fixture, "accept");
    const captures = new CountingCloseoutCaptures(fixture);
    await closeoutExecutor(fixture, captures).execute(
      STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
      queued.command,
    );
    const tamperedReads = new CountingCloseoutCaptures(fixture, true);
    await assertRejects(
      () =>
        closeoutExecutor(fixture, tamperedReads).execute(
          STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
          queued.command,
        ),
      Error,
      "exact durable capture",
    );
    assertEquals(tamperedReads.saves, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("executor recross rejects a human-signed proof-limitation mismatch before capture", async () => {
  const fixture = await createCompletedStaticMechanicalCloseoutFixture();
  try {
    const queued = await queueCloseout(fixture, "accept", true);
    const captures = new CountingCloseoutCaptures(fixture);
    const executor = closeoutExecutor(fixture, captures);
    await assertRejects(
      () => executor.execute(STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT, queued.command),
      Error,
      "sealed proof limitations",
    );
    assertEquals(captures.saves, 0);
  } finally {
    await fixture.dispose();
  }
});

Deno.test("human-approved reject closeout remains a bounded provider-free consequence", async () => {
  const fixture = await createCompletedStaticMechanicalCloseoutFixture({
    status: "fail",
  });
  try {
    const queued = await queueCloseout(fixture, "reject");
    const captures = new CountingCloseoutCaptures(fixture);
    const completed = await closeoutExecutor(fixture, captures).execute(
      STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
      queued.command,
    );
    const run = completed.agentRuns.find((candidate) =>
      candidate.id === queued.command.runId
    )!;
    const successor = await fixture.fea.snapshots.get(run.resultSnapshot!.snapshotId);
    const closeout = successor?.artifacts.find((artifact) =>
      artifact.producer.tool === "decide.reject-evaluation-closeout@1"
    );
    assertEquals(closeout?.inputArtifactIds.length, 4);
    assertEquals(captures.saves, 1);
    assertEquals("solver" in fixture.dependencies, false);
    assertEquals("syson" in fixture.dependencies, false);
  } finally {
    await fixture.dispose();
  }
});

async function queueCloseout(
  fixture: StaticMechanicalCloseoutFixture,
  consequence: "accept" | "reject",
  tamperProofLimitations = false,
) {
  const resolved = await resolveStaticMechanicalCloseoutEvidence(fixture.dependencies, {
    project: fixture.project,
    basis: fixture.basis,
    snapshot: fixture.snapshot,
  });
  const admission = staticMechanicalCloseoutAdmission(resolved, consequence);
  let parameters = encodeStaticMechanicalEvaluationCloseoutAdmission(admission);
  if (tamperProofLimitations) {
    parameters = parameters.map((parameter) =>
      parameter.key === "evaluation.closeout.proofLimitations.proofScope"
        ? { ...parameter, value: "tampered-proof-scope" }
        : parameter
    );
  }
  const operation = consequence === "accept"
    ? DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION
    : DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION;
  const phaseId = `phase-closeout-${consequence}`;
  const workId = `work-closeout-${consequence}`;
  const decisionId = `decision-closeout-${consequence}`;
  const runId = `run-closeout-${consequence}`;
  const basis = {
    snapshotId: fixture.basis.snapshotId,
    revision: fixture.basis.revision,
    subjectId: fixture.basis.subjectId,
  };
  let project = await fixture.fea.projects.get(fixture.fea.projectId);
  if (!project) throw new Error("Closeout fixture project is unavailable.");
  project = await fixture.fea.commands.appendChange(
    STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
    {
      commandId: `fixture:closeout:${consequence}:append`,
      projectId: fixture.fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      baseSnapshot: basis,
      phases: [{
        id: phaseId,
        name: "Static mechanical closeout",
        description: "Record a human L5 consequence over exact FEA evidence.",
      }],
      workItems: [{
        id: workId,
        phaseId,
        owner: "human",
        dependsOnWorkItemIds: ["recorded-fea-item"],
        decisionIds: [decisionId],
        operation: {
          id: operation.id,
          version: operation.version,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      }],
      requiredDecisions: [{
        id: decisionId,
        phaseId,
        title: "Record static mechanical closeout",
        question: "Record the selected human closeout consequence?",
      }],
    },
  );
  project = await fixture.fea.commands.proposeDecision(
    STATIC_MECHANICAL_CLOSEOUT_FIXTURE_AGENT,
    {
      commandId: `fixture:closeout:${consequence}:propose`,
      projectId: fixture.fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      decisionId,
      baseSnapshot: basis,
      proposal: {
        summary: "Record the exact static-mechanical human closeout.",
        parameters,
      },
    },
  );
  const decision = project.decisions.find((candidate) => candidate.id === decisionId)!;
  project = await fixture.fea.commands.approveDecision(
    STATIC_MECHANICAL_CLOSEOUT_FIXTURE_HUMAN,
    {
      commandId: `fixture:closeout:${consequence}:approve`,
      projectId: fixture.fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      decisionId,
      rationale: "Human review of the exact static-mechanical evidence.",
      inputFingerprint: decision.inputFingerprint!,
    },
  );
  project = await fixture.fea.commands.queueRun(
    STATIC_MECHANICAL_CLOSEOUT_FIXTURE_HUMAN,
    {
      commandId: `fixture:closeout:${consequence}:queue`,
      projectId: fixture.fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      runId,
      workItemId: workId,
      summary: "Record the human static-mechanical L5 closeout.",
      basis: fixture.basis,
    },
  );
  return {
    admission,
    command: {
      commandId: `fixture:closeout:${consequence}:execute`,
      projectId: fixture.fea.projectId,
      expectedRevision: project.revision,
      issuedAt: COMMAND_AT,
      runId,
    },
  };
}

function closeoutExecutor(
  fixture: StaticMechanicalCloseoutFixture,
  captures: CountingCloseoutCaptures,
  projects: EngineeringProjectRevisionStore = fixture.fea.projects,
) {
  return new DecideStaticMechanicalEvaluationCloseoutRunExecutor({
    projects,
    commands: fixture.fea.commands,
    snapshots: fixture.fea.snapshots,
    ...fixture.dependencies,
    closeoutCaptures: captures,
    lease: { withLease: async (_projectId, _scope, operation) => await operation() },
  });
}

function projectView(
  fixture: StaticMechanicalCloseoutFixture,
  mutate: (project: EngineeringProjectSnapshot) => void,
): EngineeringProjectRevisionStore {
  return {
    get: async (projectId) => {
      const current = await fixture.fea.projects.get(projectId);
      if (!current) return undefined;
      const clone = structuredClone(current) as EngineeringProjectSnapshot;
      mutate(clone);
      return clone;
    },
    getRevision: (projectId, revision) =>
      fixture.fea.projects.getRevision(projectId, revision),
    createInitial: (snapshot) => fixture.fea.projects.createInitial(snapshot),
    commit: (snapshot, expectedRevision) =>
      fixture.fea.projects.commit(snapshot, expectedRevision),
  };
}

class CountingCloseoutCaptures {
  saves = 0;
  reads = 0;

  constructor(
    private readonly fixture: StaticMechanicalCloseoutFixture,
    private readonly tamperRead = false,
  ) {}

  async save(
    ...args: Parameters<StaticMechanicalCloseoutFixture["closeoutCaptures"]["save"]>
  ) {
    this.saves++;
    return await this.fixture.closeoutCaptures.save(...args);
  }

  async read(
    ...args: Parameters<StaticMechanicalCloseoutFixture["closeoutCaptures"]["read"]>
  ) {
    this.reads++;
    const text = await this.fixture.closeoutCaptures.read(...args);
    return this.tamperRead && text !== undefined ? `${text} ` : text;
  }

  uriFor(
    ...args: Parameters<StaticMechanicalCloseoutFixture["closeoutCaptures"]["uriFor"]>
  ) {
    return this.fixture.closeoutCaptures.uriFor(...args);
  }
}
