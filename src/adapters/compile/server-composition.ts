/**
 * Technical compilation foundation, project seal, and preview construction.
 *
 * Admission seals, the reopen reader, and the sealer share one capture
 * object. Preview is a separate use case and is not admission authority.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { PreviewProjectTechnicalCompilation } from "../../application/use-cases/compile/admission/preview-project-technical-compilation.ts";
import type { ProjectTechnicalSourceCaptureUseCase } from "../../application/ports/in/compile/admission/project-technical-source-capture.ts";
import { CaptureProjectTechnicalSource } from "../../application/use-cases/compile/admission/capture-project-technical-source.ts";
import type { ProjectSourceAttachmentRoleCatalog } from "../../application/ports/out/project-source-workspace/project-source-attachment-role-catalog.ts";
import { FileProjectSourceClosureStore } from "../project-source-workspace/file-project-source-closure-store.ts";
import { FixedProjectSourceAttachmentRoleCatalog } from "../project-source-workspace/fixed-project-source-attachment-role-catalog.ts";
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { ThermalMethodSheetCompilationJoin } from "../../application/ports/out/compile/admission/thermal-method-sheet-compilation-join.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";
import type { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { CaptureBackedTechnicalCompilationAdmissionReader } from "./admission/capture-backed-technical-compilation-admission-reader.ts";
import { CaptureBackedTechnicalCompilationSourceReader } from "./admission/capture-backed-technical-compilation-source-reader.ts";
import { FileTechnicalCompilationDraftStore } from "./admission/file-technical-compilation-draft-store.ts";
import { FixedTechnicalCompilationProfileCatalogProvider } from "./admission/fixed-technical-compilation-profile-catalog-provider.ts";
import { CaptureBackedTechnicalCompilationBasisResolver } from "./captures/technical-compilation-basis-resolver.ts";
import { createInitialTechnicalSourceAnalysisCaptureService } from "./captures/initial-technical-source-analysis-composition.ts";
import type { TechnicalSourceAnalysisCaptureService } from "./captures/technical-source-analysis-capture.ts";
import {
  CompileSealAdmissionRunExecutor,
  type TechnicalCompilationAdmissionCaptureStore,
} from "./executors/compile-seal-admission-run-executor.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
} from "../../domain/compile/admission/technical-compilation-proposal.ts";

export { COMPILE_SEAL_ADMISSION_OPERATION, COMPILE_SEAL_ADMISSION_PRODUCER_TOOL };

export interface TechnicalCompilationFoundationOptions {
  readonly recordedAnalysisDirectory: string;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly resources: ReopenAgentResource;
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly roles?: ProjectSourceAttachmentRoleCatalog;
}

export interface TechnicalCompilationFoundation {
  readonly technicalSourceAnalysis: TechnicalSourceAnalysisCaptureService;
  readonly technicalSourceAnalysisCaptures: FileByteStore<
    "technical-source-analysis"
  >;
  readonly technicalCompilationSources: CaptureBackedTechnicalCompilationSourceReader;
  readonly technicalSourceCapture: ProjectTechnicalSourceCaptureUseCase;
  readonly technicalCompilationDrafts: FileTechnicalCompilationDraftStore;
  readonly technicalCompilationProfiles:
    FixedTechnicalCompilationProfileCatalogProvider;
  readonly technicalCompilationSeals: TechnicalCompilationAdmissionCaptureStore;
  readonly technicalCompilationAdmissions:
    CaptureBackedTechnicalCompilationAdmissionReader;
}

export interface TechnicalCompilationProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly foundation: TechnicalCompilationFoundation;
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly seedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
}

export interface TechnicalCompilationProject {
  readonly technicalCompilationBasis: CaptureBackedTechnicalCompilationBasisResolver;
  readonly compileSealAdmission: CompileSealAdmissionRunExecutor;
}

export interface TechnicalCompilationPreviewOptions {
  readonly foundation: TechnicalCompilationFoundation;
  readonly basisResolver: CaptureBackedTechnicalCompilationBasisResolver;
  readonly projects: EngineeringProjectRevisionStore;
  readonly methodSheets: ThermalMethodSheetCompilationJoin;
}

export function createTechnicalCompilationFoundation(
  options: TechnicalCompilationFoundationOptions,
): TechnicalCompilationFoundation {
  const technicalCompilationDirectory =
    `${options.recordedAnalysisDirectory}/technical-compilation`;
  const technicalSourceAnalysisCaptures = new FileByteStore({
    kind: "technical-source-analysis",
    directory: `${technicalCompilationDirectory}/analyses`,
    uriNamespace: "technical-source-analysis",
    label: "Captured technical source analysis",
  });
  const technicalSourceAnalysis = createInitialTechnicalSourceAnalysisCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "technical-source",
      directory: `${technicalCompilationDirectory}/sources`,
      uriNamespace: "technical-source",
      label: "Captured technical source",
    }),
    analysisCaptures: technicalSourceAnalysisCaptures,
    captureDocuments: new FileByteStore({
      kind: "technical-source-analysis-capture",
      directory: `${technicalCompilationDirectory}/capture-documents`,
      uriNamespace: "technical-source-analysis-capture",
      label: "Captured technical source analysis document",
    }),
  });
  const technicalCompilationProfiles =
    new FixedTechnicalCompilationProfileCatalogProvider();
  const projectSourceClosures = new FileProjectSourceClosureStore(
    new FileByteStore({
      kind: "project-source-closure",
      directory: `${technicalCompilationDirectory}/closures`,
      uriNamespace: "project-source-closure",
      label: "Project source dependency closure",
    }),
  );
  const attachmentRoles = options.roles ??
    new FixedProjectSourceAttachmentRoleCatalog();
  const technicalCompilationSources = new CaptureBackedTechnicalCompilationSourceReader(
    {
      captures: technicalSourceAnalysis,
      closures: projectSourceClosures,
      workspace: options.workspace,
      resources: options.resources,
      profiles: technicalCompilationProfiles,
    },
  );
  const technicalSourceCapture: ProjectTechnicalSourceCaptureUseCase =
    new CaptureProjectTechnicalSource({
      workspace: options.workspace,
      resources: options.resources,
      captures: technicalSourceAnalysis,
      closures: projectSourceClosures,
      roles: attachmentRoles,
    });
  const technicalCompilationDrafts = new FileTechnicalCompilationDraftStore(
    new FileByteStore({
      kind: "technical-compilation-draft",
      directory: `${technicalCompilationDirectory}/drafts`,
      uriNamespace: "technical-compilation-draft",
      label: "Technical compilation review draft",
    }),
  );
  const technicalCompilationSealBytes = new FileByteStore({
    kind: "technical-compilation-admission-capture",
    directory: `${technicalCompilationDirectory}/seals`,
    uriNamespace: "technical-compilation-admission-capture",
    label: "Sealed technical compilation admission",
  });
  const technicalCompilationSeals = fileTextCaptureStore(
    technicalCompilationSealBytes,
  );
  const technicalCompilationAdmissions =
    new CaptureBackedTechnicalCompilationAdmissionReader({
      snapshots: options.snapshots,
      captures: technicalCompilationSeals,
      sources: technicalCompilationSources,
    });
  return {
    technicalSourceAnalysis,
    technicalSourceAnalysisCaptures,
    technicalCompilationSources,
    technicalSourceCapture,
    technicalCompilationDrafts,
    technicalCompilationProfiles,
    technicalCompilationSeals,
    technicalCompilationAdmissions,
  };
}

export function createTechnicalCompilationProject(
  options: TechnicalCompilationProjectOptions,
): TechnicalCompilationProject {
  const technicalCompilationBasis = new CaptureBackedTechnicalCompilationBasisResolver({
    projects: options.projects,
    snapshots: options.snapshots,
    architectureCaptures: options.architectureCaptures,
    seedCaptures: options.seedCaptures,
    requirementsCaptures: options.requirementsCaptures,
  });
  const compileSealAdmission = new CompileSealAdmissionRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.snapshots,
    basisResolver: technicalCompilationBasis,
    drafts: options.foundation.technicalCompilationDrafts,
    sources: options.foundation.technicalCompilationSources,
    profiles: options.foundation.technicalCompilationProfiles,
    captures: options.foundation.technicalCompilationSeals,
    lease: options.lease,
  });
  return { technicalCompilationBasis, compileSealAdmission };
}

export function createTechnicalCompilationPreview(
  options: TechnicalCompilationPreviewOptions,
): PreviewProjectTechnicalCompilation {
  return new PreviewProjectTechnicalCompilation({
    basisResolver: options.basisResolver,
    sourceReader: options.foundation.technicalCompilationSources,
    profileCatalog: options.foundation.technicalCompilationProfiles,
    draftStore: options.foundation.technicalCompilationDrafts,
    projects: options.projects,
    methodSheets: options.methodSheets,
  });
}
