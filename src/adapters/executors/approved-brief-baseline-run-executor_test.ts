import { assertEquals } from "@std/assert";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../captures/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { EngineeringProjectCommandService } from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";

Deno.test("approved in-project brief becomes the first durable documentary baseline", async () => {
  const root = await Deno.makeTempDir({ prefix: "approved-brief-baseline-" });
  const projects = new FileEngineeringProjectRevisionStore(`${root}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${root}/captures`,
  });
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
      .toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  const commands = new EngineeringProjectCommandService(
    projects,
    undefined,
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, captures),
  );
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };

  try {
    let project = await briefs.startProject(agent, {
      commandId: "start",
      projectId: "coffee-machine-v3",
      projectName: "Coffee Machine CM-01",
      issuedAt: "2026-08-03T08:59:00.000Z",
      intent: "Build a reviewable coffee machine.",
      intentSource: { kind: "human", reference: "conversation:turn-1" },
    });
    project = await briefs.proposeBrief(agent, {
      ...context("propose-brief", project.revision),
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Prepare a reviewable coffee machine design.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Brew coffee safely under the intended operating conditions.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement:
          "Demonstrate the approved baseline before technical evidence is added.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }],
    });
    const proposal = project.framing!.proposedBrief!;
    const review = project.framing!.proposalReview!;
    project = await briefs.approveBrief(human, {
      ...context("approve-brief", project.revision),
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      rationale: "Approved for initial engineering.",
      inputFingerprint: review.inputFingerprint,
    });
    project = await commands.publishPlan(agent, {
      ...context("publish-plan", project.revision),
      startingPoint: "idea-or-spec",
      phases: [{
        id: "baseline",
        name: "Baseline",
        description: "Record approved project intent.",
      }],
      workItems: [{
        id: "record-brief",
        phaseId: "baseline",
        owner: "agent",
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: "baseline.from-approved-brief",
          version: "1",
          bindings: [{
            name: "approvedBrief",
            source: { kind: "approved-brief" },
          }],
        },
      }],
      requiredDecisions: [],
    });
    project = await commands.queueRun(agent, {
      ...context("queue-baseline", project.revision),
      runId: "run:baseline",
      workItemId: "record-brief",
      summary: "Record the canonical project brief.",
      basis: project.plan!.basis,
    });
    const executor = new ApprovedBriefBaselineRunExecutor({
      projects,
      commands,
      captures,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      now,
    });
    project = await executor.execute(agent, {
      ...context("execute-baseline", project.revision),
      runId: "run:baseline",
    });

    assertEquals(project.agentRuns[0]?.status, "completed");
    assertEquals(project.threadSnapshots.length, 1);
    const snapshot = await snapshots.get(project.threadSnapshots[0]!.snapshotId);
    assertEquals(snapshot?.artifacts[0]?.producer.tool, "baseline_from_approved_brief");
    assertEquals(
      snapshot?.artifacts[0]?.name,
      "Approved project brief documentary baseline (pre-technical)",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "coffee-machine-v3",
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}
