/** Provider-free composition for draft capture and the X05–X09 recross and X11 preservation. */

import type { ProjectCrossDomainImpactManifestCaptureUseCase } from "../../application/ports/in/impact/project-cross-domain-impact-manifest-capture.ts";
import type { CrossDomainImpactManifestStore } from "../../application/ports/out/impact/cross-domain-impact-manifest-store.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectCrossDomainImpactManifestCapture } from "../../application/use-cases/impact/prepare-project-cross-domain-impact-manifest-capture.ts";
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { PrepareProjectCrossDomainImpactManifestSealReview } from "../../application/use-cases/impact/prepare-project-cross-domain-impact-manifest-seal-review.ts";
import { PrepareCrossDomainImpactDecision } from "../../application/use-cases/impact/prepare-cross-domain-impact-decision.ts";
import { PrepareCrossDomainImpactEvaluation } from "../../application/use-cases/impact/prepare-cross-domain-impact-evaluation.ts";
import { PrepareMechanicalPreservation } from "../../application/use-cases/impact/prepare-mechanical-preservation.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import {
  EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileCrossDomainImpactManifestSealCaptureStore } from "./file-cross-domain-impact-manifest-seal-capture-store.ts";
import { FileCrossDomainImpactEvaluationCaptureStore } from "./file-cross-domain-impact-evaluation-capture-store.ts";
import { FileCrossDomainImpactDecisionCaptureStore } from "./file-cross-domain-impact-decision-capture-store.ts";
import { FileMechanicalPreservationCaptureStore } from "./file-cross-domain-impact-mechanical-preservation-capture-store.ts";
import { FileMechanicalPreservationCloseoutReader } from "./file-mechanical-preservation-closeout-reader.ts";
import { FileCrossDomainImpactManifestStore } from "./file-cross-domain-impact-manifest-store.ts";
import { ProjectCrossDomainImpactBriefGateReader } from "./project-cross-domain-impact-brief-gate-reader.ts";
import { ProjectCrossDomainImpactThreadLineageReader } from "./project-cross-domain-impact-thread-lineage-reader.ts";
import { VerifySealCrossDomainImpactManifestRunExecutor } from "./verify-seal-cross-domain-impact-manifest-run-executor.ts";
import { AnalyzeEvaluateCrossDomainImpactRunExecutor } from "./analyze-evaluate-cross-domain-impact-run-executor.ts";
import { AnalyzeEvaluateMechanicalPreservationRunExecutor } from "./analyze-evaluate-mechanical-preservation-run-executor.ts";
import { DecideAcceptCrossDomainImpactRunExecutor } from "./decide-accept-cross-domain-impact-run-executor.ts";

export interface CrossDomainImpactProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly recordedAnalysisDirectory: string;
  readonly resources: ReopenAgentResource;
}

export interface CrossDomainImpactProject {
  /** Opaque draft-CAS reader/store; application code depends on this port. */
  readonly manifests: CrossDomainImpactManifestStore;
  readonly crossDomainImpactManifestCapture:
    ProjectCrossDomainImpactManifestCaptureUseCase;
  readonly crossDomainImpactManifestSealReview:
    PrepareProjectCrossDomainImpactManifestSealReview;
  readonly verifySealCrossDomainImpactManifest:
    VerifySealCrossDomainImpactManifestRunExecutor;
  /** X07/X08: provider-free analysis + its documentary Thread successor. */
  readonly analyzeEvaluateCrossDomainImpact:
    AnalyzeEvaluateCrossDomainImpactRunExecutor;
  readonly crossDomainImpactDecisionReview: PrepareCrossDomainImpactDecision;
  readonly decideAcceptCrossDomainImpact: DecideAcceptCrossDomainImpactRunExecutor;
  /** X11: provider-free FEA preservation recross after the X09 decision. */
  readonly analyzeEvaluateMechanicalPreservation:
    AnalyzeEvaluateMechanicalPreservationRunExecutor;
}

