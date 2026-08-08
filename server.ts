import { McpApp } from "@casys/mcp-server";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/docker-observer.ts";
import { HttpMcpProbe, type McpProbe } from "./src/adapters/mcp/http-mcp-probe.ts";
import { HttpMcpToolClient } from "./src/adapters/mcp/http-mcp-tool-client.ts";
import { loadFleetManifest } from "./src/adapters/manifest.ts";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./src/adapters/loopback-host.ts";
import { FileThreadSnapshotStore } from "./src/adapters/stores/file-thread-snapshot-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
  CM01_DRIP_TRAY_PRINT_ESTIMATE_CAPTURE_DESCRIPTOR,
  CM01_DRIP_TRAY_PRINTABILITY_CAPTURE_DESCRIPTOR,
  CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
  CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
  CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "./src/adapters/captures/file-capture-store.ts";
import { FileSensitivityRunAttemptStore } from "./src/adapters/wal/file-sensitivity-run-attempt-store.ts";
import { FileCm01DripTrayPrintabilityAttemptStore } from "./src/adapters/wal/file-cm01-drip-tray-printability-attempt-store.ts";
import { FileCm01DripTrayPrintEstimateAttemptStore } from "./src/adapters/wal/file-cm01-drip-tray-print-estimate-attempt-store.ts";
import { FileSysonModelSeedAttemptStore } from "./src/adapters/wal/file-syson-model-seed-attempt-store.ts";
import { FileCm01NominalModelicaAttemptStore } from "./src/adapters/wal/file-cm01-nominal-modelica-attempt-store.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "./src/adapters/wal/file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import { FileInspectionDroneV4ArchitectureAttemptStore } from "./src/adapters/wal/file-inspection-drone-v4-architecture-attempt-store.ts";
import { FileArchitectureAttemptStore } from "./src/adapters/wal/file-architecture-attempt-store.ts";
import { FileCm01ErpNextBomRunCaptureStore } from "./src/adapters/captures/file-cm01-erpnext-bom-run-capture-store.ts";
import { FileCm01SemanticCadAttemptStore } from "./src/adapters/wal/file-cm01-semantic-cad-attempt-store.ts";
import { FileCm01DripTrayMechanicalAttemptStore } from "./src/adapters/wal/file-cm01-drip-tray-mechanical-attempt-store.ts";
import { FileOracleRequirementsSeedAttemptStore } from "./src/adapters/wal/file-oracle-requirements-seed-attempt-store.ts";
import { FileSensitivityRelationsAttemptStore } from "./src/adapters/wal/file-sensitivity-relations-attempt-store.ts";
import {
  COFFEE_MACHINE_CM01_V3_ORACLE_REQUIREMENTS_OPERATION,
  CoffeeMachineCm01V3OracleRequirementsRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-oracle-requirements-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_SENSITIVITY_RELATIONS_OPERATION,
  CoffeeMachineCm01V3SensitivityRelationsRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-sensitivity-relations-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_SENSITIVITY_EDGES_OPERATION,
  CoffeeMachineCm01V3SensitivityEdgesRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-sensitivity-edges-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_PART_DEFINITIONS_OPERATION,
  CoffeeMachineCm01V3PartDefinitionsRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-part-definitions-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_ARCHIVE_LINEAGE_OPERATION,
  CoffeeMachineCm01V3ArchiveLineageRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-archive-lineage-run-executor.ts";
import { Cm01DripTrayMechanicalR3CaptureRecovery } from "./src/adapters/captures/cm01-drip-tray-mechanical-r3-capture-recovery.ts";
import {
  COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_OPERATION,
  CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-r3-identity-recovery-run-executor.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./src/adapters/executors/approved-brief-baseline-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./src/adapters/executors/syson-model-seed-run-executor.ts";
import { InspectionDroneV4ArchitectureRunExecutor } from "./src/adapters/executors/inspection-drone-v4-architecture-run-executor.ts";
import { InspectionDroneV4PartDefinitionsRunExecutor } from "./src/adapters/executors/inspection-drone-v4-part-definitions-run-executor.ts";
import { FileInspectionDroneV4PartDefinitionsPublicationStore } from "./src/adapters/wal/file-inspection-drone-v4-part-definitions-publication-store.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
} from "./src/orchestration/operations/inspection-drone-v4.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  ModelWriteArchitectureRunExecutor,
} from "./src/adapters/executors/model-write-architecture-run-executor.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  DesignWriteGeometryRunExecutor,
} from "./src/adapters/executors/design-write-geometry-run-executor.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  ModelWriteRequirementsRunExecutor,
} from "./src/adapters/executors/model-write-requirements-run-executor.ts";
import { FileRequirementsAttemptStore } from "./src/adapters/wal/file-requirements-attempt-store.ts";
import { REQUIREMENTS_CAPTURE_DESCRIPTOR } from "./src/adapters/captures/file-capture-store.ts";
import { Cm01NominalModelicaCaptureAdapter } from "./src/adapters/captures/cm01-nominal-modelica-capture.ts";
import {
  COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION,
  CoffeeMachineCm01V3ThermalRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-thermal-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_OPERATION,
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-architecture-run-executor.ts";
import { Cm01ErpNextBomCaptureAdapter } from "./src/adapters/captures/cm01-erpnext-bom-capture.ts";
import {
  COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION,
  CoffeeMachineCm01V3ErpNextBomRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-erpnext-bom-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_OPERATION,
  CoffeeMachineCm01V3CadRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-cad-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION,
  CoffeeMachineCm01V3MechanicalRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-mechanical-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION,
  CoffeeMachineCm01V3SensitivityRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-sensitivity-run-executor.ts";
import { validateSensitivityStudyCase } from "./src/domain/analysis/sensitivity-study.ts";
import {
  COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION,
  CoffeeMachineCm01V3PrintabilityRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-printability-run-executor.ts";
import { validatePrintabilityCheckCase } from "./src/domain/analysis/printability-case.ts";
import {
  COFFEE_MACHINE_CM01_V3_PRINT_ESTIMATE_OPERATION,
  CoffeeMachineCm01V3PrintEstimateRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-print-estimate-run-executor.ts";
import { validatePrintEstimateCase } from "./src/domain/analysis/print-estimate-case.ts";
import {
  COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION,
  CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-drip-tray-height-correction-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_R2_OPERATION,
  COFFEE_MACHINE_CM01_V3_MECHANICAL_R2_OPERATION,
  COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_OPERATION,
  CoffeeMachineCm01V3CadR2RunExecutor,
  CoffeeMachineCm01V3MechanicalR2RunExecutor,
  CoffeeMachineCm01V3MechanicalR3RunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-r2-provider-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION,
  CoffeeMachineCm01V3CadR3RunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-cad-r3-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION,
  CoffeeMachineCm01V3CadR4RunExecutor,
} from "./src/adapters/executors/cm01/coffee-machine-cm01-v3-cad-r4-run-executor.ts";
import { DockerVolumeAssetMaterializer } from "./src/adapters/executors/host-asset-materializer.ts";
import { RegisteredProjectRunExecutor } from "./src/adapters/registered-project-run-executor.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/stores/live-thread-update-store.ts";
import { FileEngineeringProjectRevisionStore } from "./src/adapters/stores/engineering-project-store.ts";
import {
  CockpitFocusConflictError,
  FileCockpitFocusStore,
} from "./src/adapters/stores/file-cockpit-focus-store.ts";
import { createEngineeringProjectCommandRuntime } from "./src/adapters/engineering-project-command-runtime.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./src/adapters/stores/engineering-thread-snapshot-resolver.ts";
import { ModelicaRunObserver } from "./src/adapters/historical/modelica-run-observer.ts";
import { loadRunFixtures } from "./src/adapters/run-fixtures.ts";
import { ScenarioContractVerifier } from "./src/adapters/validators/scenario-contract-verifier.ts";
import { ScenarioVerifiedRunCatalog } from "./src/adapters/validators/scenario-verified-run-catalog.ts";
import { ControlPlane } from "./src/domain/platform/control-plane.ts";
import { EngineeringProjectCommandError } from "./src/domain/project/engineering-project-command-service.ts";
import {
  parseCoffeeMachineCm01SemanticRecipe,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "./src/domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import {
  parseCm01DripTrayMechanicalProof,
  parseCm01DripTrayMechanicalProofR2,
  parseCm01DripTrayMechanicalProofR3,
} from "./src/domain/cm01/cm01-drip-tray-mechanical-proof.ts";
import { ProjectBriefCommandService } from "./src/domain/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./src/orchestration/operations/registry.ts";
import type {
  FleetManifest,
  ObservedRunCatalog,
  RunDetail,
} from "./src/domain/kernel/types.ts";
import {
  CONSOLE_RESOURCE_URI,
  registerControlPlaneTools,
} from "./src/tools/register.ts";
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

const DEFAULT_PORT = 3020;
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_MANIFEST_PATH = "config/mcp-fleet.json";
const DEFAULT_RUN_FIXTURE_PATH = "state/fixtures/runs/bracket-demo.json";
const DEFAULT_SCENARIO_CONTRACT_PLAN_PATH =
  "config/verification-plans/coffee-machine-nominal-v1.json";
const DEFAULT_PROJECT_ID = "coffee-machine-cm01";
const DEFAULT_PROJECT_PATH = "config/projects/coffee-machine-cm01.project.json";
const DEFAULT_ACTIVE_PROJECT_DIRECTORY = "state/local/engineering-projects";
const DEFAULT_COCKPIT_FOCUS_DIRECTORY = "state/local/cockpit-focus";
const DEFAULT_THREAD_SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY = "state/local/live-thread-updates";
const DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY = "state/local/approved-brief-captures";
const DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY =
  "state/local/syson-model-seed-captures";
const DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY =
  "state/local/syson-model-seed-attempts";
const DEFAULT_CM01_NOMINAL_MODELICA_CAPTURE_DIRECTORY =
  "state/local/cm01-nominal-modelica-captures";
const DEFAULT_CM01_NOMINAL_MODELICA_ATTEMPT_DIRECTORY =
  "state/local/cm01-nominal-modelica-attempts";
const DEFAULT_CM01_ARCHITECTURE_CAPTURE_DIRECTORY =
  "state/local/coffee-machine-cm01-v3-architecture-captures";
const DEFAULT_CM01_ARCHITECTURE_ATTEMPT_DIRECTORY =
  "state/local/coffee-machine-cm01-v3-architecture-attempts";
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
const DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY = "state/local/geometry-draft-captures";
const DEFAULT_GEOMETRY_CAPTURE_DIRECTORY = "state/local/geometry-captures";
const DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY = "state/local/requirements-captures";
const DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY = "state/local/requirements-attempts";
const DEFAULT_CM01_ERPNEXT_BOM_CAPTURE_DIRECTORY =
  "state/local/cm01-erpnext-bom-captures";
const DEFAULT_CM01_ERPNEXT_BOM_RUN_CAPTURE_DIRECTORY =
  "state/local/cm01-erpnext-bom-run-captures";
const DEFAULT_CM01_SEMANTIC_CAD_ATTEMPT_DIRECTORY =
  "state/local/cm01-semantic-cad-attempts";
const DEFAULT_CM01_SEMANTIC_CAD_CAPTURE_DIRECTORY =
  "state/local/cm01-semantic-cad-captures";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_ATTEMPT_DIRECTORY =
  "state/local/cm01-drip-tray-mechanical-attempts";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DIRECTORY =
  "state/local/cm01-drip-tray-mechanical-captures";
const DEFAULT_CM01_SEMANTIC_CAD_R2_ATTEMPT_DIRECTORY =
  "state/local/cm01-semantic-cad-r2-attempts";
const DEFAULT_CM01_SEMANTIC_CAD_R2_CAPTURE_DIRECTORY =
  "state/local/cm01-semantic-cad-r2-captures";
const DEFAULT_CM01_SEMANTIC_CAD_R3_ATTEMPT_DIRECTORY =
  "state/local/cm01-semantic-cad-r3-attempts";
const DEFAULT_CM01_SEMANTIC_CAD_R3_CAPTURE_DIRECTORY =
  "state/local/cm01-semantic-cad-r3-captures";
const DEFAULT_CM01_SEMANTIC_CAD_R4_ATTEMPT_DIRECTORY =
  "state/local/cm01-semantic-cad-r4-attempts";
const DEFAULT_CM01_SEMANTIC_CAD_R4_CAPTURE_DIRECTORY =
  "state/local/cm01-semantic-cad-r4-captures";
const DEFAULT_CM01_SEMANTIC_CAD_R4_ASSET_DIRECTORY = "state/local/thread-assets";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R2_ATTEMPT_DIRECTORY =
  "state/local/cm01-drip-tray-mechanical-r2-attempts";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R2_CAPTURE_DIRECTORY =
  "state/local/cm01-drip-tray-mechanical-r2-captures";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R3_ATTEMPT_DIRECTORY =
  "state/local/cm01-drip-tray-mechanical-r3-attempts";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R3_CAPTURE_DIRECTORY =
  "state/local/cm01-drip-tray-mechanical-r3-captures";
const DEFAULT_ORACLE_REQUIREMENTS_SEED_ATTEMPT_DIRECTORY =
  "state/local/oracle-requirements-seed-attempts";
const DEFAULT_ORACLE_REQUIREMENTS_SEED_CAPTURE_DIRECTORY =
  "state/local/oracle-requirements-seed-captures";
const DEFAULT_SENSITIVITY_STUDY_CAPTURE_DIRECTORY =
  "state/local/sensitivity-study-captures";
const DEFAULT_SENSITIVITY_RUN_ATTEMPT_DIRECTORY =
  "state/local/sensitivity-run-attempts";
const DEFAULT_SENSITIVITY_RELATIONS_SEED_ATTEMPT_DIRECTORY =
  "state/local/sensitivity-relations-seed-attempts";
const DEFAULT_SENSITIVITY_RELATIONS_SEED_CAPTURE_DIRECTORY =
  "state/local/sensitivity-relations-seed-captures";
const DEFAULT_SENSITIVITY_EDGES_SEED_ATTEMPT_DIRECTORY =
  "state/local/sensitivity-edges-seed-attempts";
const DEFAULT_SENSITIVITY_EDGES_SEED_CAPTURE_DIRECTORY =
  "state/local/sensitivity-edges-seed-captures";
const DEFAULT_CM01_DRIP_TRAY_PRINTABILITY_CAPTURE_DIRECTORY =
  "state/local/cm01-drip-tray-printability-captures";
const DEFAULT_CM01_DRIP_TRAY_PRINTABILITY_ATTEMPT_DIRECTORY =
  "state/local/cm01-drip-tray-printability-attempts";
const DEFAULT_CM01_DRIP_TRAY_PRINTABILITY_CASE_PATH =
  "config/printability-cases/cm01-drip-tray-fdm-v1.json";
const DEFAULT_CM01_DRIP_TRAY_PRINT_ESTIMATE_CAPTURE_DIRECTORY =
  "state/local/cm01-drip-tray-print-estimate-captures";
const DEFAULT_CM01_DRIP_TRAY_PRINT_ESTIMATE_ATTEMPT_DIRECTORY =
  "state/local/cm01-drip-tray-print-estimate-attempts";
const DEFAULT_CM01_DRIP_TRAY_PRINT_ESTIMATE_CASE_PATH =
  "config/print-estimate-cases/cm01-drip-tray-fff-v1.json";
const DEFAULT_CM01_DRIP_TRAY_SIZE_Z_SENSITIVITY_CASE_PATH =
  "config/sensitivity-cases/coffee-machine-cm01-v3-drip-tray-size-z.json";
const DEFAULT_CM01_SEMANTIC_RECIPE_PATH =
  "config/product-recipes/coffee-machine-cm01-v1.json";
const DEFAULT_CM01_SEMANTIC_RECIPE_R2_PATH =
  "config/product-recipes/coffee-machine-cm01-v2-drip-tray-30.json";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_PROOF_PATH =
  "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_PROOF_R2_PATH =
  "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-height-30-static.json";
const DEFAULT_CM01_DRIP_TRAY_MECHANICAL_PROOF_R3_PATH =
  "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-height-30-static-r3.json";
const DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY =
  "state/local/engineering-project-run-leases";
const DEFAULT_PROJECT_BASELINE_DIRECTORY = "config/projects/baselines";
const DEFAULT_CM01_PART_DEFINITIONS_CAPTURE_DIRECTORY =
  "state/local/cm01-part-definitions-captures";

export interface CreateConsoleServerOptions {
  manifest?: FleetManifest;
  manifestPath?: string;
  runs?: readonly RunDetail[];
  runFixturePaths?: string[];
  probe?: McpProbe;
  docker?: DockerObserver;
  observedRuns?: ObservedRunCatalog;
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
  projectId?: string;
  projectPath?: string;
  activeProjectDirectory?: string;
  cockpitFocusDirectory?: string;
  threadSnapshotDirectory?: string;
  liveThreadUpdateDirectory?: string;
  approvedBriefCaptureDirectory?: string;
  sysonModelSeedCaptureDirectory?: string;
  sysonModelSeedAttemptDirectory?: string;
  cm01NominalModelicaCaptureDirectory?: string;
  cm01NominalModelicaAttemptDirectory?: string;
  /** Generic model.write-architecture@1 capture store directory. */
  architectureCaptureDirectory?: string;
  /** Generic model.write-architecture@1 WAL attempt directory. */
  architectureAttemptDirectory?: string;
  /** Generic model.write-requirements@1 capture store directory. */
  requirementsCaptureDirectory?: string;
  /** Generic model.write-requirements@1 WAL attempt directory. */
  requirementsAttemptDirectory?: string;
  cm01ArchitectureCaptureDirectory?: string;
  cm01ArchitectureAttemptDirectory?: string;
  inspectionDroneV4ArchitectureCaptureDirectory?: string;
  inspectionDroneV4ArchitectureAttemptDirectory?: string;
  inspectionDroneV4PartDefinitionsCaptureDirectory?: string;
  inspectionDroneV4PartDefinitionsPublicationDirectory?: string;
  cm01ErpNextBomCaptureDirectory?: string;
  cm01ErpNextBomRunCaptureDirectory?: string;
  cm01SemanticCadAttemptDirectory?: string;
  cm01SemanticCadCaptureDirectory?: string;
  cm01DripTrayMechanicalAttemptDirectory?: string;
  cm01DripTrayMechanicalCaptureDirectory?: string;
  cm01SemanticCadR2AttemptDirectory?: string;
  cm01SemanticCadR2CaptureDirectory?: string;
  cm01SemanticCadR3AttemptDirectory?: string;
  cm01SemanticCadR3CaptureDirectory?: string;
  cm01SemanticCadR4AttemptDirectory?: string;
  cm01SemanticCadR4CaptureDirectory?: string;
  /** Local host directory where the @4 CAD executor materializes presentation STL files. */
  cm01SemanticCadR4AssetDirectory?: string;
  cm01DripTrayMechanicalR2AttemptDirectory?: string;
  cm01DripTrayMechanicalR2CaptureDirectory?: string;
  cm01DripTrayMechanicalR3AttemptDirectory?: string;
  cm01DripTrayMechanicalR3CaptureDirectory?: string;
  oracleRequirementsSeedAttemptDirectory?: string;
  oracleRequirementsSeedCaptureDirectory?: string;
  sensitivityStudyCaptureDirectory?: string;
  sensitivityRunAttemptDirectory?: string;
  sensitivityRelationsSeedAttemptDirectory?: string;
  sensitivityRelationsSeedCaptureDirectory?: string;
  sensitivityEdgesSeedAttemptDirectory?: string;
  sensitivityEdgesSeedCaptureDirectory?: string;
  cm01DripTrayPrintabilityCaptureDirectory?: string;
  cm01DripTrayPrintabilityAttemptDirectory?: string;
  cm01DripTrayPrintEstimateCaptureDirectory?: string;
  cm01DripTrayPrintEstimateAttemptDirectory?: string;
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
  cm01PartDefinitionsCaptureDirectory?: string;
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
  const modelica = manifest.servers.find((server) => server.id === "modelica");
  const syson = manifest.servers.find((server) => server.id === "syson");
  const erpnext = manifest.servers.find((server) => server.id === "erpnext");
  const build123d = manifest.servers.find((server) => server.id === "build123d");
  const build123dSandbox = manifest.servers.find((server) =>
    server.id === "build123d-sandbox"
  );
  const calculix = manifest.servers.find((server) => server.id === "calculix");
  const dfm = manifest.servers.find((server) => server.id === "dfm");
  const prusaslicer = manifest.servers.find((server) => server.id === "prusaslicer");
  const observedRuns = options.observedRuns ??
    await createObservedRunCatalog(modelica?.mcpUrl, syson?.mcpUrl);
  const controlPlane = new ControlPlane({
    manifest,
    runs,
    observedRuns,
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
      modelica?.mcpUrl,
      erpnext?.mcpUrl,
      build123d?.mcpUrl,
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
  const instructions = projectControl || projectBrief
    ? "Casys engineering control plane. Fleet tools are read-only. project_start creates the engineering project from the first plain-language intent; framing, guided questions, sourced answers and the living brief remain inside that same project. An agent may revise the brief but cannot self-approve it: project_brief_confirm requires exact confirmation through MCP elicitation presented by the paired host. The signed retry protects request integrity and replay; user authentication remains the host's responsibility. project_snapshot reads the whole durable project. project_plan_publish binds reviewed work to the exact human-approved canonical brief; every work item cites a reviewed server-side operation. The agent may queue and execute only registered operations, with no provider name, arbitrary arguments, result payload, or fabricated evidence supplied by the caller. Consequential engineering decisions use the same host-presented MCP elicitation flow. Sensitivity studies produce data, never verdicts: a published derivative carries its unit, base point, step and declared limitations, and satisfies no requirement by itself. cockpit_focus_set selects an already durable project for the read-only cockpit; it does not change project truth. The cockpit is a read-only projection of framing, activity, lineage and results. Unavailable, demo, unlicensed standards content, legal conclusions, and unverified evidence must stay explicitly labelled."
    : "Casys read-only fleet console. Project tools are disabled on this non-loopback or explicitly fleet-only binding. Unavailable, demo, and unverified evidence must stay explicitly labelled.";
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
  if (projectControl) registerProjectControlTools(app, projectControl);
  if (projectBrief) registerProjectBriefTools(app, projectBrief);
  if (cockpitFocus) registerCockpitFocusTools(app, cockpitFocus);
  registerConsoleViewer(app);
  return { app, controlPlane };
}

async function createProjectControl(
  options: CreateConsoleServerOptions,
  sysonMcpUrl?: string,
  modelicaMcpUrl?: string,
  erpnextMcpUrl?: string,
  build123dMcpUrl?: string,
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
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: options.approvedBriefCaptureDirectory ??
      DEFAULT_APPROVED_BRIEF_CAPTURE_DIRECTORY,
  });
  const sysonModelSeedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: options.sysonModelSeedCaptureDirectory ??
      DEFAULT_SYSON_MODEL_SEED_CAPTURE_DIRECTORY,
  });
  const liveUpdates = new FileLiveThreadUpdateStore(
    options.liveThreadUpdateDirectory ?? DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY,
  );
  const lease = new FileEngineeringProjectRunLease(
    options.engineeringProjectRunLeaseDirectory ??
      DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY,
  );
  const activeProjectDirectory = options.activeProjectDirectory ??
    DEFAULT_ACTIVE_PROJECT_DIRECTORY;
  const runtime = await createEngineeringProjectCommandRuntime({
    projectId: options.projectId ?? DEFAULT_PROJECT_ID,
    trackedManifestPath: options.projectPath ?? DEFAULT_PROJECT_PATH,
    activeDirectory: activeProjectDirectory,
    evidenceSnapshots: threadSnapshots,
    planning: {
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
    },
    initialEvidenceValidator: new ExactInitialBaselineEvidenceValidator(
      activeThreadSnapshots,
      captures,
    ),
  });
  const baseline = new ApprovedBriefBaselineRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    captures,
    snapshots: activeThreadSnapshots,
    lease,
    liveUpdates,
  });
  const sysonModelSeed = sysonMcpUrl
    ? new SysonModelSeedRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      captures: sysonModelSeedCaptures,
      attempts: new FileSysonModelSeedAttemptStore(
        options.sysonModelSeedAttemptDirectory ??
          DEFAULT_SYSON_MODEL_SEED_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  const genericModelWriteArchitecture = sysonMcpUrl
    ? new ModelWriteArchitectureRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
      captures: new FileCaptureStore({
        ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.architectureCaptureDirectory ??
          DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      attempts: new FileArchitectureAttemptStore(
        options.architectureAttemptDirectory ?? DEFAULT_ARCHITECTURE_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  /**
   * The write-geometry executor promotes exact bytes from a human-signed draft
   * into the evidence thread.  It makes no provider calls — the draft and its
   * binary assets must already be present in the draft stores before the run.
   */
  const genericDesignWriteGeometry = new DesignWriteGeometryRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    architectureCaptures: new FileCaptureStore({
      ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
      directory: options.architectureCaptureDirectory ??
        DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY,
    }),
    geometryDraftCaptures: new FileCaptureStore({
      ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
      directory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
    }),
    geometryCaptures: new FileCaptureStore({
      ...GEOMETRY_CAPTURE_DESCRIPTOR,
      directory: DEFAULT_GEOMETRY_CAPTURE_DIRECTORY,
    }),
    lease,
    now: () => new Date().toISOString(),
  });
  const genericModelWriteRequirements = sysonMcpUrl
    ? new ModelWriteRequirementsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
      architectureCaptures: new FileCaptureStore({
        ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.architectureCaptureDirectory ??
          DEFAULT_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      captures: new FileCaptureStore({
        ...REQUIREMENTS_CAPTURE_DESCRIPTOR,
        directory: options.requirementsCaptureDirectory ??
          DEFAULT_REQUIREMENTS_CAPTURE_DIRECTORY,
      }),
      attempts: new FileRequirementsAttemptStore(
        options.requirementsAttemptDirectory ?? DEFAULT_REQUIREMENTS_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01Architecture = sysonMcpUrl
    ? new CoffeeMachineCm01V3ArchitectureRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
      captures: new FileCaptureStore({
        ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.cm01ArchitectureCaptureDirectory ??
          DEFAULT_CM01_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      attempts: new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
        options.cm01ArchitectureAttemptDirectory ??
          DEFAULT_CM01_ARCHITECTURE_ATTEMPT_DIRECTORY,
      ),
      recipe: await loadCoffeeMachineCm01SemanticRecipe(),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
      liveUpdates,
    })
    : undefined;
  const inspectionDroneV4Architecture = sysonMcpUrl
    ? new InspectionDroneV4ArchitectureRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      seedCaptures: sysonModelSeedCaptures,
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
  const cm01OracleRequirementsCaptures = new FileCaptureStore({
    ...ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
    directory: options.oracleRequirementsSeedCaptureDirectory ??
      DEFAULT_ORACLE_REQUIREMENTS_SEED_CAPTURE_DIRECTORY,
  });
  const cm01OracleRequirements = sysonMcpUrl
    ? new CoffeeMachineCm01V3OracleRequirementsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: new FileCaptureStore({
        ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.cm01ArchitectureCaptureDirectory ??
          DEFAULT_CM01_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      seedCaptures: sysonModelSeedCaptures,
      requirementsCaptures: cm01OracleRequirementsCaptures,
      attempts: new FileOracleRequirementsSeedAttemptStore(
        options.oracleRequirementsSeedAttemptDirectory ??
          DEFAULT_ORACLE_REQUIREMENTS_SEED_ATTEMPT_DIRECTORY,
      ),
      proof: await loadCm01DripTrayMechanicalProof(),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const cm01SensitivityRelations = sysonMcpUrl
    ? new CoffeeMachineCm01V3SensitivityRelationsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: new FileCaptureStore({
        ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.cm01ArchitectureCaptureDirectory ??
          DEFAULT_CM01_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      seedCaptures: sysonModelSeedCaptures,
      sensitivityCaptures: new FileCaptureStore({
        ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
        directory: options.sensitivityStudyCaptureDirectory ??
          DEFAULT_SENSITIVITY_STUDY_CAPTURE_DIRECTORY,
      }),
      sensitivityRelationsCaptures: new FileCaptureStore({
        ...SENSITIVITY_RELATIONS_SEED_CAPTURE_DESCRIPTOR,
        directory: options.sensitivityRelationsSeedCaptureDirectory ??
          DEFAULT_SENSITIVITY_RELATIONS_SEED_CAPTURE_DIRECTORY,
      }),
      attempts: new FileSensitivityRelationsAttemptStore(
        options.sensitivityRelationsSeedAttemptDirectory ??
          DEFAULT_SENSITIVITY_RELATIONS_SEED_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const cm01SensitivityEdges = sysonMcpUrl
    ? new CoffeeMachineCm01V3SensitivityEdgesRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: new FileCaptureStore({
        ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.cm01ArchitectureCaptureDirectory ??
          DEFAULT_CM01_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      seedCaptures: sysonModelSeedCaptures,
      sensitivityCaptures: new FileCaptureStore({
        ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
        directory: options.sensitivityStudyCaptureDirectory ??
          DEFAULT_SENSITIVITY_STUDY_CAPTURE_DIRECTORY,
      }),
      sensitivityEdgesCaptures: new FileCaptureStore({
        ...SENSITIVITY_EDGES_SEED_CAPTURE_DESCRIPTOR,
        directory: options.sensitivityEdgesSeedCaptureDirectory ??
          DEFAULT_SENSITIVITY_EDGES_SEED_CAPTURE_DIRECTORY,
      }),
      attempts: new FileSensitivityRelationsAttemptStore(
        options.sensitivityEdgesSeedAttemptDirectory ??
          DEFAULT_SENSITIVITY_EDGES_SEED_ATTEMPT_DIRECTORY,
      ),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  const cm01PartDefinitions = sysonMcpUrl
    ? new CoffeeMachineCm01V3PartDefinitionsRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      architectureCaptures: new FileCaptureStore({
        ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory: options.cm01ArchitectureCaptureDirectory ??
          DEFAULT_CM01_ARCHITECTURE_CAPTURE_DIRECTORY,
      }),
      seedCaptures: sysonModelSeedCaptures,
      partDefinitionsCaptures: new FileCaptureStore({
        ...CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
        directory: options.cm01PartDefinitionsCaptureDirectory ??
          DEFAULT_CM01_PART_DEFINITIONS_CAPTURE_DIRECTORY,
      }),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      lease,
    })
    : undefined;
  // Archive-lineage requires no provider — always available.
  const cm01ArchiveLineage = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots: activeThreadSnapshots,
    lease,
  });
  const cm01NominalThermal = modelicaMcpUrl
    ? new CoffeeMachineCm01V3ThermalRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      capture: new Cm01NominalModelicaCaptureAdapter({
        modelica: new HttpMcpToolClient({
          mcpUrl: modelicaMcpUrl,
          timeoutMs: 120_000,
        }),
      }),
      attempts: new FileCm01NominalModelicaAttemptStore(
        options.cm01NominalModelicaAttemptDirectory ??
          DEFAULT_CM01_NOMINAL_MODELICA_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
        directory: options.cm01NominalModelicaCaptureDirectory ??
          DEFAULT_CM01_NOMINAL_MODELICA_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01ErpNextBom = erpnextMcpUrl
    ? new CoffeeMachineCm01V3ErpNextBomRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      capture: new Cm01ErpNextBomCaptureAdapter({
        erpnext: new HttpMcpToolClient({
          mcpUrl: erpnextMcpUrl,
          timeoutMs: 30_000,
        }),
      }),
      captures: new FileCaptureStore({
        ...CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
        directory: options.cm01ErpNextBomCaptureDirectory ??
          DEFAULT_CM01_ERPNEXT_BOM_CAPTURE_DIRECTORY,
      }),
      runCaptures: new FileCm01ErpNextBomRunCaptureStore(
        options.cm01ErpNextBomRunCaptureDirectory ??
          DEFAULT_CM01_ERPNEXT_BOM_RUN_CAPTURE_DIRECTORY,
      ),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01DripTrayHeightCorrection =
    new CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      lease,
      liveUpdates,
    });
  const cm01Cad = build123dMcpUrl
    ? new CoffeeMachineCm01V3CadRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      recipe: await loadCoffeeMachineCm01SemanticRecipe(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: new FileCm01SemanticCadAttemptStore(
        options.cm01SemanticCadAttemptDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
        directory: options.cm01SemanticCadCaptureDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01CadR2 = build123dMcpUrl
    ? new CoffeeMachineCm01V3CadR2RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      recipe: await loadCoffeeMachineCm01SemanticRecipeR2(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: new FileCm01SemanticCadAttemptStore(
        options.cm01SemanticCadR2AttemptDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R2_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
        directory: options.cm01SemanticCadR2CaptureDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R2_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01CadR3 = build123dMcpUrl
    ? new CoffeeMachineCm01V3CadR3RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      recipe: await loadCoffeeMachineCm01SemanticRecipeR2(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 240_000,
      }),
      attempts: new FileCm01SemanticCadAttemptStore(
        options.cm01SemanticCadR3AttemptDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R3_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
        directory: options.cm01SemanticCadR3CaptureDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R3_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01CadR4 = build123dMcpUrl
    ? new CoffeeMachineCm01V3CadR4RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      recipe: await loadCoffeeMachineCm01SemanticRecipeR2(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 240_000,
      }),
      attempts: new FileCm01SemanticCadAttemptStore(
        options.cm01SemanticCadR4AttemptDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R4_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
        directory: options.cm01SemanticCadR4CaptureDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R4_CAPTURE_DIRECTORY,
      }),
      assets: new DockerVolumeAssetMaterializer({
        service: "mcp-build123d",
        containerDirectory: "/exports",
        localDirectory: options.cm01SemanticCadR4AssetDirectory ??
          DEFAULT_CM01_SEMANTIC_CAD_R4_ASSET_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01Mechanical = sysonMcpUrl && build123dMcpUrl && calculixMcpUrl
    ? new CoffeeMachineCm01V3MechanicalRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      proof: await loadCm01DripTrayMechanicalProof(),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      calculix: new HttpMcpToolClient({
        mcpUrl: calculixMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: new FileCm01DripTrayMechanicalAttemptStore(
        options.cm01DripTrayMechanicalAttemptDirectory ??
          DEFAULT_CM01_DRIP_TRAY_MECHANICAL_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
        directory: options.cm01DripTrayMechanicalCaptureDirectory ??
          DEFAULT_CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DIRECTORY,
      }),
      requirementsCaptures: cm01OracleRequirementsCaptures,
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01MechanicalR2 = sysonMcpUrl && build123dMcpUrl && calculixMcpUrl
    ? new CoffeeMachineCm01V3MechanicalR2RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      proof: await loadCm01DripTrayMechanicalProofR2(),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      calculix: new HttpMcpToolClient({
        mcpUrl: calculixMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: new FileCm01DripTrayMechanicalAttemptStore(
        options.cm01DripTrayMechanicalR2AttemptDirectory ??
          DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R2_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
        directory: options.cm01DripTrayMechanicalR2CaptureDirectory ??
          DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R2_CAPTURE_DIRECTORY,
      }),
      requirementsCaptures: cm01OracleRequirementsCaptures,
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01MechanicalR3Attempts = new FileCm01DripTrayMechanicalAttemptStore(
    options.cm01DripTrayMechanicalR3AttemptDirectory ??
      DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R3_ATTEMPT_DIRECTORY,
  );
  const cm01MechanicalR3Captures = new FileCaptureStore({
    ...CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
    directory: options.cm01DripTrayMechanicalR3CaptureDirectory ??
      DEFAULT_CM01_DRIP_TRAY_MECHANICAL_R3_CAPTURE_DIRECTORY,
  });
  const cm01MechanicalR3IdentityRecovery = sysonMcpUrl
    ? new CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      capture: new Cm01DripTrayMechanicalR3CaptureRecovery(
        cm01MechanicalR3Attempts,
        cm01MechanicalR3Captures,
      ),
      proof: await loadCm01DripTrayMechanicalProofR3(),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      requirementsCaptures: cm01OracleRequirementsCaptures,
      lease,
    })
    : undefined;
  const cm01MechanicalR3 = sysonMcpUrl && build123dMcpUrl && calculixMcpUrl
    ? new CoffeeMachineCm01V3MechanicalR3RunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      proof: await loadCm01DripTrayMechanicalProofR3(),
      syson: new HttpMcpToolClient({ mcpUrl: sysonMcpUrl, timeoutMs: 30_000 }),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      calculix: new HttpMcpToolClient({
        mcpUrl: calculixMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: cm01MechanicalR3Attempts,
      captures: cm01MechanicalR3Captures,
      requirementsCaptures: cm01OracleRequirementsCaptures,
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01DripTrayBaseZSensitivity = build123dMcpUrl && calculixMcpUrl
    ? new CoffeeMachineCm01V3SensitivityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      sensitivityCase: await loadCm01DripTrayBaseZSensitivityCase(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      calculix: new HttpMcpToolClient({
        mcpUrl: calculixMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: new FileSensitivityRunAttemptStore(
        options.sensitivityRunAttemptDirectory ??
          DEFAULT_SENSITIVITY_RUN_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
        directory: options.sensitivityStudyCaptureDirectory ??
          DEFAULT_SENSITIVITY_STUDY_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01DripTrayPrintability = build123dMcpUrl && dfmMcpUrl
    ? new CoffeeMachineCm01V3PrintabilityRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      printabilityCase: await loadCm01DripTrayPrintabilityCase(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      dfm: new HttpMcpToolClient({
        mcpUrl: dfmMcpUrl,
        timeoutMs: 120_000,
      }),
      attempts: new FileCm01DripTrayPrintabilityAttemptStore(
        options.cm01DripTrayPrintabilityAttemptDirectory ??
          DEFAULT_CM01_DRIP_TRAY_PRINTABILITY_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_DRIP_TRAY_PRINTABILITY_CAPTURE_DESCRIPTOR,
        directory: options.cm01DripTrayPrintabilityCaptureDirectory ??
          DEFAULT_CM01_DRIP_TRAY_PRINTABILITY_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
    })
    : undefined;
  const cm01DripTrayPrintEstimate = build123dMcpUrl && prusaslicerMcpUrl
    ? new CoffeeMachineCm01V3PrintEstimateRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots: activeThreadSnapshots,
      printEstimateCase: await loadCm01DripTrayPrintEstimateCase(),
      build123d: new HttpMcpToolClient({
        mcpUrl: build123dMcpUrl,
        timeoutMs: 120_000,
      }),
      prusaslicer: new HttpMcpToolClient({
        mcpUrl: prusaslicerMcpUrl,
        timeoutMs: 180_000,
      }),
      attempts: new FileCm01DripTrayPrintEstimateAttemptStore(
        options.cm01DripTrayPrintEstimateAttemptDirectory ??
          DEFAULT_CM01_DRIP_TRAY_PRINT_ESTIMATE_ATTEMPT_DIRECTORY,
      ),
      captures: new FileCaptureStore({
        ...CM01_DRIP_TRAY_PRINT_ESTIMATE_CAPTURE_DESCRIPTOR,
        directory: options.cm01DripTrayPrintEstimateCaptureDirectory ??
          DEFAULT_CM01_DRIP_TRAY_PRINT_ESTIMATE_CAPTURE_DIRECTORY,
      }),
      lease,
      liveUpdates,
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
      // WHY THE SANDBOX INSTANCE AND NOT THE TRUSTED ONE — preview executes a
      // geometry program PROPOSED BY AN AGENT. A fingerprint proves byte identity
      // after sealing, never causal provenance: a write reaching the shared
      // evidence volume before its producer hashes it would make the wrong hash
      // the expected one. The sandbox owns a private export volume, so a proposed
      // program can never touch evidence bytes. No sandbox entry in the fleet
      // manifest ⇒ no preview tool at all, never a ghost that fails when called.
      geometryPreview: build123dSandboxMcpUrl
        ? {
          client: new HttpMcpToolClient({
            mcpUrl: build123dSandboxMcpUrl,
            timeoutMs: 120_000,
          }),
          draftCaptures: new FileCaptureStore({
            ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
            directory: DEFAULT_GEOMETRY_DRAFT_CAPTURE_DIRECTORY,
          }),
          build123dService: "mcp-build123d-sandbox",
        }
        : undefined,
      runExecutor: new RegisteredProjectRunExecutor({
        projects: runtime.projects,
        baseline,
        sysonModelSeed,
        additional: [
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
            executor: genericModelWriteArchitecture,
            unavailableMessage:
              "The server has no trusted generic model.write-architecture@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: DESIGN_WRITE_GEOMETRY_OPERATION,
            executor: genericDesignWriteGeometry,
          },
          {
            operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
            executor: genericModelWriteRequirements,
            unavailableMessage:
              "The server has no trusted generic model.write-requirements@1 executor " +
              "configured for this run (SysON provider is required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_ARCHITECTURE_OPERATION,
            executor: cm01Architecture,
            unavailableMessage:
              "The server has no trusted CM-01 SysON architecture executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_ORACLE_REQUIREMENTS_OPERATION,
            executor: cm01OracleRequirements,
            unavailableMessage:
              "The server has no trusted CM-01 oracle-requirements executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_SENSITIVITY_RELATIONS_OPERATION,
            executor: cm01SensitivityRelations,
            unavailableMessage:
              "The server has no trusted CM-01 sensitivity-relations executor configured for this run (SysON provider is required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_SENSITIVITY_EDGES_OPERATION,
            executor: cm01SensitivityEdges,
            unavailableMessage:
              "The server has no trusted CM-01 sensitivity-edges executor configured for this run (SysON provider is required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION,
            executor: cm01NominalThermal,
            unavailableMessage:
              "The server has no trusted CM-01 nominal Modelica executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION,
            executor: cm01ErpNextBom,
            unavailableMessage:
              "The server has no trusted CM-01 ERPNext BOM executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION,
            executor: cm01DripTrayHeightCorrection,
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_CAD_OPERATION,
            executor: cm01Cad,
            unavailableMessage:
              "The server has no trusted CM-01 semantic CAD executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_CAD_R2_OPERATION,
            executor: cm01CadR2,
            unavailableMessage:
              "The server has no trusted CM-01 revised semantic CAD executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION,
            executor: cm01CadR3,
            unavailableMessage:
              "The server has no trusted CM-01 @3 semantic CAD executor configured for this run (build123d provider is required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION,
            executor: cm01CadR4,
            unavailableMessage:
              "The server has no trusted CM-01 @4 semantic CAD executor configured for this run (build123d provider and Docker are required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION,
            executor: cm01Mechanical,
            unavailableMessage:
              "The server has no trusted CM-01 DripTray mechanical executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_MECHANICAL_R2_OPERATION,
            executor: cm01MechanicalR2,
            unavailableMessage:
              "The server has no trusted CM-01 revised DripTray mechanical executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_OPERATION,
            executor: cm01MechanicalR3,
            unavailableMessage:
              "The server has no trusted CM-01 R3 DripTray recovery executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_OPERATION,
            executor: cm01MechanicalR3IdentityRecovery,
            unavailableMessage:
              "The server has no trusted CM-01 R3 identity recovery executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION,
            executor: cm01DripTrayBaseZSensitivity,
            unavailableMessage:
              "The server has no trusted CM-01 DripTray size-z sensitivity executor configured for this run.",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION,
            executor: cm01DripTrayPrintability,
            unavailableMessage:
              "The server has no trusted CM-01 DripTray FDM printability executor configured for this run (build123d and dfm providers are required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_PRINT_ESTIMATE_OPERATION,
            executor: cm01DripTrayPrintEstimate,
            unavailableMessage:
              "The server has no trusted CM-01 DripTray FFF print-estimate executor configured for this run (build123d and prusaslicer providers are required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_PART_DEFINITIONS_OPERATION,
            executor: cm01PartDefinitions,
            unavailableMessage:
              "The server has no trusted CM-01 part-definitions executor configured for this run (SysON provider is required).",
          },
          {
            operation: COFFEE_MACHINE_CM01_V3_ARCHIVE_LINEAGE_OPERATION,
            executor: cm01ArchiveLineage,
            unavailableMessage:
              "The server has no trusted CM-01 archive-lineage executor configured for this run.",
          },
        ],
      }),
    },
  };
}

async function loadCoffeeMachineCm01SemanticRecipe() {
  return parseCoffeeMachineCm01SemanticRecipe(
    await loadReviewedJson(
      DEFAULT_CM01_SEMANTIC_RECIPE_PATH,
      "CM-01 semantic recipe",
    ),
  );
}

async function loadCoffeeMachineCm01SemanticRecipeR2() {
  return parseCoffeeMachineCm01SemanticRecipeR2(
    await loadReviewedJson(
      DEFAULT_CM01_SEMANTIC_RECIPE_R2_PATH,
      "CM-01 revised semantic recipe",
    ),
  );
}

async function loadCm01DripTrayMechanicalProof() {
  return parseCm01DripTrayMechanicalProof(
    await loadReviewedJson(
      DEFAULT_CM01_DRIP_TRAY_MECHANICAL_PROOF_PATH,
      "CM-01 DripTray mechanical proof",
    ),
  );
}

async function loadCm01DripTrayMechanicalProofR2() {
  return parseCm01DripTrayMechanicalProofR2(
    await loadReviewedJson(
      DEFAULT_CM01_DRIP_TRAY_MECHANICAL_PROOF_R2_PATH,
      "CM-01 revised DripTray mechanical proof",
    ),
  );
}

async function loadCm01DripTrayMechanicalProofR3() {
  return parseCm01DripTrayMechanicalProofR3(
    await loadReviewedJson(
      DEFAULT_CM01_DRIP_TRAY_MECHANICAL_PROOF_R3_PATH,
      "CM-01 R3 DripTray recovery proof",
    ),
  );
}

async function loadCm01DripTrayBaseZSensitivityCase() {
  return validateSensitivityStudyCase(
    await loadReviewedJson(
      DEFAULT_CM01_DRIP_TRAY_SIZE_Z_SENSITIVITY_CASE_PATH,
      "CM-01 DripTray size-z sensitivity case",
    ),
  );
}

async function loadCm01DripTrayPrintabilityCase() {
  return validatePrintabilityCheckCase(
    await loadReviewedJson(
      DEFAULT_CM01_DRIP_TRAY_PRINTABILITY_CASE_PATH,
      "CM-01 DripTray FDM printability case",
    ),
  );
}

async function loadCm01DripTrayPrintEstimateCase() {
  return validatePrintEstimateCase(
    await loadReviewedJson(
      DEFAULT_CM01_DRIP_TRAY_PRINT_ESTIMATE_CASE_PATH,
      "CM-01 DripTray FFF print-estimate case",
    ),
  );
}

async function loadReviewedJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    throw new Error(
      `Unable to load the reviewed ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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

async function createObservedRunCatalog(
  modelicaMcpUrl?: string,
  sysonMcpUrl?: string,
): Promise<ObservedRunCatalog | undefined> {
  if (!modelicaMcpUrl) return undefined;
  const modelica = new ModelicaRunObserver({ mcpUrl: modelicaMcpUrl });
  if (!sysonMcpUrl) return modelica;
  const verifier = new ScenarioContractVerifier({
    planPath: DEFAULT_SCENARIO_CONTRACT_PLAN_PATH,
    sysonMcpUrl,
  });
  await verifier.prepare();
  return new ScenarioVerifiedRunCatalog({
    source: modelica,
    verifier,
  });
}

export function registerConsoleViewer(app: McpApp): boolean {
  const summary = app.registerViewers({
    prefix: "casys-digital-thread",
    viewers: ["console"],
    moduleUrl: import.meta.url,
    exists: fileExists,
    readFile: Deno.readTextFile,
  });
  if (
    summary.registered.length > 0 &&
    !app.hasResource(CONSOLE_RESOURCE_URI)
  ) {
    throw new Error(
      `Console viewer registered under an unexpected URI; expected ${CONSOLE_RESOURCE_URI}`,
    );
  }
  return summary.registered.length === 1;
}

if (import.meta.main) {
  const cli = parseCli(Deno.args);
  const port = cli.port ?? integerEnv("MCP_PORT") ?? DEFAULT_PORT;
  const hostname = cli.hostname ?? env("MCP_HOSTNAME") ?? DEFAULT_HOSTNAME;
  const projectToolsEnabled = isExplicitLoopbackHostname(hostname);
  const { app } = await createConsoleServer({
    projectControl: projectToolsEnabled ? undefined : false,
  });
  await app.startHttp({
    port,
    hostname,
    corsOrigins: ["http://127.0.0.1", "http://localhost"],
    onListen: ({ hostname: boundHostname, port: boundPort }) => {
      console.error(
        `Casys digital-thread console: http://${boundHostname}:${boundPort}/mcp`,
      );
      if (!projectToolsEnabled) {
        console.error(
          "Project mutation tools disabled: non-loopback MCP binding exposes the read-only fleet console only.",
        );
      }
    },
  });
}

interface CliOptions {
  port?: number;
  hostname?: string;
}

function parseCli(args: string[]): CliOptions {
  const result: CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--stdio") {
      throw new TypeError("--stdio is not supported; use stateless HTTP on /mcp.");
    } else if (argument.startsWith("--port=")) {
      result.port = positiveInteger(argument.slice("--port=".length), "--port");
    } else if (argument === "--port") {
      result.port = positiveInteger(args[++index], "--port");
    } else if (argument.startsWith("--hostname=")) {
      result.hostname = argument.slice("--hostname=".length);
    } else if (argument === "--hostname") {
      result.hostname = args[++index];
    }
  }
  if (result.hostname !== undefined && result.hostname.trim() === "") {
    throw new TypeError("--hostname must not be empty");
  }
  return result;
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

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}
