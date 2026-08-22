import { McpApp } from "@casys/mcp-server";
import {
  INTERACTIVE_PROJECT_APPROVAL_MODE,
  LOCAL_YOLO_PROJECT_APPROVAL_MODE,
  type ProjectApprovalMode,
} from "./src/tools/project-approval-mode.ts";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/shared/docker-observer.ts";
import {
  HttpMcpProbe,
  type McpProbe,
} from "./src/adapters/shared/mcp/http-mcp-probe.ts";
import { HttpMcpToolClient } from "./src/adapters/shared/mcp/http-mcp-tool-client.ts";
import { loadFleetManifest } from "./src/adapters/control-plane/manifest.ts";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./src/adapters/loopback-host.ts";
import { FileThreadSnapshotStore } from "./src/adapters/shared/stores/file-thread-snapshot-store.ts";
import { installGracefulHttpShutdown } from "./src/adapters/shared/graceful-http-shutdown.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
  DFM_CASE_CAPTURE_DESCRIPTOR,
  DFM_CHECK_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_OBSERVATION_CAPTURE_DESCRIPTOR,
  PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
  PRINTABILITY_OBSERVATION_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
} from "./src/adapters/shared/cas/file-capture-store.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "./src/adapters/compile/source/project-brief-source-analyzer.ts";
import { BriefSourceAnalysisCaptureService } from "./src/adapters/compile/captures/brief-source-analysis-capture.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "./src/adapters/architecture/agent-seal/model-seal-architecture-sysml-run-executor.ts";
import type { Build123dExecutionServerOptions } from "./src/adapters/cad/isolated/build123d-execution-composition.ts";
import type { AdmittedModelicaExecutionServerOptions } from "./src/adapters/modelica/admitted/execution-composition.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "./src/adapters/cad/sealed-isolated/design-seal-isolated-geometry-run-executor.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./src/adapters/modelica/qualified-kit/execution-composition.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "./src/adapters/modelica/evaluation/verify-evaluate-admitted-modelica-observations-run-executor.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
} from "./src/adapters/modelica/evaluation/decide-admitted-modelica-evaluation-run-executor.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "./src/adapters/fea/evaluation-closeout/decide-static-mechanical-evaluation-closeout-run-executor.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "./src/adapters/modelica/thermal-method-sheet/verify-seal-modelica-thermal-method-sheet-run-executor.ts";
import { VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION } from "./src/domain/impact/cross-domain-impact-manifest-proposal.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "./src/domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "./src/domain/impact/cross-domain-impact-decision-proposal.ts";
import { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION } from "./src/adapters/sensitivity/vector-correction/design-apply-vector-correction-run-executor.ts";
import { COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION } from "./src/adapters/sensitivity/correction-source/compile-capture-corrected-source-run-executor.ts";
import { FixedSourceAnalysisFrontendRegistry } from "./src/domain/compile/source/source-analysis-frontend-registry.ts";
import { FileInspectionDroneV4ArchitectureAttemptStore } from "./src/adapters/inspection-drone/author/file-inspection-drone-v4-architecture-attempt-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/project/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./src/adapters/project/approved-brief-baseline-run-executor.ts";
import { InspectionDroneV4ArchitectureRunExecutor } from "./src/adapters/inspection-drone/author/inspection-drone-v4-architecture-run-executor.ts";
import { InspectionDroneV4PartDefinitionsRunExecutor } from "./src/adapters/inspection-drone/part-definitions/inspection-drone-v4-part-definitions-run-executor.ts";
import { FileInspectionDroneV4PartDefinitionsPublicationStore } from "./src/adapters/inspection-drone/part-definitions/file-inspection-drone-v4-part-definitions-publication-store.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "./src/domain/inspection-drone/author/inspection-drone-v4-architecture.ts";
import { INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION } from "./src/domain/inspection-drone/part-definitions/inspection-drone-v4-part-definitions.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "./src/adapters/architecture/renderer/model-write-architecture-run-executor.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "./src/domain/architecture/part-definitions/part-definitions-capture.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./src/adapters/cad/canonical/design-write-geometry-run-executor.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "./src/adapters/architecture/requirements/model-write-requirements-run-executor.ts";
import {
  ARCHIVE_LINEAGE_OPERATION,
  ArchiveLineageRunExecutor,
} from "./src/adapters/record/archive-lineage-run-executor.ts";
import {
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
  ReconcileUncertainWriterRunExecutor,
} from "./src/adapters/record/reconcile-uncertain-writer-run-executor.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "./src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts";
import { FileCanonicalAssetReader } from "./src/adapters/assets/canonical-asset-reader.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "./src/adapters/compile/executors/compile-seal-admission-run-executor.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "./src/adapters/cad/isolated/design-execute-build123d-run-executor.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "./src/adapters/modelica/qualified-kit/run-executor.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "./src/adapters/modelica/admitted/run-executor.ts";
import { ExportVolumeGeometryStager } from "./src/adapters/make/printability/export-volume-geometry-stager.ts";
import { ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION } from "./src/adapters/sensitivity/study/analyze-seal-sensitivity-study-run-executor.ts";
import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "./src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "./src/adapters/sensitivity/edges/model-write-sensitivity-edges-run-executor.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "./src/adapters/sensitivity/base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts";
import {
  INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
  IndustrializeSealPrintabilityCaseRunExecutor,
} from "./src/adapters/make/printability/industrialize-seal-printability-case-run-executor.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
  IndustrializeObservePrintabilityRunExecutor,
} from "./src/adapters/make/printability/industrialize-observe-printability-run-executor.ts";
import {
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
  IndustrializeSealPrintEstimateCaseRunExecutor,
} from "./src/adapters/make/print-estimate/industrialize-seal-print-estimate-case-run-executor.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
  IndustrializeObservePrintEstimateRunExecutor,
} from "./src/adapters/make/print-estimate/industrialize-observe-print-estimate-run-executor.ts";
import { FilePrintabilityAttemptStore } from "./src/adapters/make/printability/file-printability-attempt-store.ts";
import { FilePrintEstimateAttemptStore } from "./src/adapters/make/print-estimate/file-print-estimate-attempt-store.ts";
import {
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  IndustrializeSealDfmCaseRunExecutor,
} from "./src/adapters/make/dfm/industrialize-seal-dfm-case-run-executor.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  IndustrializeRunDfmChecksRunExecutor,
} from "./src/adapters/make/dfm/industrialize-run-dfm-checks-run-executor.ts";
import { FileDfmCheckAttemptStore } from "./src/adapters/make/dfm/file-dfm-check-attempt-store.ts";
import { RegisteredProjectRunExecutor } from "./src/application/use-cases/registered-project-run-executor.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/shared/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/shared/stores/live-thread-update-store.ts";
import { FileEngineeringProjectRevisionStore } from "./src/adapters/shared/stores/engineering-project-store.ts";
import {
  CockpitFocusConflictError,
  FileCockpitFocusStore,
} from "./src/adapters/project/file-cockpit-focus-store.ts";
import { createEngineeringProjectCommandRuntime } from "./src/adapters/project/engineering-project-command-runtime.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./src/adapters/shared/stores/engineering-thread-snapshot-resolver.ts";
import { loadRunFixtures } from "./src/adapters/control-plane/run-fixtures.ts";
import { ControlPlane } from "./src/application/control-plane/control-plane.ts";
import { EngineeringProjectCommandError } from "./src/application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "./src/application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./src/orchestration/operations/registry.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./src/orchestration/operations/fea-isolated-static-proof.ts";
import type { RunDetail } from "./src/application/control-plane/read-model/engineering-run.ts";
import type { FleetManifest } from "./src/application/control-plane/read-model/fleet-manifest.ts";
import { registerControlPlaneTools } from "./src/tools/control-plane.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./src/tools/project-control.ts";
import {
  type ProjectBriefToolDependencies,
  registerProjectBriefTools,
} from "./src/tools/project-brief.ts";
import {
  type CockpitFocusToolDependencies,
  registerCockpitFocusTools,
} from "./src/tools/cockpit-focus.ts";
import { sha256Fingerprint } from "./src/domain/kernel/deterministic-json.ts";
import {
  createArchitectureFoundation,
  createArchitectureProject,
} from "./src/adapters/architecture/server-composition.ts";
import {
  composePrivateBuild123dGeometrySurfaces,
  createBuild123dCapability,
  createCadProject,
} from "./src/adapters/cad/server-composition.ts";
import {
  createTechnicalCompilationFoundation,
  createTechnicalCompilationPreview,
  createTechnicalCompilationProject,
} from "./src/adapters/compile/server-composition.ts";
import { createRecordedOperationPlanComposition } from "./src/adapters/compile/plans/server-composition.ts";
import { createLedDriverSourceComposition } from "./src/adapters/electrical/led-driver/server-composition.ts";
import {
  createCalculixCapability,
  createFeaFoundation,
  createFeaProject,
} from "./src/adapters/fea/server-composition.ts";
import {
  createAdmittedModelicaCapability,
  createModelicaProject,
  createModelicaThermalMethodSheetJoin,
  createQualifiedModelicaCapability,
} from "./src/adapters/modelica/server-composition.ts";
import { createSensitivityComposition } from "./src/adapters/sensitivity/server-composition.ts";
import { createCrossDomainImpactProject } from "./src/adapters/impact/server-composition.ts";

