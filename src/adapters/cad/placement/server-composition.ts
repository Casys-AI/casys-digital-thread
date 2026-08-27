/**
 * CAD placement capture composition. Provider-free draft CAS only.
 */

import { CaptureProjectCadPlacement } from "../../../application/use-cases/cad/placement/capture-project-cad-placement.ts";
import type { ProjectCadPlacementCaptureUseCase } from "../../../application/ports/in/cad/placement/project-cad-placement-capture.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { ReopenAgentResource } from "../../../application/use-cases/resource/reopen-agent-resource.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { GenericArchitectureCaptureReader } from "../../architecture/renderer/product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "../../architecture/renderer/sysml-source-analysis-capture.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { DeclaredAgainstCadPlacementArchitectureIndex } from "./declared-against-cad-placement-architecture-index.ts";
import { FileCadImmediatePlacementSourceStore } from "./file-cad-immediate-placement-source-store.ts";
import { FileCadPlacementAnalysisCaptureStore } from "./file-cad-placement-analysis-capture-store.ts";

export interface CadPlacementCompositionOptions {
  readonly recordedAnalysisDirectory: string;
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly architectureCaptures: GenericArchitectureCaptureReader;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
}

export interface CadPlacementComposition {
  readonly cadPlacementCapture: ProjectCadPlacementCaptureUseCase;
}

export function createCadPlacementComposition(
  options: CadPlacementCompositionOptions,
): CadPlacementComposition {
  return {
    cadPlacementCapture: new CaptureProjectCadPlacement({
      workspace: options.workspace,
      resources: options.resources,
      sources: new FileCadImmediatePlacementSourceStore(
        new FileByteStore({
          kind: "cad-immediate-placement-source",
          directory: `${options.recordedAnalysisDirectory}/cad/placement/sources`,
          uriNamespace: "cad-immediate-placement-source",
          label: "CAD immediate placement source",
        }),
      ),
      analyses: new FileCadPlacementAnalysisCaptureStore(
        new FileByteStore({
          kind: "cad-placement-analysis-capture",
          directory: `${options.recordedAnalysisDirectory}/cad/placement/analyses`,
          uriNamespace: "cad-placement-analysis-capture",
          label: "CAD placement analysis capture",
        }),
      ),
      architecture: new DeclaredAgainstCadPlacementArchitectureIndex(
        options.snapshots,
        options.architectureCaptures,
        options.sysmlSourceAnalysis,
      ),
    }),
  };
}
