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
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import type { EngineeringApprovedBriefBasis } from "../../domain/project/engineering-project.ts";

Deno.test(
  "initial baseline validator rereads the exact 1.1 capture and required analysis",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "approved-brief-validator-" });
    try {
      const harness = await executeApprovedBriefBaseline(root);
      await harness.validator.validateInitial(
        harness.runId,
        harness.basis,
        harness.operation,
        harness.resultReference,
        harness.evidenceRefs,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test(
  "initial baseline validator fails closed when the documentary capture is absent",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "approved-brief-validator-" });
    try {
      const harness = await executeApprovedBriefBaseline(root);
      await Deno.remove(harness.captures.pathFor(harness.documentFingerprint));
      await assertRejects(
        () =>
          harness.validator.validateInitial(
            harness.runId,
            harness.basis,
            harness.operation,
            harness.resultReference,
            harness.evidenceRefs,
          ),
        EngineeringProjectCommandError,
        "is not durably readable",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test(
  "initial baseline validator fails closed when the sealed brief analysis is absent",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "approved-brief-validator-" });
    try {
      const harness = await executeApprovedBriefBaseline(root);
      const captureText = await harness.captures.read(
        harness.documentFingerprint,
      );
      if (captureText === undefined) throw new Error("capture is missing in test");
      const capture = JSON.parse(captureText);
      await Deno.remove(
        harness.sourceAnalysisCaptures.pathFor(
          capture.briefSourceAnalysis.analysisFingerprint,
        ),
      );
      await assertRejects(
        () =>
          harness.validator.validateInitial(
            harness.runId,
            harness.basis,
            harness.operation,
            harness.resultReference,
            harness.evidenceRefs,
          ),
        EngineeringProjectCommandError,
        "Brief source analysis is invalid",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test(
  "initial baseline validator fails closed when the sealed brief analysis is corrupted",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "approved-brief-validator-" });
    try {
      const harness = await executeApprovedBriefBaseline(root);
      const captureText = await harness.captures.read(
        harness.documentFingerprint,
      );
      if (captureText === undefined) throw new Error("capture is missing in test");
      const capture = JSON.parse(captureText);
      const analysisPath = harness.sourceAnalysisCaptures.pathFor(
        capture.briefSourceAnalysis.analysisFingerprint,
      );
      await Deno.writeTextFile(analysisPath, '{"corrupted":true}');
      await assertRejects(
        () =>
          harness.validator.validateInitial(
            harness.runId,
            harness.basis,
            harness.operation,
            harness.resultReference,
            harness.evidenceRefs,
          ),
        EngineeringProjectCommandError,
        "Brief source analysis is invalid",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function executeApprovedBriefBaseline(root: string) {
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
  const validator = new ExactInitialBaselineEvidenceValidator(
    snapshots,
    captures,
    {
      sourceCaptures: briefSourceCaptures,
      analysisCaptures: sourceAnalysisCaptures,
      frontends: briefSourceAnalysisFrontends,
    },
  );
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
    validator,
  );
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await briefs.startProject(agent, {
    commandId: "start",
    projectId: "generic-product-v1",
    projectName: "Generic Industrial Product",
    issuedAt: "2026-08-03T08:59:00.000Z",
    intent: "Build a reviewable industrial product.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
  project = await briefs.proposeBrief(agent, {
    ...context(project.revision, "propose-brief"),
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
  project = await briefs.approveBrief(human, {
    ...context(project.revision, "approve-brief"),
    briefSnapshotId: proposal.id,
    briefRevision: proposal.revision,
    rationale: "Approved for initial engineering.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  project = await commands.publishPlan(agent, {
    ...context(project.revision, "publish-plan"),
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
    ...context(project.revision, "queue-baseline"),
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
    ...context(project.revision, "execute-baseline"),
    runId: "run:baseline",
  });
  const run = project.agentRuns[0]!;
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!run.resultSnapshot || !workItem?.operation) {
    throw new Error("completed baseline is missing in test");
  }
  assertEquals(run.status, "completed");
  return {
    validator,
    captures,
    sourceAnalysisCaptures,
    runId: run.id,
    basis: project.plan!.basis as EngineeringApprovedBriefBasis,
    operation: workItem.operation,
    resultReference: run.resultSnapshot,
    evidenceRefs: run.evidenceRefs,
    documentFingerprint: (await snapshots.get(run.resultSnapshot.snapshotId))!
      .artifacts[0]!.fingerprint,
  };
}

function context(expectedRevision: number, commandId: string) {
  return {
    commandId,
    projectId: "generic-product-v1",
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}