const DEFAULT_PORT = 3020;
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_MANIFEST_PATH = "config/mcp-fleet.json";
const DEFAULT_RUN_FIXTURE_PATH = "state/fixtures/runs/bracket-demo.json";
const DEFAULT_ACTIVE_PROJECT_DIRECTORY = "state/local/engineering-projects";
const DEFAULT_COCKPIT_FOCUS_DIRECTORY = "state/local/cockpit-focus";
const DEFAULT_THREAD_SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY = "state/local/live-thread-updates";
const DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY = "state/local/approved-brief-captures";
const DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY =
  "state/local/syson-model-seed-captures";
const DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY =
  "state/local/syson-model-seed-attempts";
const DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DIRECTORY =
  "state/local/inspection-drone-v4-architecture-captures";
const DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_ATTEMPT_DIRECTORY =
  "state/local/inspection-drone-v4-architecture-attempts";
const DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DIRECTORY =
  "state/local/inspection-drone-v4-part-definitions-captures";
const DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_PUBLICATION_DIRECTORY =
  "state/local/inspection-drone-v4-part-definitions-publications";
const DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY = "state/local/architecture-captures";
const DEFAULT_ARCHITECTURE_ATTEMPT_DIRECTORY = "state/local/architecture-attempts";
const DEFAULT_PART_DEFINITIONS_CAPTURE_DIRECTORY =
  "state/local/part-definitions-captures";
const DEFAULT_PART_DEFINITIONS_PUBLICATION_DIRECTORY =
  "state/local/part-definitions-publications";
const DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY = "state/local/geometry-draft-captures";
const DEFAULT_GEOMETRY_CAPTURE_DIRECTORY = "state/local/geometry-captures";
const DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY = "state/local/requirements-captures";
const DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY = "state/local/requirements-attempts";
/**
 * Canonical binary asset store shared with design.write-geometry@1 promotion.
 * The FEA path reads sealed STEP bytes from here — never from the draft store:
 * drafts are pre-approval material and must not reach a solver.
 */
const DEFAULT_CANONICAL_ASSET_DIRECTORY = "state/local/thread-assets";
const DEFAULT_SENSITIVITY_STEP_CACHE_DIRECTORY = "state/local/sensitivity-step-cache";
const DEFAULT_PRINTABILITY_CASE_CAPTURE_DIRECTORY =
  "state/local/printability-case-captures";
const DEFAULT_PRINTABILITY_ATTEMPT_DIRECTORY = "state/local/printability-attempts";
const DEFAULT_PRINTABILITY_OBSERVATION_CAPTURE_DIRECTORY =
  "state/local/printability-observation-captures";
const DEFAULT_PRINTABILITY_EXPORT_DIRECTORY = "state/local/printability-exports";
const DEFAULT_DFM_CASE_CAPTURE_DIRECTORY = "state/local/dfm-case-captures";
const DEFAULT_DFM_CHECK_CAPTURE_DIRECTORY = "state/local/dfm-check-captures";
const DEFAULT_DFM_CHECK_ATTEMPT_DIRECTORY = "state/local/dfm-check-attempts";
const DEFAULT_DFM_EXPORT_DIRECTORY = "state/local/dfm-exports";
const DEFAULT_PRINT_ESTIMATE_CASE_CAPTURE_DIRECTORY =
  "state/local/print-estimate-case-captures";
const DEFAULT_PRINT_ESTIMATE_ATTEMPT_DIRECTORY = "state/local/print-estimate-attempts";
const DEFAULT_PRINT_ESTIMATE_OBSERVATION_CAPTURE_DIRECTORY =
  "state/local/print-estimate-observation-captures";
const DEFAULT_PRINT_ESTIMATE_EXPORT_DIRECTORY = "state/local/print-estimate-exports";
const DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY =
  "state/local/engineering-project-run-leases";
const DEFAULT_PROJECT_BASELINE_DIRECTORY = "config/projects/baselines";
/**
 * One closed local root for the recorded-analysis vertical. Every child store
 * has a fixed CAS namespace; this path changes persistence placement only.
 */
const DEFAULT_RECORDED_ANALYSIS_DIRECTORY = "state/local/recorded-analysis";

export const LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE =
  "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8" as const;

export const LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894" as const;
export const LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:d25f220287cd8d1713e9e7d773afb8bb867fc5404a112e5e50ffa2e862fd6fdf" as const;
export const LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE =
  "casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2" as const;
const LOCAL_CALCULIX_WRAPPER_SHA256 =
  "507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2";
const LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT = Object.freeze({
  algorithm: "sha256" as const,
  digest: "d6aee5fe375daa55cec29a32acf27181dd4bb8ea8e5c3f90f848cc718c149428",
});
const LOCAL_MODELICA_QUALIFICATION_ROOT =
  "state/local/modelica-microsandbox-qualification";

const LOCAL_BUILD123D_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 30_000,
  maxCpuTimeMs: 25_000,
  maxMemoryBytes: 1_024 * 1_048_576,
  maxProcesses: 32,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 128 * 1_048_576,
});

