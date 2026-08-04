import { McpApp } from "@casys/mcp-server";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/docker-observer.ts";
import { HttpMcpProbe, type McpProbe } from "./src/adapters/http-mcp-probe.ts";
import { HttpMcpToolClient } from "./src/adapters/http-mcp-tool-client.ts";
import { loadFleetManifest } from "./src/adapters/manifest.ts";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./src/adapters/loopback-host.ts";
import { FileThreadSnapshotStore } from "./src/adapters/file-thread-snapshot-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
  CM01_ERPNEXT_BOM_CAPTURE_DESCRIPTOR,
  CM01_NOMINAL_MODELICA_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  ORACLE_REQUIREMENTS_SEED_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "./src/adapters/file-capture-store.ts";
import { FileSensitivityRunAttemptStore } from "./src/adapters/file-sensitivity-run-attempt-store.ts";
import { FileSysonModelSeedAttemptStore } from "./src/adapters/file-syson-model-seed-attempt-store.ts";
import { FileCm01NominalModelicaAttemptStore } from "./src/adapters/file-cm01-nominal-modelica-attempt-store.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "./src/adapters/file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import { FileCm01ErpNextBomRunCaptureStore } from "./src/adapters/file-cm01-erpnext-bom-run-capture-store.ts";
import { FileCm01SemanticCadAttemptStore } from "./src/adapters/file-cm01-semantic-cad-attempt-store.ts";
import { FileCm01DripTrayMechanicalAttemptStore } from "./src/adapters/file-cm01-drip-tray-mechanical-attempt-store.ts";
import { FileOracleRequirementsSeedAttemptStore } from "./src/adapters/file-oracle-requirements-seed-attempt-store.ts";
import {
  COFFEE_MACHINE_CM01_V3_ORACLE_REQUIREMENTS_OPERATION,
  CoffeeMachineCm01V3OracleRequirementsRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-oracle-requirements-run-executor.ts";
import { Cm01DripTrayMechanicalR3CaptureRecovery } from "./src/adapters/cm01-drip-tray-mechanical-r3-capture-recovery.ts";
import {
  COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_OPERATION,
  CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-r3-identity-recovery-run-executor.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./src/adapters/approved-brief-baseline-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./src/adapters/syson-model-seed-run-executor.ts";
import { Cm01NominalModelicaCaptureAdapter } from "./src/adapters/cm01-nominal-modelica-capture.ts";
import {
  COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION,
  CoffeeMachineCm01V3ThermalRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-thermal-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_OPERATION,
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-architecture-run-executor.ts";
import { Cm01ErpNextBomCaptureAdapter } from "./src/adapters/cm01-erpnext-bom-capture.ts";
import {
  COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION,
  CoffeeMachineCm01V3ErpNextBomRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-erpnext-bom-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_OPERATION,
  CoffeeMachineCm01V3CadRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-cad-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION,
  CoffeeMachineCm01V3MechanicalRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-mechanical-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION,
  CoffeeMachineCm01V3SensitivityRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-sensitivity-run-executor.ts";
import { validateSensitivityStudyCase } from "./src/domain/sensitivity-study.ts";
import {
  COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION,
  CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-drip-tray-height-correction-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_R2_OPERATION,
  COFFEE_MACHINE_CM01_V3_MECHANICAL_R2_OPERATION,
  COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_OPERATION,
  CoffeeMachineCm01V3CadR2RunExecutor,
  CoffeeMachineCm01V3MechanicalR2RunExecutor,
  CoffeeMachineCm01V3MechanicalR3RunExecutor,
} from "./src/adapters/coffee-machine-cm01-v3-r2-provider-run-executor.ts";
import { RegisteredProjectRunExecutor } from "./src/adapters/registered-project-run-executor.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/live-thread-update-store.ts";
import { FileEngineeringProjectRevisionStore } from "./src/adapters/engineering-project-store.ts";
import {
  CockpitFocusConflictError,
  FileCockpitFocusStore,
} from "./src/adapters/file-cockpit-focus-store.ts";
import { createEngineeringProjectCommandRuntime } from "./src/adapters/engineering-project-command-runtime.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "./src/adapters/engineering-thread-snapshot-resolver.ts";
import { ModelicaRunObserver } from "./src/adapters/modelica-run-observer.ts";
import { loadRunFixtures } from "./src/adapters/run-fixtures.ts";
import { ScenarioContractVerifier } from "./src/adapters/scenario-contract-verifier.ts";
import { ScenarioVerifiedRunCatalog } from "./src/adapters/scenario-verified-run-catalog.ts";
import { ControlPlane } from "./src/domain/control-plane.ts";
import { EngineeringProjectCommandError } from "./src/domain/engineering-project-command-service.ts";
import {
  parseCoffeeMachineCm01SemanticRecipe,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "./src/domain/coffee-machine-cm01-semantic-recipe.ts";
import {
  parseCm01DripTrayMechanicalProof,
  parseCm01DripTrayMechanicalProofR2,
  parseCm01DripTrayMechanicalProofR3,
} from "./src/domain/cm01-drip-tray-mechanical-proof.ts";
import { ProjectBriefCommandService } from "./src/domain/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./src/orchestration/operations/registry.ts";
import type {
  FleetManifest,
  ObservedRunCatalog,
  RunDetail,
} from "./src/domain/types.ts";
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
  cm01ArchitectureCaptureDirectory?: string;
  cm01ArchitectureAttemptDirectory?: string;
  cm01ErpNextBomCaptureDirectory?: string;
  cm01ErpNextBomRunCaptureDirectory?: string;
  cm01SemanticCadAttemptDirectory?: string;
  cm01SemanticCadCaptureDirectory?: string;
  cm01DripTrayMechanicalAttemptDirectory?: string;
  cm01DripTrayMechanicalCaptureDirectory?: string;
  cm01SemanticCadR2AttemptDirectory?: string;
  cm01SemanticCadR2CaptureDirectory?: string;
  cm01DripTrayMechanicalR2AttemptDirectory?: string;
  cm01DripTrayMechanicalR2CaptureDirectory?: string;
  cm01DripTrayMechanicalR3AttemptDirectory?: string;
  cm01DripTrayMechanicalR3CaptureDirectory?: string;
  oracleRequirementsSeedAttemptDirectory?: string;
  oracleRequirementsSeedCaptureDirectory?: string;
  sensitivityStudyCaptureDirectory?: string;
  sensitivityRunAttemptDirectory?: string;
  engineeringProjectRunLeaseDirectory?: string;
  projectBaselineDirectory?: string;
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
  const calculix = manifest.servers.find((server) => server.id === "calculix");
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
      calculix?.mcpUrl,
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
  calculixMcpUrl?: string,
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
  return {
    brief: {
      projects: runtime.projects,
      commands: new ProjectBriefCommandService(runtime.projects),
    },
    control: {
      projects: runtime.projects,
      commands: runtime.commands,
      runExecutor: new RegisteredProjectRunExecutor({
        projects: runtime.projects,
        baseline,
        sysonModelSeed,
        additional: [
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