export function createCrossDomainImpactProject(
  options: CrossDomainImpactProjectOptions,
): CrossDomainImpactProject {
  const manifests = new FileCrossDomainImpactManifestStore(
    new FileCaptureStore({
      kind: "cross-domain-impact-manifest",
      directory: `${options.recordedAnalysisDirectory}/impact/manifests`,
      uriNamespace: "cross-domain-impact-manifest",
      label: "Cross-domain impact manifest",
    }),
  );
  const captures = new FileCrossDomainImpactManifestSealCaptureStore(
    new FileCaptureStore({
      kind: "cross-domain-impact-manifest-seal-capture",
      directory: `${options.recordedAnalysisDirectory}/impact/manifest-seals`,
      uriNamespace: "cross-domain-impact-manifest-seal-capture",
      label: "Cross-domain impact manifest seal",
    }),
  );
  const evaluationCaptures = new FileCrossDomainImpactEvaluationCaptureStore(
    new FileCaptureStore({
      kind: "cross-domain-impact-evaluation-capture",
      directory: `${options.recordedAnalysisDirectory}/impact/evaluations`,
      uriNamespace: "cross-domain-impact-evaluation-capture",
      label: "Cross-domain impact evaluation",
    }),
  );
  const decisionCaptures = new FileCrossDomainImpactDecisionCaptureStore(
    new FileCaptureStore({
      kind: "cross-domain-impact-decision-capture",
      directory: `${options.recordedAnalysisDirectory}/impact/decisions`,
      uriNamespace: "cross-domain-impact-decision-capture",
      label: "Cross-domain impact decision",
    }),
  );
  const lineage = new ProjectCrossDomainImpactThreadLineageReader({
    projects: options.projects,
    snapshots: options.snapshots,
  });
  const briefGates = new ProjectCrossDomainImpactBriefGateReader(options.projects);
  const capture = new PrepareProjectCrossDomainImpactManifestCapture({
    manifests,
    resources: options.resources,
  });
  const review = new PrepareProjectCrossDomainImpactManifestSealReview({
    manifests,
    lineage,
    briefGates,
    projects: options.projects,
  });
  const evaluation = new PrepareCrossDomainImpactEvaluation({
    projects: options.projects,
    snapshots: options.snapshots,
    manifests,
    manifestSeals: captures,
    lineage,
    briefGates,
  });
  const decisionReview = new PrepareCrossDomainImpactDecision({
    projects: options.projects,
    snapshots: options.snapshots,
    briefGates,
    captures: evaluationCaptures,
  });
  const preservationCaptures = new FileMechanicalPreservationCaptureStore(
    new FileCaptureStore({
      kind: "cross-domain-impact-mechanical-preservation-capture",
      directory: `${options.recordedAnalysisDirectory}/impact/mechanical-preservations`,
      uriNamespace: "cross-domain-impact-mechanical-preservation-capture",
      label: "Mechanical preservation",
    }),
  );
  const closeouts = new FileMechanicalPreservationCloseoutReader(
    new FileCaptureStore({
      ...EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
      directory:
        `${options.recordedAnalysisDirectory}/calculix/evaluation-closeout-captures`,
      syncBoundary: options.recordedAnalysisDirectory,
    }),
  );
  const preservation = new PrepareMechanicalPreservation({
    projects: options.projects,
    snapshots: options.snapshots,
    manifests,
    evaluationCaptures,
    decisionCaptures,
    briefGates,
    closeouts,
  });
  return {
    manifests,
    crossDomainImpactManifestCapture: capture,
    crossDomainImpactManifestSealReview: review,
    verifySealCrossDomainImpactManifest:
      new VerifySealCrossDomainImpactManifestRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.snapshots,
        review,
        captures,
        lease: options.lease,
      }),
    analyzeEvaluateCrossDomainImpact: new AnalyzeEvaluateCrossDomainImpactRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      evaluation,
      captures: evaluationCaptures,
      lease: options.lease,
    }),
    crossDomainImpactDecisionReview: decisionReview,
    decideAcceptCrossDomainImpact: new DecideAcceptCrossDomainImpactRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      briefGates,
      evaluationCaptures,
      decisionCaptures,
      lease: options.lease,
    }),
    analyzeEvaluateMechanicalPreservation:
      new AnalyzeEvaluateMechanicalPreservationRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.snapshots,
        evaluation: preservation,
        captures: preservationCaptures,
        lease: options.lease,
      }),
  };
}