const LOCAL_BUILD123D_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "build123d-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  supervisorUser: "0:0",
  untrustedChildUser: "65532:65532",
  limits: LOCAL_BUILD123D_EXECUTION_LIMITS,
});

const LOCAL_MODELICA_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 120_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 16 * 1_048_576,
  maxOutputTotalBytes: 17 * 1_048_576,
});

const LOCAL_MODELICA_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "modelica-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["omc", "perl"],
  limits: LOCAL_MODELICA_EXECUTION_LIMITS,
});

const LOCAL_ADMITTED_MODELICA_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "modelica-admitted-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["omc", "perl"],
  limits: LOCAL_MODELICA_EXECUTION_LIMITS,
});

const LOCAL_CALCULIX_EXECUTION_LIMITS = Object.freeze({
  maxWallTimeMs: 180_000,
  maxCpuTimeMs: 160_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 256 * 1_048_576,
});

const LOCAL_CALCULIX_EXECUTION_POLICY_BODY = Object.freeze({
  schemaVersion: "calculix-microsandbox-policy/1.0",
  backend: "microsandbox-local@0.6.8",
  imageReference: LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
  network: "deny-all",
  pullPolicy: "never",
  securityProfile: "restricted",
  workerUser: "65532:65532",
  fixedExecutables: ["gmsh", "ccx"],
  limits: LOCAL_CALCULIX_EXECUTION_LIMITS,
});

export interface CreateConsoleServerOptions {
  manifest?: FleetManifest;
  manifestPath?: string;
  runs?: readonly RunDetail[];
  runFixturePaths?: string[];
  probe?: McpProbe;
  docker?: DockerObserver;
  now?: () => Date;
  monotonicNow?: () => number;
  cacheTtlMs?: number;
  logger?: (message: string) => void;
  /** `false` is reserved for focused fleet-only tests. */
  projectControl?: ProjectControlToolDependencies | false;
  /** Living in-project brief tools; enabled by default with project control. */
  projectBrief?: ProjectBriefToolDependencies | false;
  /** Agent-owned browser focus; omitted with project tools in fleet-only tests. */
  cockpitFocus?: CockpitFocusToolDependencies | false;
  /** Fixed in tests/deployments; local runs otherwise use a process-ephemeral key. */
  mrtrSigningKey?: string;
  /**
   * Internal composition seam for tests and embedders; interactive MRTR
   * remains the default. Any network-facing embedder must resolve this option
   * through `approvalModeForBinding` against its actual bind hostname.
   */
  approvalMode?: ProjectApprovalMode;
  /**
   * Explicit project seed for isolated tests or a controlled deployment.
   * Omit both values in normal operation: the server never seeds a product
   * from a bundled fixture; cockpit focus selects an existing durable project.
   */
  projectId?: string;
  projectPath?: string;
  activeProjectDirectory?: string;
  cockpitFocusDirectory?: string;
  threadSnapshotDirectory?: string;
  liveThreadUpdateDirectory?: string;
  approvedBriefCaptureDirectory?: string;
  /** Exact canonical brief JSON captured before local source analysis. */
  briefSourceCaptureDirectory?: string;
  /** Shared provider-neutral source-analysis CAS (brief, SysML, and CAD). */
  sourceAnalysisCaptureDirectory?: string;
  /** Exact server-rendered SysML source bytes captured before analysis/dispatch. */
  sysmlSourceCaptureDirectory?: string;
  sysonModelSeedCaptureDirectory?: string;
  sysonModelSeedAttemptDirectory?: string;
  /** Generic model.write-architecture@1 capture store directory. */
  architectureCaptureDirectory?: string;
  /** Generic model.write-architecture@1 WAL attempt directory. */
  architectureAttemptDirectory?: string;
  /** Generic model.capture-part-definitions@1 capture store directory. */
  partDefinitionsCaptureDirectory?: string;
  /** Generic model.capture-part-definitions@1 publication WAL directory. */
  partDefinitionsPublicationDirectory?: string;
  /** Generic model.write-requirements@1 capture store directory. */
  requirementsCaptureDirectory?: string;
  /** Generic model.write-requirements@1 WAL attempt directory. */
  requirementsAttemptDirectory?: string;
  inspectionDroneV4ArchitectureCaptureDirectory?: string;
  inspectionDroneV4ArchitectureAttemptDirectory?: string;
  inspectionDroneV4PartDefinitionsCaptureDirectory?: string;
  inspectionDroneV4PartDefinitionsPublicationDirectory?: string;
  printabilityCaseCaptureDirectory?: string;
  printabilityAttemptDirectory?: string;
  printabilityObservationCaptureDirectory?: string;
  printEstimateCaseCaptureDirectory?: string;
  printEstimateAttemptDirectory?: string;
  printEstimateObservationCaptureDirectory?: string;
  dfmCaseCaptureDirectory?: string;
  dfmCheckCaptureDirectory?: string;
  dfmCheckAttemptDirectory?: string;
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
  /** Root of the closed CAS/WAL layout used by isolated-analysis operations. */
  recordedAnalysisDirectory?: string;
  /**
   * Explicit qualified Build123d profile and optional isolated runtime.
   * Omitted means no review tool and no executor. A profile without a runtime
   * exposes provider-free review only; no environment variable enables it.
   */
  build123dExecution?: Build123dExecutionServerOptions;
  /**
   * Explicit qualified Modelica profile and optional isolated runtime.
   * Omitted means no review tool and no executor. Runtime activation still
   * requires the separately persisted, digest-pinned qualification capture.
   */
  modelicaIsolatedExecution?: ModelicaIsolatedExecutionServerOptions;
  /**
   * Admitted Modelica closed-subset profile and optional isolated runtime.
   * Distinct from the pinned kit. Omitted means no review tool and no executor.
   */
  admittedModelicaExecution?: AdmittedModelicaExecutionServerOptions;
  /** Local CalculiX profile; product execution additionally requires SysON. */
  calculixIsolatedExecution?: CalculixIsolatedExecutionServerOptions;
}

