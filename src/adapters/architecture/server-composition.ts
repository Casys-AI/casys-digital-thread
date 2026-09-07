/**
 * Architecture store/project construction and explicit review/capture/executor
 * contributions.
 *
 * Agent-authored seal stores stay distinct from the renderer SysML capture.
 * Write-architecture, write-requirements and the SysON seed locate the
 * author-bound publication through the generic lease-bound connection handle;
 * part-definitions and requirements recapture locate the inspect-bound
 * publication through a separate handle. They never receive a URL. Absence does not
 * fall back to authoring. `model.seal-architecture-sysml@1` never receives
 * a provider client.
 * Requirements CAS is created once here so FEA, compilation basis, and ROP
 * reopen the same bytes.
 */

import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { ProjectArchitectureSysmlSourceCaptureUseCase } from "../../application/ports/in/architecture/agent-seal/project-architecture-sysml-source-capture.ts";
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { AgentResourceReopenError } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { SYSML_SOURCE_ACCEPTED_MIME_TYPES } from "../../domain/resource/agent-resource-reference.ts";
import { INITIAL_ARCHITECTURE_SYSML_MAX_SOURCE_BYTES } from "./agent-seal/architecture-sysml-source-analysis-composition.ts";
import { PreviewProjectArchitectureSysml } from "../../application/use-cases/architecture/agent-seal/preview-project-architecture-sysml.ts";
import { PrepareProjectBriefArchitectureReview } from "../../application/use-cases/architecture/renderer/prepare-project-brief-architecture-review.ts";
import { PrepareProjectBriefRequirementsReview } from "../../application/use-cases/architecture/requirements/prepare-project-brief-requirements-review.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeExecutionSessionCoordinator } from "../../application/control-plane/capability-runtime-execution-session.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  REQUIREMENTS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import type { FileLiveThreadUpdateStore } from "../shared/stores/live-thread-update-store.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "./agent-seal/architecture-sysml-source-analysis-composition.ts";
import type { ArchitectureSysmlSourceAnalysisCaptureService } from "./agent-seal/architecture-sysml-source-analysis-capture.ts";
import {
  type ArchitectureSysmlSealCaptureStore,
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  ModelSealArchitectureSysmlRunExecutor,
} from "./agent-seal/model-seal-architecture-sysml-run-executor.ts";
import { FilePartDefinitionsPublicationStore } from "./part-definitions/file-part-definitions-publication-store.ts";
import { ModelCapturePartDefinitionsRunExecutor } from "./part-definitions/model-capture-part-definitions-run-executor.ts";
import { FileArchitectureAttemptStore } from "./renderer/file-architecture-attempt-store.ts";
import { RenderedArchitectureSysmlAnalyzer } from "./renderer/rendered-architecture-sysml-analyzer.ts";
import { SysmlSourceAnalysisCaptureService } from "./renderer/sysml-source-analysis-capture.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  ModelWriteArchitectureRunExecutor,
} from "./renderer/model-write-architecture-run-executor.ts";
import { FileRequirementsAttemptStore } from "./requirements/file-requirements-attempt-store.ts";
import { FileRequirementsRecapturePublicationStore } from "./requirements/file-requirements-recapture-publication-store.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  ModelWriteRequirementsRunExecutor,
} from "./requirements/model-write-requirements-run-executor.ts";
import { ModelRecaptureRequirementsRunExecutor } from "./requirements/model-recapture-requirements-run-executor.ts";
import { PrepareProjectRequirementsRecaptureReview } from "./requirements/capture-backed-requirements-recapture-reviewer.ts";
import { FileSysonModelSeedAttemptStore } from "./seed/file-syson-model-seed-attempt-store.ts";
import type { CapabilityRuntimeBoundMcpClient } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import { SysonModelSeedRunExecutor } from "./seed/syson-model-seed-run-executor.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../domain/architecture/part-definitions/part-definitions-capture.ts";

