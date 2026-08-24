import { assertEquals, assertRejects } from "@std/assert";
import { FileEngineeringProjectRevisionStore } from "../../adapters/shared/stores/engineering-project-store.ts";
import {
  BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
} from "../../adapters/shared/cas/file-capture-store.ts";
import { BriefSourceAnalysisCaptureService } from "../../adapters/compile/captures/brief-source-analysis-capture.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "../../adapters/compile/source/project-brief-source-analyzer.ts";
import { FixedSourceAnalysisFrontendRegistry } from "../../domain/compile/source/source-analysis-frontend-registry.ts";
import { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import {
  fingerprintSourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../domain/compile/source/source-analysis.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./registry.ts";
import {
  APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA,
  materializeApprovedBriefBaseline,
} from "./approved-brief-baseline.ts";

Deno.test(
  "approved-brief baseline capture schema is the current 1.1 identity",
  () => {
    assertEquals(
      APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA,
      "approved-brief-baseline-capture/1.1",
    );
  },
);

Deno.test(
  "materializeApprovedBriefBaseline emits only the current capture with required analysis",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "approved-brief-materialize-",
    });
    try {
      const queued = await queueApprovedBriefProject(root);
      const reference = await queued.briefSourceAnalysis.capture({
        brief: queued.approvedProject.framing!.currentBrief!,
      });
      const analysisText = await queued.sourceAnalysisCaptures.read(
        reference.analysisFingerprint,
      );
      if (analysisText === undefined) {
        throw new Error("analysis is missing in test");
      }
      const materialized = await materializeApprovedBriefBaseline({
        project: queued.project,
        approvedProject: queued.approvedProject,
        runId: "run:baseline",
        capturedAt: "2026-08-03T09:00:01.000Z",
        briefSourceAnalysis: {
          reference,
          bundle: validateSourceAnalysisBundle(JSON.parse(analysisText)),
        },
      });
      assertEquals(
        materialized.capture.schemaVersion,
        APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA,
      );
      assertEquals(
        materialized.capture.briefSourceAnalysis.sourceId,
        reference.sourceId,
      );
      assertEquals(
        materialized.capture.briefSourceAnalysis.analysisFingerprint,
        reference.analysisFingerprint,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test(
  "materializeApprovedBriefBaseline rejects a source fingerprint that is not the approved brief",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "approved-brief-materialize-",
    });
    try {
      const queued = await queueApprovedBriefProject(root);
      const reference = await queued.briefSourceAnalysis.capture({
        brief: queued.approvedProject.framing!.currentBrief!,
      });
      const analysisText = await queued.sourceAnalysisCaptures.read(
        reference.analysisFingerprint,
      );
      if (analysisText === undefined) {
        throw new Error("analysis is missing in test");
      }
      const alteredFingerprint = {
        algorithm: "sha256" as const,
        digest: "b".repeat(64),
      };
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
            project: queued.project,
            approvedProject: queued.approvedProject,
            runId: "run:baseline",
            capturedAt: "2026-08-03T09:00:01.000Z",
            briefSourceAnalysis: {
              reference: alteredReference,
              bundle: alteredBundle,
            },
          }),
        Error,
        "source fingerprint does not name the exact canonical approved brief bytes",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function queueApprovedBriefProject(root: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${root}/projects`);
  const briefSourceCaptures = new FileCaptureStore({
    ...BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
    directory: `${root}/brief-source-captures`,
  });
  const sourceAnalysisCaptures = new FileCaptureStore({
    ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
    directory: `${root}/source-analysis-captures`,
  });
  const frontends = new FixedSourceAnalysisFrontendRegistry([{
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
  const approvedProject = await projects.getRevision(
    project.plan!.basis.projectId,
    project.plan!.basis.projectRevision,
  );
  if (!approvedProject) throw new Error("approved project is missing in test");
  return {
    project,
    approvedProject,
    sourceAnalysisCaptures,
    briefSourceAnalysis: new BriefSourceAnalysisCaptureService({
      sourceCaptures: briefSourceCaptures,
      analysisCaptures: sourceAnalysisCaptures,
      frontends,
      analyzer: {
        id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
        version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
      },
    }),
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