export async function createConsoleServer(
  options: CreateConsoleServerOptions = {},
): Promise<{ app: McpApp; controlPlane: ControlPlane }> {
  const manifest = options.manifest ??
    await loadFleetManifest(
      options.manifestPath ?? env("MCP_FLEET_MANIFEST") ??
        DEFAULT_MANIFEST_PATH,
    );
  const runs = options.runs ??
    await loadRunFixtures(
      options.runFixturePaths ??
        [env("MCP_RUN_FIXTURE") ?? DEFAULT_RUN_FIXTURE_PATH],
    );
  const syson = manifest.servers.find((server) => server.id === "syson");
  const build123dSandbox = manifest.servers.find((server) =>
    server.id === "build123d-sandbox"
  );
  const calculix = manifest.servers.find((server) => server.id === "calculix");
  const dfm = manifest.servers.find((server) => server.id === "dfm");
  const prusaslicer = manifest.servers.find((server) => server.id === "prusaslicer");
  const controlPlane = new ControlPlane({
    manifest,
    runs,
    probe: options.probe ?? new HttpMcpProbe(),
    docker: options.docker ?? new DockerComposeObserver(),
    now: options.now,
    monotonicNow: options.monotonicNow,
    cacheTtlMs: options.cacheTtlMs,
  });
  const defaultProjectTools = options.projectControl === undefined &&
      options.projectBrief === undefined
    ? await createProjectControl(
      options,
      syson?.mcpUrl,
      build123dSandbox?.mcpUrl,
      calculix?.mcpUrl,
      dfm?.mcpUrl,
      prusaslicer?.mcpUrl,
    )
    : undefined;
  const projectControl = options.projectControl === false
    ? undefined
    : options.projectControl ?? defaultProjectTools?.control;
  const projectBrief = options.projectBrief === false
    ? undefined
    : options.projectBrief ?? defaultProjectTools?.brief;
  const cockpitFocus = options.cockpitFocus === false || !projectControl
    ? undefined
    : options.cockpitFocus ?? createCockpitFocus(options);
  const approvalMode = options.approvalMode ?? INTERACTIVE_PROJECT_APPROVAL_MODE;
  const baseInstructions = projectControl || projectBrief
    ? "Casys engineering control plane. Fleet tools are read-only. project_start creates the engineering project from the first plain-language intent; framing, guided questions, sourced answers and the living brief remain inside that same project. An agent may revise the brief but cannot self-approve it: project_brief_confirm requires exact confirmation through MCP elicitation presented by the paired host. The signed retry protects request integrity and replay; user authentication remains the host's responsibility. project_snapshot reads the whole durable project. project_plan_publish binds reviewed work to the exact human-approved canonical brief; every work item cites a reviewed server-side operation. The agent may queue and execute only registered operations, with no provider name, arbitrary arguments, result payload, or fabricated evidence supplied by the caller. Consequential engineering decisions use the same host-presented MCP elicitation flow. Sensitivity studies produce data, never verdicts: a published derivative carries its unit, base point, step and declared limitations, and satisfies no requirement by itself. cockpit_focus_set selects an already durable project for the read-only cockpit; it does not change project truth. The cockpit is a read-only projection of framing, activity, lineage and results. Unavailable, demo, unlicensed standards content, legal conclusions, and unverified evidence must stay explicitly labelled."
    : "Casys read-only fleet console. Project tools are disabled on this non-loopback or explicitly fleet-only binding. Unavailable, demo, and unverified evidence must stay explicitly labelled.";
  const instructions = baseInstructions +
    (approvalMode.kind === "local-yolo"
      ? " Explicit local YOLO startup opt-in is active: positive project_brief_confirm and project_decision_approve calls auto-confirm through the canonical human command services with a persisted local-yolo origin and rationale, without fabricating MCP elicitation responses. Rejection, cancellation, supersession and human-only execution still require interactive signed MRTR elicitation."
      : "");
  const app = new McpApp({
    name: "casys-digital-thread-console",
    version: "0.2.0",
    transport: "stateless",
    maxConcurrent: 8,
    backpressureStrategy: "queue",
    validateSchema: true,
    ...(projectControl || projectBrief
      ? {
        mrtr: {
          signingKey: options.mrtrSigningKey ?? env("MCP_MRTR_SIGNING_KEY") ??
            ephemeralMrtrSigningKey(),
        },
      }
      : {}),
    instructions,
    logger: options.logger,
    toolErrorMapper: (error) =>
      error instanceof Error &&
        (error.name === "ControlPlaneNotFoundError" ||
          error instanceof EngineeringProjectCommandError ||
          error instanceof CockpitFocusConflictError ||
          error instanceof TypeError)
        ? error.message
        : null,
  });
  if (projectControl || projectBrief) {
    app.use(async (context, next) => {
      if (
        context.request &&
        !requestUsesExplicitLoopbackHost(context.request)
      ) {
        throw new TypeError(
          "The engineering MCP control plane accepts project tool calls only through an explicit loopback hostname.",
        );
      }
      return await next();
    });
  }
  registerControlPlaneTools(app, controlPlane);
  if (projectControl) {
    registerProjectControlTools(app, { ...projectControl, approvalMode });
  }
  if (projectBrief) {
    registerProjectBriefTools(app, { ...projectBrief, approvalMode });
  }
  if (cockpitFocus) registerCockpitFocusTools(app, cockpitFocus);
  return { app, controlPlane };
}

