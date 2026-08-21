/** Provider-free composition for the closed cross-domain impact-manifest seal. */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PrepareProjectCrossDomainImpactManifestSealReview } from "../../application/use-cases/impact/prepare-project-cross-domain-impact-manifest-seal-review.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileCrossDomainImpactManifestSealCaptureStore } from "./file-cross-domain-impact-manifest-seal-capture-store.ts";
import { FileCrossDomainImpactManifestStore } from "./file-cross-domain-impact-manifest-store.ts";
import { ProjectCrossDomainImpactBriefGateReader } from "./project-cross-domain-impact-brief-gate-reader.ts";
import { ProjectCrossDomainImpactThreadLineageReader } from "./project-cross-domain-impact-thread-lineage-reader.ts";
import { VerifySealCrossDomainImpactManifestRunExecutor } from "./verify-seal-cross-domain-impact-manifest-run-executor.ts";

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
  const review = new PrepareProjectCrossDomainImpactManifestSealReview({
    manifests,
    lineage: new ProjectCrossDomainImpactThreadLineageReader({
      projects: options.projects,
      snapshots: options.snapshots,
    }),
    briefGates: new ProjectCrossDomainImpactBriefGateReader(options.projects),
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
  };
}
