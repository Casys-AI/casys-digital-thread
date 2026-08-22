/** Provider-free composition for the X05 manifest seal and X07/X08 recross. */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectCrossDomainImpactManifestSealReview } from "../../application/use-cases/impact/prepare-project-cross-domain-impact-manifest-seal-review.ts";
import { PrepareCrossDomainImpactEvaluation } from "../../application/use-cases/impact/prepare-cross-domain-impact-evaluation.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileCrossDomainImpactManifestSealCaptureStore } from "./file-cross-domain-impact-manifest-seal-capture-store.ts";
import { FileCrossDomainImpactEvaluationCaptureStore } from "./file-cross-domain-impact-evaluation-capture-store.ts";
import { FileCrossDomainImpactManifestStore } from "./file-cross-domain-impact-manifest-store.ts";
import { ProjectCrossDomainImpactBriefGateReader } from "./project-cross-domain-impact-brief-gate-reader.ts";
import { ProjectCrossDomainImpactThreadLineageReader } from "./project-cross-domain-impact-thread-lineage-reader.ts";
import { VerifySealCrossDomainImpactManifestRunExecutor } from "./verify-seal-cross-domain-impact-manifest-run-executor.ts";
import { AnalyzeEvaluateCrossDomainImpactRunExecutor } from "./analyze-evaluate-cross-domain-impact-run-executor.ts";

export interface CrossDomainImpactProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly recordedAnalysisDirectory: string;
}

export interface CrossDomainImpactProject {
  /** Server-owned reader/seed seam; no MCP tool accepts manifest bytes. */
  readonly manifests: FileCrossDomainImpactManifestStore;
  readonly crossDomainImpactManifestSealReview:
    PrepareProjectCrossDomainImpactManifestSealReview;
  readonly verifySealCrossDomainImpactManifest:
    VerifySealCrossDomainImpactManifestRunExecutor;
  /** X07/X08: provider-free analysis + its documentary Thread successor. */
  readonly analyzeEvaluateCrossDomainImpact:
    AnalyzeEvaluateCrossDomainImpactRunExecutor;
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
  const lineage = new ProjectCrossDomainImpactThreadLineageReader({
    projects: options.projects,
    snapshots: options.snapshots,
  });
  const briefGates = new ProjectCrossDomainImpactBriefGateReader(options.projects);
  const review = new PrepareProjectCrossDomainImpactManifestSealReview({
    manifests,
    lineage,
    briefGates,
  });
  const evaluation = new PrepareCrossDomainImpactEvaluation({
    projects: options.projects,
    snapshots: options.snapshots,
    manifests,
    manifestSeals: captures,
    lineage,
    briefGates,
  });
  return {
    manifests,
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
    analyzeEvaluateCrossDomainImpact:
      new AnalyzeEvaluateCrossDomainImpactRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.snapshots,
        evaluation,
        captures: evaluationCaptures,
        lease: options.lease,
      }),
  };
}