async function createProjectControl(
  options: CreateConsoleServerOptions,
  sysonMcpUrl?: string,
  build123dSandboxMcpUrl?: string,
  calculixMcpUrl?: string,
  dfmMcpUrl?: string,
  prusaslicerMcpUrl?: string,
): Promise<{
  readonly control: ProjectControlToolDependencies;
  readonly brief: ProjectBriefToolDependencies;
}> {
  const activeThreadSnapshots = new FileThreadSnapshotStore(
    options.threadSnapshotDirectory ?? DEFAULT_THREAD_SNAPSHOT_DIRECTORY,
  );
  const threadSnapshots = new OrderedExactThreadSnapshotReader([
    activeThreadSnapshots,
    new FileExactThreadSnapshotDirectory(
      options.projectBaselineDirectory ?? DEFAULT_PROJECT_BASELINE_DIRECTORY,
    ),
  ]);
  const build123dThreadSnapshots = {
    // Reads and lineage checks may cross into the configured immutable
    // baseline. Writes and fresh ACK-loss rereads remain owned by the active
    // append-only store; the fallback handles an exact read-only basis only.
    get: (snapshotId: string) => threadSnapshots.get(snapshotId),
    latest: (subjectId: string) => activeThreadSnapshots.latest(subjectId),
    save: (snapshot: Parameters<typeof activeThreadSnapshots.save>[0]) =>
      activeThreadSnapshots.save(snapshot),
    getFresh: async (snapshotId: string) =>
      await activeThreadSnapshots.getFresh(snapshotId) ??
        await threadSnapshots.get(snapshotId),
  };
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: options.approvedBriefCaptureDirectory ??
      DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY,
  });
  const briefSourceCaptures = new FileCaptureStore({
    ...BRIEF_SOURCE_CAPTURE_DESCRIPTOR,
    directory: options.briefSourceCaptureDirectory ??
      BRIEF_SOURCE_CAPTURE_DESCRIPTOR.directory,
  });
  const sourceAnalysisCaptures = new FileCaptureStore({
    ...SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
    directory: options.sourceAnalysisCaptureDirectory ??
      SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR.directory,
  });
  const briefSourceAnalysisFrontends = new FixedSourceAnalysisFrontendRegistry([{
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
    frontend: new ProjectBriefSourceAnalyzer(),
  }]);
  const briefSourceAnalysis = new BriefSourceAnalysisCaptureService({
    sourceCaptures: briefSourceCaptures,
    analysisCaptures: sourceAnalysisCaptures,
    frontends: briefSourceAnalysisFrontends,
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
  });
  const liveUpdates = new FileLiveThreadUpdateStore(
    options.liveThreadUpdateDirectory ?? DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY,
  );
  const lease = new FileEngineeringProjectRunLease(
    options.engineeringProjectRunLeaseDirectory ??
      DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY,
  );
  // This closed local store family is composed before the command runtime so
  // queueRun can seal a ROP2 reference atomically with its project revision.
  // Constructing MCP clients/readers later is inert: no provider I/O happens
  // until each executor has admitted its exact queued run and source bytes.
  const recordedAnalysisDirectory = options.recordedAnalysisDirectory ??
    DEFAULT_RECORDED_ANALYSIS_DIRECTORY;

  const architectureFoundation = createArchitectureFoundation({
    recordedAnalysisDirectory,
    sourceAnalysisCaptures,
    sysmlSourceCaptureDirectory: options.sysmlSourceCaptureDirectory ??
      SYSML_SOURCE_CAPTURE_DESCRIPTOR.directory,
    sysonModelSeedCaptureDirectory: options.sysonModelSeedCaptureDirectory ??
      DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY,
    architectureCaptureDirectory: options.architectureCaptureDirectory ??
      DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY,
    requirementsCaptureDirectory: options.requirementsCaptureDirectory ??
      DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY,
  });
  const compilationFoundation = createTechnicalCompilationFoundation({
    recordedAnalysisDirectory,
    snapshots: build123dThreadSnapshots,
  });

  const build123dCapability = await createBuild123dCapability({
    build123dExecution: options.build123dExecution,
    recordedAnalysisDirectory,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    snapshots: build123dThreadSnapshots,
  });
  const qualifiedModelica = await createQualifiedModelicaCapability({
    modelicaIsolatedExecution: options.modelicaIsolatedExecution,
    recordedAnalysisDirectory,
    qualificationRoot: LOCAL_MODELICA_QUALIFICATION_ROOT,
    qualificationCaptureFingerprint: LOCAL_MODELICA_QUALIFICATION_CAPTURE_FINGERPRINT,
  });
  const admittedModelica = await createAdmittedModelicaCapability({
    admittedModelicaExecution: options.admittedModelicaExecution,
    recordedAnalysisDirectory,
  });
  const calculixCapability = await createCalculixCapability({
    calculixIsolatedExecution: options.calculixIsolatedExecution,
    recordedAnalysisDirectory,
  });

  const feaFoundation = createFeaFoundation();
  const recordedPlans = createRecordedOperationPlanComposition({
    snapshots: threadSnapshots,
    feaProofCaptures: feaFoundation.feaProofCaptures,
    sensitivityCatalogOfferCaptures:
      feaFoundation.sensitivityCatalogOfferCaptures,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    calculixLocalProfile: calculixCapability.localProfile,
    recordedAnalysisDirectory,
    canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
  });

  const activeProjectDirectory = options.activeProjectDirectory ??
    DEFAULT_ACTIVE_PROJECT_DIRECTORY;
  const runtime = await createEngineeringProjectCommandRuntime({
    projectId: options.projectId,
    trackedManifestPath: options.projectPath,
    activeDirectory: activeProjectDirectory,
    evidenceSnapshots: threadSnapshots,
    planning: {
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
      runPlanSealer: recordedPlans.recordedRunPlans,
    },
    initialEvidenceValidator: new ExactInitialBaselineEvidenceValidator(
      activeThreadSnapshots,
      captures,
      {
        sourceCaptures: briefSourceCaptures,
        analysisCaptures: sourceAnalysisCaptures,
        frontends: briefSourceAnalysisFrontends,
      },
    ),
  });

  const architectureProject = createArchitectureProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    liveUpdates,
    sysonMcpUrl,
    foundation: architectureFoundation,
    sysonModelSeedAttemptDirectory: options.sysonModelSeedAttemptDirectory ??
      DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY,
    architectureAttemptDirectory: options.architectureAttemptDirectory ??
      DEFAULT_ARCHITECTURE_ATTEMPT_DIRECTORY,
    partDefinitionsCaptureDirectory: options.partDefinitionsCaptureDirectory ??
      DEFAULT_PART_DEFINITIONS_CAPTURE_DIRECTORY,
    partDefinitionsPublicationDirectory:
      options.partDefinitionsPublicationDirectory ??
        DEFAULT_PART_DEFINITIONS_PUBLICATION_DIRECTORY,
    requirementsAttemptDirectory: options.requirementsAttemptDirectory ??
      DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY,
  });
  const compilationProject = createTechnicalCompilationProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    foundation: compilationFoundation,
    architectureCaptures: architectureFoundation.genericArchitectureCaptures,
    seedCaptures: architectureFoundation.sysonModelSeedCaptures,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
  });
  const thermalJoin = createModelicaThermalMethodSheetJoin({
    recordedAnalysisDirectory,
    snapshots: activeThreadSnapshots,
  });
  const technicalCompilationPreview = createTechnicalCompilationPreview({
    foundation: compilationFoundation,
    basisResolver: compilationProject.technicalCompilationBasis,
    projects: runtime.projects,
    methodSheets: thermalJoin.thermalMethodSheetCompilationJoin,
  });

  const cadProject = createCadProject({
    projects: runtime.projects,
    commands: runtime.commands,
    executionSnapshots: build123dThreadSnapshots,
    writeSnapshots: activeThreadSnapshots,
    lease,
    capability: build123dCapability,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    recordedAnalysisDirectory,
    sourceAnalysisCaptures,
    architectureCaptures: architectureFoundation.genericArchitectureCaptures,
    sysmlSourceAnalysis: architectureFoundation.sysmlSourceAnalysis,
    geometryDraftCaptureDirectory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
    geometryCaptureDirectory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
  });
  const modelicaProject = createModelicaProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    executionSnapshots: build123dThreadSnapshots,
    planSnapshots: threadSnapshots,
    lease,
    recordedAnalysisDirectory,
    sysonMcpUrl,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    basisResolver: compilationProject.technicalCompilationBasis,
    technicalSourceAnalysisCaptures:
      compilationFoundation.technicalSourceAnalysisCaptures,
    thermal: thermalJoin,
    qualified: qualifiedModelica,
    admitted: admittedModelica,
  });
  const impactProject = createCrossDomainImpactProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    recordedAnalysisDirectory,
  });
  const feaProject = createFeaProject({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    foundation: feaFoundation,
    requirementsCaptures: architectureFoundation.requirementsCaptures,
    seedCaptures: architectureFoundation.sysonModelSeedCaptures,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    recordedPlanResolver: recordedPlans.recordedPlanResolver,
    recordedRunPlans: recordedPlans.recordedRunPlans,
    recordedAnalysisCas: recordedPlans.recordedAnalysisCas,
    calculix: calculixCapability,
    sysonMcpUrl,
    recordedAnalysisDirectory,
    canonicalAssetDirectory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
  });
  const sensitivity = createSensitivityComposition({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
    admissions: compilationFoundation.technicalCompilationAdmissions,
    technicalCompilationPreview,
    technicalSourceCapture: compilationFoundation.technicalSourceCapture,
    feaProofCaptures: feaFoundation.feaProofCaptures,
    sensitivityCatalogOfferCaptures:
      feaFoundation.sensitivityCatalogOfferCaptures,
    sysonModelSeedCaptures: architectureFoundation.sysonModelSeedCaptures,
    build123dExecution: build123dCapability.build123dExecution,
    calculixMcpUrl,
    sysonMcpUrl,
    sensitivityStepCacheDirectory: DEFAULT_SENSITIVITY_STEP_CACHE_DIRECTORY,
  });
  const electrical = createLedDriverSourceComposition({
    recordedAnalysisDirectory,
  });

  const baseline = new ApprovedBriefBaselineRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    captures,
    briefSourceAnalysis,
    briefSourceCaptures,
    sourceAnalysisCaptures,
    briefSourceAnalysisFrontends,
    snapshots: activeThreadSnapshots,
    lease,
    liveUpdates,
  });
  const inspectionDroneV4Architecture = sysonMcpUrl
    ? new InspectionDroneV4ArchitectureRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: architectureFoundation.sysonModelSeedCaptures,
      captures: new FileCaptureStore({
        ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.inspectionDroneV4ArchitectureCaptureDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      attempts: new FileInspectionDroneV4ArchitectureAttemptStore(
        options.inspectionDroneV4ArchitectureAttemptDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const inspectionDroneV4PartDefinitions = sysonMcpUrl
    ? new InspectionDroneV4PartDefinitionsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: new FileCaptureStore({
        ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.inspectionDroneV4ArchitectureCaptureDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      captures: new FileCaptureStore({
        ...INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
        directory: options.inspectionDroneV4PartDefinitionsCaptureDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DIRECTORY,
      }),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      publications: new FileInspectionDroneV4PartDefinitionsPublicationStore(
        options.inspectionDroneV4PartDefinitionsPublicationDirectory ??
          DEFAULT_INSPECTION_DRONE_V4_PART_DEFINITIONS_PUBLICATION_DIRECTORY,
      ),
    })
    : undefined;
  // Generic archive-lineage requires no provider — always available.
  const genericArchiveLineage = new ArchiveLineageRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
  });
  // Reconcile-uncertain-writer requires no provider — always available.
  // Human-only: the executor gate rejects any non-human origin.
  const genericReconcileUncertainWriter = new ReconcileUncertainWriterRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
  });
  const printabilityCaseCaptures = new FileCaptureStore({
    ...PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
    directory: options.printabilityCaseCaptureDirectory ??
      DEFAULT_PRINTABILITY_CASE_CAPTURE_DIRECTORY,
  });
  const printabilityObservationCaptures = new FileCaptureStore({
    ...PRINTABILITY_OBSERVATION_CAPTURE_DESCRIPTOR,
    directory: options.printabilityObservationCaptureDirectory ??
      DEFAULT_PRINTABILITY_OBSERVATION_CAPTURE_DIRECTORY,
  });
  const printEstimateCaseCaptures = new FileCaptureStore({
    ...PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
    directory: options.printEstimateCaseCaptureDirectory ??
      DEFAULT_PRINT_ESTIMATE_CASE_CAPTURE_DIRECTORY,
  });
  const printEstimateObservationCaptures = new FileCaptureStore({
    ...PRINT_ESTIMATE_OBSERVATION_CAPTURE_DESCRIPTOR,
    directory: options.printEstimateObservationCaptureDirectory ??
      DEFAULT_PRINT_ESTIMATE_OBSERVATION_CAPTURE_DIRECTORY,
  });
  const industrializeSealPrintabilityCase =
    new IndustrializeSealPrintabilityCaseRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      captures: printabilityCaseCaptures,
      lease,
    });
  const industrializeObservePrintability = dfmMcpUrl
    ? new IndustrializeObservePrintabilityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: printabilityCaseCaptures,
      observationCaptures: printabilityObservationCaptures,
      geometryAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      stager: new ExportVolumeGeometryStager(DEFAULT_PRINTABILITY_EXPORT_DIRECTORY),
      dfm: new HttpMcpToolClient({ mcpUrl: dfmMcpUrl, timeoutMs: 120_000 }),
      attempts: new FilePrintabilityAttemptStore(
        options.printabilityAttemptDirectory ?? DEFAULT_PRINTABILITY_ATTEMPT_DIRECTORY,
      ),
      lease,
    })
    : undefined;
  const industrializeSealPrintEstimateCase =
    new IndustrializeSealPrintEstimateCaseRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      captures: printEstimateCaseCaptures,
      lease,
    });
  const dfmCaseCaptures = new FileCaptureStore({
    ...DFM_CASE_CAPTURE_DESCRIPTOR,
    directory: options.dfmCaseCaptureDirectory ?? DEFAULT_DFM_CASE_CAPTURE_DIRECTORY,
  });
  const dfmCheckCaptures = new FileCaptureStore({
    ...DFM_CHECK_CAPTURE_DESCRIPTOR,
    directory: options.dfmCheckCaptureDirectory ?? DEFAULT_DFM_CHECK_CAPTURE_DIRECTORY,
  });
  const industrializeSealDfmCase = new IndustrializeSealDfmCaseRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    captures: dfmCaseCaptures,
    lease,
  });
  const industrializeRunDfmChecks = dfmMcpUrl
    ? new IndustrializeRunDfmChecksRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: dfmCaseCaptures,
      checkCaptures: dfmCheckCaptures,
      geometryAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
      }),
      stager: new ExportVolumeGeometryStager(DEFAULT_DFM_EXPORT_DIRECTORY),
      dfm: new HttpMcpToolClient({ mcpUrl: dfmMcpUrl, timeoutMs: 120_000 }),
      attempts: new FileDfmCheckAttemptStore(
        options.dfmCheckAttemptDirectory ?? DEFAULT_DFM_CHECK_ATTEMPT_DIRECTORY,
      ),
      lease,
    })
    : undefined;
  const industrializeObservePrintEstimate = prusaslicerMcpUrl
    ? new IndustrializeObservePrintEstimateRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      caseCaptures: printEstimateCaseCaptures,
      observationCaptures: printEstimateObservationCaptures,
      geometryAssets: new FileCanonicalAssetReader({
        directory: DEFAULT_CANONICAL_ASSET_DIRECTORY,
        extension: "stl",
      }),
      stager: new ExportVolumeGeometryStager(DEFAULT_PRINT_ESTIMATE_EXPORT_DIRECTORY),
      prusaslicer: new HttpMcpToolClient({
        mcpUrl: prusaslicerMcpUrl,
        timeoutMs: 180_000,
      }),
      attempts: new FilePrintEstimateAttemptStore(
        options.printEstimateAttemptDirectory ??
          DEFAULT_PRINT_ESTIMATE_ATTEMPT_DIRECTORY,
      ),
      lease,
    })
    : undefined;
  return {
    brief: {
      projects: runtime.projects,
      commands: new ProjectBriefCommandService(runtime.projects),
    },
    control: {
      projects: runtime.projects,
      commands: runtime.commands,
      threadSnapshots,
      // The same CAS-backed object seals at queue time and reads through the
      // agent-visible plan inspection tool. No alternate plan authority is
      // composed for execution or control-plane reads.
      runPlanReader: recordedPlans.recordedRunPlans,
      technicalSourceCapture: compilationFoundation.technicalSourceCapture,
      technicalCompilationPreview,
      architectureSysmlSourceCapture:
        architectureFoundation.architectureSysmlSourceCapture,
      architectureSysmlPreview: architectureFoundation.architectureSysmlPreview,
      briefArchitectureReview: architectureProject.briefArchitectureReview,
      briefRequirementsReview: architectureProject.briefRequirementsReview,
      feaProofSealReview: feaProject.feaProofSealReview,
      feaIsolatedRunReview: feaProject.feaIsolatedRunReview,
      evaluationCloseoutReview:
        feaProject.staticMechanicalEvaluationCloseoutReview,
      sensitivityStudySealReview: sensitivity.sensitivityStudySealReview,
      build123dExecutionReview: build123dCapability.build123dExecutionReview,
      isolatedGeometrySealReview: build123dCapability.isolatedGeometrySealReview,
      vectorCorrectionReview: sensitivity.vectorCorrectionReview,
      sensitivityBaseEvaluationReview: sensitivity.sensitivityBaseEvaluationReview,
      correctedAdmissionReview: sensitivity.correctedAdmissionReview,
      modelicaQualifiedKitRunReview: modelicaProject.modelicaQualifiedKitRunReview,
      admittedModelicaRunReview: modelicaProject.admittedModelicaRunReview,
      admittedModelicaEvaluationReview:
        modelicaProject.admittedModelicaEvaluationReview,
      thermalMethodSheetSealReview: modelicaProject.thermalMethodSheetSealReview,
      crossDomainImpactManifestSealReview:
        impactProject.crossDomainImpactManifestSealReview,
      crossDomainImpactDecisionReview:
        impactProject.crossDomainImpactDecisionReview,
      ledDriverSourceCapture: electrical.ledDriverSourceCapture,
      ledDriverSourceReview: electrical.ledDriverSourceReview,
      ...composePrivateBuild123dGeometrySurfaces(
        build123dSandboxMcpUrl,
        cadProject.geometrySourceAnalysis,
        compilationFoundation.technicalCompilationAdmissions,
        threadSnapshots,
        architectureFoundation.genericArchitectureCaptures,
        DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
        DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
      ),
      runExecutor: new RegisteredProjectRunExecutor({
        projects: runtime.projects,
        baseline,
        sysonModelSeed: architectureProject.sysonModelSeed,
        additional: [
          {
            operation: COMPILE_SEAL_ADMISSION_OPERATION,
            executor: compilationProject.compileSealAdmission,
          },
          {
            operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
            executor: architectureProject.modelSealArchitectureSysml,
          },
          {
            operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
            executor: cadProject.designExecuteBuild123d,
            unavailableMessage:
              "The server has no complete qualified Build123d isolated runtime configured for this run.",
          },
          {
            operation: DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
            executor: cadProject.designSealIsolatedGeometry,
          },
          {
            operation: VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
            executor: modelicaProject.verifySealModelicaThermalMethodSheet,
          },
          {
            operation: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
            executor: impactProject.verifySealCrossDomainImpactManifest,
          },
          {
            operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
            executor: impactProject.analyzeEvaluateCrossDomainImpact,
          },
          {
            operation: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
            executor: impactProject.decideAcceptCrossDomainImpact,
          },
          {
            operation: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
            executor: modelicaProject.verifyEvaluateAdmittedModelicaObservations,
            unavailableMessage:
              "The server has no trusted verify.evaluate-admitted-modelica-observations@1 executor configured for this run (SysON provider is required).",
          },
          {
            operation: DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
            executor: modelicaProject.decideAdmittedModelicaEvaluation,
          },
          {
            operation: DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
            executor: modelicaProject.decideAdmittedModelicaEvaluation,
          },
          {
            operation: DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
            executor: feaProject.decideStaticMechanicalEvaluationCloseout,
          },
          {
            operation: DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
            executor: feaProject.decideStaticMechanicalEvaluationCloseout,
          },
          {
            operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
            executor: modelicaProject.simulateRunQualifiedModelicaKit,
            unavailableMessage:
              "The server has no complete qualified local Modelica runtime and pinned qualification configured for this run.",
          },
          {
            operation: SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
            executor: modelicaProject.simulateRunAdmittedModelica,
            unavailableMessage:
              "The server has no admitted Modelica closed-subset isolated runtime configured for this run.",
          },
          {
            operation: INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
            executor: inspectionDroneV4Architecture,
            unavailableMessage:
              "The server has no trusted inspection-drone V4 SysON architecture executor configured for this run.",
          },
          {
            operation: INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
            executor: inspectionDroneV4PartDefinitions,
            unavailableMessage:
              "The server has no trusted inspection-drone V4 PartDefinitions executor configured for this run.",
          },
          {
            operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
            executor: architectureProject.genericModelWriteArchitecture,
            unavailableMessage:
              "The server has no trusted generic model.write-architecture@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
            executor: architectureProject.genericModelCapturePartDefinitions,
            unavailableMessage:
              "The server has no trusted generic model.capture-part-definitions@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: DESIGN_WRITE_GEOMETRY_OPERATION,
            executor: cadProject.genericDesignWriteGeometry,
          },
          {
            operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
            executor: architectureProject.genericModelWriteRequirements,
            unavailableMessage:
              "The server has no trusted generic model.write-requirements@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: ARCHIVE_LINEAGE_OPERATION,
            executor: genericArchiveLineage,
          },
          {
            operation: RECONCILE_UNCERTAIN_WRITER_OPERATION,
            executor: genericReconcileUncertainWriter,
          },
          {
            operation: VERIFY_SEAL_PROOF_CASE_OPERATION,
            executor: feaProject.genericVerifySealProofCase,
          },
          {
            operation: VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
            executor: feaProject.isolatedCalculixRun,
            unavailableMessage:
              "The server has no complete qualified local CalculiX runtime and SysON oracle configured for this run.",
          },
          {
            operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
            executor: sensitivity.analyzeSealSensitivityStudy,
          },
          {
            operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
            executor: sensitivity.analyzeRunFeaSensitivity,
            unavailableMessage:
              "The server has no trusted analyze.run-fea-sensitivity@1 executor " +
              "configured for this run (isolated Build123d and CalculiX are required).",
          },
          {
            operation: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
            executor: sensitivity.modelWriteSensitivityEdges,
            unavailableMessage:
              "The server has no trusted model.write-sensitivity-edges@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
            executor: sensitivity.verifyEvaluateSensitivityBase,
            unavailableMessage:
              "The server has no trusted verify.evaluate-sensitivity-base@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
            executor: industrializeSealPrintabilityCase,
          },
          {
            operation: INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
            executor: industrializeObservePrintability,
            unavailableMessage:
              "The server has no trusted industrialize.observe-printability@1 executor " +
              "configured for this run (dfm provider is required).",
          },
          {
            operation: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
            executor: industrializeSealPrintEstimateCase,
          },
          {
            operation: INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
            executor: industrializeObservePrintEstimate,
            unavailableMessage:
              "The server has no trusted industrialize.observe-print-estimate@1 executor " +
              "configured for this run (prusaslicer provider is required).",
          },
          {
            operation: INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
            executor: industrializeSealDfmCase,
          },
          {
            operation: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
            executor: industrializeRunDfmChecks,
            unavailableMessage:
              "The server has no trusted industrialize.run-dfm-checks@1 executor " +
              "configured for this run (dfm provider is required).",
          },
          {
            operation: DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
            executor: sensitivity.designApplyVectorCorrection,
          },
          {
            operation: COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION,
            executor: sensitivity.compileCaptureCorrectedSource,
          },
        ],
      }),
    },
  };
}