export {
  MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  MODEL_WRITE_REQUIREMENTS_OPERATION,
};
export { MODEL_RECAPTURE_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-recapture-proposal.ts";
export { MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-traced-proposal.ts";
export { MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";

export interface ArchitectureFoundationOptions {
  readonly recordedAnalysisDirectory: string;
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  readonly sysmlSourceCaptureDirectory: string;
  readonly sysonModelSeedCaptureDirectory: string;
  readonly architectureCaptureDirectory: string;
  readonly requirementsCaptureDirectory: string;
  readonly resources: ReopenAgentResource;
}

export interface ArchitectureFoundation {
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisCaptureService;
  readonly sysonModelSeedCaptures: FileCaptureStore<"syson-model-seed">;
  readonly genericArchitectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
  readonly architectureSysmlSourceAnalysis:
    ArchitectureSysmlSourceAnalysisCaptureService;
  readonly architectureSysmlSourceCapture: ProjectArchitectureSysmlSourceCaptureUseCase;
  readonly architectureSysmlPreview: PreviewProjectArchitectureSysml;
  readonly architectureSysmlSeals: ArchitectureSysmlSealCaptureStore;
}

export interface ArchitectureProjectOptions {
  readonly projects: EngineeringProjectRevisionStore & {
    getRevision(
      projectId: string,
      revision: number,
    ): Promise<unknown>;
  };
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates: FileLiveThreadUpdateStore;
  /**
   * Lease-bound SysON authoring publication. Composition owns the trusted
   * `syson-author-system` binding and `casys-syson` mapping; seed, architecture
   * write and requirements write never name the URL.
   */
  readonly sysonRuntimeConnection?: CapabilityRuntimeBoundMcpClient;
  /**
   * Lease-bound SysON inspection publication. Composition owns the trusted
   * `syson-inspect-system` binding and the same `casys-syson` mapping;
   * part-definitions and requirements recapture never name the URL. Absence
   * does not fall back to authoring.
   */
  readonly sysonInspectRuntimeConnection?: CapabilityRuntimeBoundMcpClient;
  readonly foundation: ArchitectureFoundation;
  readonly sysonModelSeedAttemptDirectory: string;
  readonly architectureAttemptDirectory: string;
  readonly partDefinitionsCaptureDirectory: string;
  readonly partDefinitionsPublicationDirectory: string;
  readonly requirementsAttemptDirectory: string;
  readonly requirementsRecapturePublicationDirectory: string;
  /** Cold operational envelope recheck before SysON seed/writes/reads. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** JIT host session. Entered only after the final cold recheck. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin" | "releaseRecorded"
  >;
}

export interface ArchitectureProject {
  readonly briefArchitectureReview: PrepareProjectBriefArchitectureReview;
  readonly briefRequirementsReview: PrepareProjectBriefRequirementsReview;
  readonly requirementsRecaptureReview: PrepareProjectRequirementsRecaptureReview;
  readonly modelSealArchitectureSysml: ModelSealArchitectureSysmlRunExecutor;
  readonly sysonModelSeed: SysonModelSeedRunExecutor | undefined;
  readonly genericModelWriteArchitecture:
    | ModelWriteArchitectureRunExecutor
    | undefined;
  readonly genericModelCapturePartDefinitions:
    | ModelCapturePartDefinitionsRunExecutor
    | undefined;
  readonly genericModelWriteRequirements:
    | ModelWriteRequirementsRunExecutor
    | undefined;
  readonly genericModelRecaptureRequirements:
    | ModelRecaptureRequirementsRunExecutor
    | undefined;
}

export function createArchitectureFoundation(
  options: ArchitectureFoundationOptions,
): ArchitectureFoundation {
  const sysmlSourceAnalysis = new SysmlSourceAnalysisCaptureService({
    sourceCaptures: new FileCaptureStore({
      ...SYSML_SOURCE_CAPTURE_DESCRIPTOR,
      directory: options.sysmlSourceCaptureDirectory,
    }),
    analysisCaptures: options.sourceAnalysisCaptures,
    frontend: new RenderedArchitectureSysmlAnalyzer(),
  });
  const sysonModelSeedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: options.sysonModelSeedCaptureDirectory,
  });
  const genericArchitectureCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: options.architectureCaptureDirectory,
  });
  const requirementsCaptures = new FileCaptureStore({
    ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
    directory: options.requirementsCaptureDirectory,
  });
  const architectureSysmlDirectory =
    `${options.recordedAnalysisDirectory}/architecture-sysml`;
  const architectureSysmlSourceAnalysis =
    createArchitectureSysmlSourceAnalysisCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "architecture-sysml-source",
        directory: `${architectureSysmlDirectory}/sources`,
        uriNamespace: "architecture-sysml-source",
        label: "Captured architecture SysML source",
      }),
      analysisCaptures: new FileByteStore({
        kind: "architecture-sysml-source-analysis",
        directory: `${architectureSysmlDirectory}/analyses`,
        uriNamespace: "architecture-sysml-source-analysis",
        label: "Captured architecture SysML analysis",
      }),
    });
  const architectureSysmlSourceCapture: ProjectArchitectureSysmlSourceCaptureUseCase = {
    capture: async (command) => {
      let sourceText: string;
      try {
        sourceText = (await options.resources.reopenUtf8Text(
          command.resourceRef,
          {
            acceptedMimeTypes: SYSML_SOURCE_ACCEPTED_MIME_TYPES,
            maxBytes: INITIAL_ARCHITECTURE_SYSML_MAX_SOURCE_BYTES,
          },
        )).text;
      } catch (error) {
        if (error instanceof AgentResourceReopenError) throw error;
        throw error;
      }
      return structuredClone(
        await architectureSysmlSourceAnalysis.capture({
          profileId: command.profileId,
          sourceId: command.sourceId,
          sourceText,
        }),
      ) as unknown as Readonly<Record<string, unknown>>;
    },
  };
  const architectureSysmlPreview = new PreviewProjectArchitectureSysml({
    captures: architectureSysmlSourceAnalysis,
  });
  const architectureSysmlSealBytes = new FileByteStore({
    kind: "architecture-sysml-seal-capture",
    directory: `${architectureSysmlDirectory}/seals`,
    uriNamespace: "architecture-sysml-seal-capture",
    label: "Sealed architecture SysML analysis",
  });
  return {
    sysmlSourceAnalysis,
    sysonModelSeedCaptures,
    genericArchitectureCaptures,
    requirementsCaptures,
    architectureSysmlSourceAnalysis,
    architectureSysmlSourceCapture,
    architectureSysmlPreview,
    architectureSysmlSeals: fileTextCaptureStore(architectureSysmlSealBytes),
  };
}

export function createArchitectureProject(
  options: ArchitectureProjectOptions,
): ArchitectureProject {
  const {
    foundation,
    sysonRuntimeConnection,
    sysonInspectRuntimeConnection,
  } = options;
  const briefRequirementsReview = new PrepareProjectBriefRequirementsReview({
    projects: options.projects,
  });
  const briefArchitectureReview = new PrepareProjectBriefArchitectureReview({
    projects: options.projects,
  });
  const requirementsAttemptStore = new FileRequirementsAttemptStore(
    options.requirementsAttemptDirectory,
  );
  const requirementsRecaptureReview = new PrepareProjectRequirementsRecaptureReview({
    projects: options.projects,
    snapshots: options.snapshots,
    architectureCaptures: foundation.genericArchitectureCaptures,
    requirementsCaptures: foundation.requirementsCaptures,
    seedCaptures: foundation.sysonModelSeedCaptures,
    sysmlSourceAnalysis: foundation.sysmlSourceAnalysis,
    attempts: requirementsAttemptStore,
  });
  const modelSealArchitectureSysml = new ModelSealArchitectureSysmlRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.snapshots,
    sources: foundation.architectureSysmlSourceAnalysis,
    captures: foundation.architectureSysmlSeals,
    lease: options.lease,
  });
  const sysonModelSeed = sysonRuntimeConnection
    ? new SysonModelSeedRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      captures: foundation.sysonModelSeedCaptures,
      attempts: new FileSysonModelSeedAttemptStore(
        options.sysonModelSeedAttemptDirectory,
      ),
      capabilityRuntimeConnection: sysonRuntimeConnection,
      lease: options.lease,
      capabilityRuntime: options.capabilityRuntime,
      capabilityRuntimeSession: options.capabilityRuntimeSession,
      liveUpdates: options.liveUpdates,
    })
    : undefined;
  const genericModelWriteArchitecture = sysonRuntimeConnection
    ? new ModelWriteArchitectureRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      seedCaptures: foundation.sysonModelSeedCaptures,
      captures: foundation.genericArchitectureCaptures,
      sysmlSourceAnalysis: foundation.sysmlSourceAnalysis,
      attempts: new FileArchitectureAttemptStore(
        options.architectureAttemptDirectory,
      ),
      capabilityRuntimeConnection: sysonRuntimeConnection,
      lease: options.lease,
      capabilityRuntime: options.capabilityRuntime,
      capabilityRuntimeSession: options.capabilityRuntimeSession,
      liveUpdates: options.liveUpdates,
    })
    : undefined;
  const genericModelCapturePartDefinitions = sysonInspectRuntimeConnection
    ? new ModelCapturePartDefinitionsRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      architectureCaptures: foundation.genericArchitectureCaptures,
      seedCaptures: foundation.sysonModelSeedCaptures,
      captures: new FileCaptureStore({
        ...PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
        directory: options.partDefinitionsCaptureDirectory,
      }),
      capabilityRuntimeConnection: sysonInspectRuntimeConnection,
      lease: options.lease,
      publications: new FilePartDefinitionsPublicationStore(
        options.partDefinitionsPublicationDirectory,
      ),
      capabilityRuntime: options.capabilityRuntime,
      capabilityRuntimeSession: options.capabilityRuntimeSession,
    })
    : undefined;
  const genericModelWriteRequirements = sysonRuntimeConnection
    ? new ModelWriteRequirementsRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      seedCaptures: foundation.sysonModelSeedCaptures,
      architectureCaptures: foundation.genericArchitectureCaptures,
      sysmlSourceAnalysis: foundation.sysmlSourceAnalysis,
      captures: foundation.requirementsCaptures,
      attempts: requirementsAttemptStore,
      capabilityRuntimeConnection: sysonRuntimeConnection,
      lease: options.lease,
      capabilityRuntime: options.capabilityRuntime,
      capabilityRuntimeSession: options.capabilityRuntimeSession,
      liveUpdates: options.liveUpdates,
    })
    : undefined;
  const genericModelRecaptureRequirements = sysonInspectRuntimeConnection
    ? new ModelRecaptureRequirementsRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.snapshots,
      architectureCaptures: foundation.genericArchitectureCaptures,
      seedCaptures: foundation.sysonModelSeedCaptures,
      captures: foundation.requirementsCaptures,
      sysmlSourceAnalysis: foundation.sysmlSourceAnalysis,
      review: requirementsRecaptureReview,
      capabilityRuntimeConnection: sysonInspectRuntimeConnection,
      lease: options.lease,
      publications: new FileRequirementsRecapturePublicationStore(
        options.requirementsRecapturePublicationDirectory,
      ),
      attempts: requirementsAttemptStore,
      capabilityRuntime: options.capabilityRuntime,
      capabilityRuntimeSession: options.capabilityRuntimeSession,
    })
    : undefined;
  return {
    briefArchitectureReview,
    briefRequirementsReview,
    requirementsRecaptureReview,
    modelSealArchitectureSysml,
    sysonModelSeed,
    genericModelWriteArchitecture,
    genericModelCapturePartDefinitions,
    genericModelWriteRequirements,
    genericModelRecaptureRequirements,
  };
}
