import { assertEquals, assertRejects } from "@std/assert";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import { BriefSourceAnalysisCaptureService } from "../compile/captures/brief-source-analysis-capture.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "../compile/source/project-brief-source-analyzer.ts";
import { FixedSourceAnalysisFrontendRegistry } from "../../domain/compile/source/source-analysis-frontend-registry.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { ExactInitialBaselineEvidenceValidator } from "./engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  fingerprintSourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../domain/compile/source/source-analysis.ts";
import {
  APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA,
  materializeApprovedBriefBaseline,
} from "../../orchestration/operations/approved-brief-baseline.ts";

Deno.test("approved in-project brief becomes the first durable documentary baseline", async () => {
  const root = await Deno.makeTempDir({ prefix: "approved-brief-baseline-" });
  const projects = new FileEngineeringProjectRevisionStore(`${root}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${root}/captures`,
  });
  const briefSourceCaptures = new FileCaptureStore({
    ...BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
    directory: `${root}/brief-source-captures`,
  });
  const sourceAnalysisCaptures = new FileCaptureStore({
    ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
    directory: `${root}/source-analysis-captures`,
  });
  const briefSourceAnalysisFrontends = new FixedSourceAnalysisFrontendRegistry([{
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
    frontend: new ProjectBriefSourceAnalyzer(),
  }]);
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
    new ExactInitialBaselineEvidenceValidator(snapshots, captures, {
      sourceCaptures: briefSourceCaptures,
      analysisCaptures: sourceAnalysisCaptures,
      frontends: briefSourceAnalysisFrontends,
    }),
  );
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };

  try {
    let project = await briefs.startProject(agent, {
      commandId: "start",
      projectId: "generic-product-v1",
      projectName: "Generic Industrial Product",
      issuedAt: "2026-08-03T08:59:00.000Z",
      intent: "Build a reviewable industrial product.",
      intentSource: { kind: "human", reference: "conversation:turn-1" },
    });
    project = await briefs.proposeBrief(agent, {
      ...context("propose-brief", project.revision),
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Prepare a reviewable industrial product design.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Operate safely under the intended operating conditions.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement:
          "Demonstrate the approved baseline before technical evidence is added.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        dependsOnItemIds: ["objective"],
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
    const briefSourceAnalysis = new BriefSourceAnalysisCaptureService({
      sourceCaptures: briefSourceCaptures,
      analysisCaptures: sourceAnalysisCaptures,
      frontends: briefSourceAnalysisFrontends,
      analyzer: {
        id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
        version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
      },
    });
    const approvedProject = await projects.getRevision(
      project.plan!.basis.projectId,
      project.plan!.basis.projectRevision,
    );
    if (!approvedProject) throw new Error("approved project is missing in test");
    const reference = await briefSourceAnalysis.capture({
      brief: approvedProject.framing!.currentBrief!,
    });
    const analysisText = await sourceAnalysisCaptures.read(
      reference.analysisFingerprint,
    );
    if (analysisText === undefined) throw new Error("analysis is missing in test");
    const alteredFingerprint = { algorithm: "sha256" as const, digest: "b".repeat(64) };
    const alteredBundle = validateSourceAnalysisBundle({
      ...JSON.parse(analysisText),
      source: {
        ...JSON.parse(analysisText).source,
        fingerprint: alteredFingerprint,
      },
    });
    const alteredReference = {
      ...reference,
      sourceFingerprint: alteredFingerprint,
      analysisFingerprint: await fingerprintSourceAnalysisBundle(alteredBundle),
    };
    await assertRejects(
      () =>
        materializeApprovedBriefBaseline({
          project,
          approvedProject,
          runId: "run:baseline",
          capturedAt: "2026-08-03T09:00:01.000Z",
          briefSourceAnalysis: { reference: alteredReference, bundle: alteredBundle },
        }),
      Error,
      "source fingerprint does not name the exact canonical approved brief bytes",
    );
    const executor = new ApprovedBriefBaselineRunExecutor({
      projects,
      commands,
      captures,
      briefSourceAnalysis,
      briefSourceCaptures,
      sourceAnalysisCaptures,
      briefSourceAnalysisFrontends,
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
    assertEquals(snapshot?.schemaVersion, "1.1");
    assertEquals(snapshot?.analysisGraph?.relations.length, 1);
    const captureText = await captures.read(snapshot!.artifacts[0]!.fingerprint);
    if (captureText === undefined) throw new Error("capture is missing in test");
    const capture = JSON.parse(captureText);
    assertEquals(capture.schemaVersion, APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA);
    assertEquals(typeof capture.briefSourceAnalysis, "object");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "generic-product-v1",
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}