function createCockpitFocus(
  options: CreateConsoleServerOptions,
): CockpitFocusToolDependencies {
  return {
    focus: new FileCockpitFocusStore(
      options.cockpitFocusDirectory ?? DEFAULT_COCKPIT_FOCUS_DIRECTORY,
    ),
    projects: new FileEngineeringProjectRevisionStore(
      options.activeProjectDirectory ?? DEFAULT_ACTIVE_PROJECT_DIRECTORY,
    ),
  };
}

if (import.meta.main) {
  const cli = parseConsoleCli(Deno.args);
  const port = cli.port ?? integerEnv("MCP_PORT") ?? DEFAULT_PORT;
  const hostname = cli.hostname ?? env("MCP_HOSTNAME") ?? DEFAULT_HOSTNAME;
  const projectToolsEnabled = isExplicitLoopbackHostname(hostname);
  const approvalMode = approvalModeForBinding(cli.yolo === true, hostname);
  const localExecution = localExecutionForBinding(
    cli.localExecution === true,
    hostname,
  );
  const { app } = await createConsoleServer({
    projectControl: projectToolsEnabled ? undefined : false,
    approvalMode,
    build123dExecution: localExecution
      ? await createLocalBuild123dExecutionServerOptions()
      : undefined,
    modelicaIsolatedExecution: localExecution
      ? await createLocalModelicaIsolatedExecutionServerOptions()
      : undefined,
    admittedModelicaExecution: localExecution
      ? await createLocalAdmittedModelicaExecutionServerOptions()
      : undefined,
    calculixIsolatedExecution: localExecution
      ? await createLocalCalculixIsolatedExecutionServerOptions()
      : undefined,
  });
  const http = await app.startHttp({
    port,
    hostname,
    corsOrigins: ["http://127.0.0.1", "http://localhost"],
    onListen: ({ hostname: boundHostname, port: boundPort }) => {
      console.error(
        `Casys digital-thread console: http://${boundHostname}:${boundPort}/mcp`,
      );
      if (approvalMode.kind === "local-yolo") {
        console.error(
          "YOLO ACTIVE: positive brief confirmations and MRTR decision approvals are auto-approved under human/local-yolo:startup-opt-in.",
        );
      }
      if (localExecution) {
        console.error(
          `LOCAL EXECUTION ACTIVE: qualified Build123d, Modelica kit, admitted Modelica, and CalculiX runs use ${LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE}, ${LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE}, and ${LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE} through the attached local Microsandbox backend; CalculiX publication still requires the SysON oracle.`,
        );
      }
      if (!projectToolsEnabled) {
        console.error(
          "Project mutation tools disabled: non-loopback MCP binding exposes the read-only fleet console only.",
        );
      }
    },
  });
  installGracefulHttpShutdown(http, {
    onError(error, context) {
      console.error(
        `Casys digital-thread console ${context.phase} failed after ${
          context.signal ?? "listener disposal"
        } signal handling:`,
        error,
      );
    },
  });
}

export interface ConsoleCliOptions {
  port?: number;
  hostname?: string;
  yolo?: true;
  localExecution?: true;
}

export function parseConsoleCli(args: string[]): ConsoleCliOptions {
  const result: ConsoleCliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--stdio") {
      throw new TypeError("--stdio is not supported; use stateless HTTP on /mcp.");
    } else if (argument === "--yolo") {
      result.yolo = true;
    } else if (argument === "--local-execution") {
      result.localExecution = true;
    } else if (argument.startsWith("--port=")) {
      result.port = positiveInteger(argument.slice("--port=".length), "--port");
    } else if (argument === "--port") {
      result.port = positiveInteger(args[++index], "--port");
    } else if (argument.startsWith("--hostname=")) {
      result.hostname = argument.slice("--hostname=".length);
    } else if (argument === "--hostname") {
      const hostname = args[++index];
      if (hostname === undefined) {
        throw new TypeError("--hostname requires a value");
      }
      result.hostname = hostname;
    } else {
      throw new TypeError(`Unknown console argument: ${argument}`);
    }
  }
  if (result.hostname !== undefined && result.hostname.trim() === "") {
    throw new TypeError("--hostname must not be empty");
  }
  return result;
}

/**
 * Code-owned product binding for the only qualified local Build123d runtime.
 * No environment value or CLI argument can select its image, policy, limits,
 * command, network, lifecycle, or backend.
 */
export async function createLocalBuild123dExecutionServerOptions(): Promise<
  Build123dExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "build123d-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_BUILD123D_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_BUILD123D_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}

/**
 * Code-owned product binding for the only qualified local Modelica runtime.
 * The separately persisted qualification capture is intentionally not part of
 * this option: review and execution reopen it through the pinned authority.
 */
export async function createLocalModelicaIsolatedExecutionServerOptions(): Promise<
  ModelicaIsolatedExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "modelica-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_MODELICA_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_MODELICA_EXECUTION_LIMITS,
      engine: Object.freeze({
        name: "OpenModelica" as const,
        version: "1.27.0",
        mslVersion: "4.1.0",
      }),
    }),
    runtime: Object.freeze({}),
  });
}

/** Code-owned binding for admitted Modelica closed-subset execution. */
export async function createLocalAdmittedModelicaExecutionServerOptions(): Promise<
  AdmittedModelicaExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "modelica-admitted-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_ADMITTED_MODELICA_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE,
      policy,
      limits: LOCAL_MODELICA_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}

/** Code-owned binding for the qualified local CalculiX microVM profile. */
export async function createLocalCalculixIsolatedExecutionServerOptions(): Promise<
  CalculixIsolatedExecutionServerOptions
> {
  const policy = Object.freeze({
    id: "calculix-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      LOCAL_CALCULIX_EXECUTION_POLICY_BODY,
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference: LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
      wrapperSha256: LOCAL_CALCULIX_WRAPPER_SHA256,
      policy,
      limits: LOCAL_CALCULIX_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}

/** Mandatory bind guard for every network-facing composition using local YOLO. */
export function approvalModeForBinding(
  yolo: boolean,
  hostname: string,
): ProjectApprovalMode {
  if (yolo && !isExplicitLoopbackHostname(hostname)) {
    throw new TypeError(
      "--yolo is restricted to an explicit loopback MCP hostname.",
    );
  }
  return yolo ? LOCAL_YOLO_PROJECT_APPROVAL_MODE : INTERACTIVE_PROJECT_APPROVAL_MODE;
}

/** Native local execution is never composed on a remotely reachable bind. */
export function localExecutionForBinding(
  requested: boolean,
  hostname: string,
): boolean {
  if (requested && !isExplicitLoopbackHostname(hostname)) {
    throw new TypeError(
      "--local-execution is restricted to an explicit loopback MCP hostname.",
    );
  }
  return requested;
}

function integerEnv(name: string): number | undefined {
  const value = env(name);
  return value === undefined ? undefined : positiveInteger(value, name);
}

function positiveInteger(
  value: string | undefined,
  name: string,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function ephemeralMrtrSigningKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
