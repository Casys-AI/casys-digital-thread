import { McpApp } from "@casys/mcp-server";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/docker-observer.ts";
import { HttpMcpProbe, type McpProbe } from "./src/adapters/http-mcp-probe.ts";
import { loadFleetManifest } from "./src/adapters/manifest.ts";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./src/adapters/loopback-host.ts";
import { FileThreadSnapshotStore } from "./src/adapters/file-thread-snapshot-store.ts";
import { FileApprovedDiscoveryBaselineCaptureStore } from "./src/adapters/file-approved-discovery-baseline-capture-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./src/adapters/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedDiscoveryBaselineRunExecutor } from "./src/adapters/approved-discovery-baseline-run-executor.ts";
import { FileEngineeringProjectRunLease } from "./src/adapters/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "./src/adapters/live-thread-update-store.ts";
import { FileProjectDiscoveryRevisionStore } from "./src/adapters/project-discovery-store.ts";
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
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "./src/orchestration/operations/registry.ts";
import {
  ProjectDiscoveryCommandError,
  ProjectDiscoveryCommandService,
} from "./src/domain/project-discovery-command-service.ts";
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
  type ProjectDiscoveryToolDependencies,
  registerProjectDiscoveryTools,
} from "./src/tools/project-discovery.ts";

const DEFAULT_PORT = 3020;
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_MANIFEST_PATH = "config/mcp-fleet.json";
const DEFAULT_RUN_FIXTURE_PATH = "state/fixtures/runs/bracket-demo.json";
const DEFAULT_SCENARIO_CONTRACT_PLAN_PATH =
  "config/verification-plans/coffee-machine-nominal-v1.json";
const DEFAULT_PROJECT_ID = "coffee-machine-cm01";
const DEFAULT_PROJECT_PATH = "config/projects/coffee-machine-cm01.project.json";
const DEFAULT_ACTIVE_PROJECT_DIRECTORY = "state/local/engineering-projects";
const DEFAULT_PROJECT_DISCOVERY_DIRECTORY = "state/local/project-discoveries";
const DEFAULT_THREAD_SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY = "state/local/live-thread-updates";
const DEFAULT_APPROVED_DISCOVERY_CAPTURE_DIRECTORY =
  "state/local/approved-discovery-captures";
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
  /** Defaults to the same loopback-only trust boundary as project control. */
  projectDiscovery?: ProjectDiscoveryToolDependencies | false;
  projectId?: string;
  projectPath?: string;
  activeProjectDirectory?: string;
  projectDiscoveryDirectory?: string;
  threadSnapshotDirectory?: string;
  liveThreadUpdateDirectory?: string;
  approvedDiscoveryCaptureDirectory?: string;
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
  const projectControl = options.projectControl === false
    ? undefined
    : options.projectControl ?? await createProjectControl(options);
  const projectDiscovery = options.projectDiscovery === false ||
      (options.projectControl === false && options.projectDiscovery === undefined)
    ? undefined
    : options.projectDiscovery ?? createProjectDiscovery(options);
  const instructions = projectControl || projectDiscovery
    ? "Casys engineering control plane. Fleet tools are read-only. project_discovery_* captures pre-project intent, guided questions, sourced answers and a human-reviewable brief without creating technical evidence; agents can never approve or reject that brief. project_snapshot reads durable approved-project truth. project_plan_publish lets an agent publish or revise unexecuted planning state from an exact approved discovery, but every work item must cite a reviewed server-side operation and the call cannot execute a provider, approve a decision, queue work or create evidence. project_agent_run_execute can only advance a human-queued, registered V2 approved-discovery baseline through a server-owned immutable documentary capture; it accepts no provider arguments and creates no CAD, SysML, simulation, measurement, or compliance proof. Agents cannot approve/reject project decisions or queue work: those human actions exist only in the same-origin Workbench command channel. Unavailable, demo, unlicensed standards content, legal conclusions, and unverified evidence must stay explicitly labelled."
    : "Casys read-only fleet console. Project tools are disabled on this non-loopback or explicitly fleet-only binding. Unavailable, demo, and unverified evidence must stay explicitly labelled.";
  const app = new McpApp({
    name: "casys-digital-thread-console",
    version: "0.2.0",
    transport: "stateless",
    maxConcurrent: 8,
    backpressureStrategy: "queue",
    validateSchema: true,
    instructions,
    logger: options.logger,
    toolErrorMapper: (error) =>
      error instanceof Error &&
        (error.name === "ControlPlaneNotFoundError" ||
          error instanceof EngineeringProjectCommandError ||
          error instanceof ProjectDiscoveryCommandError ||
          error instanceof TypeError)
        ? error.message
        : null,
  });
  if (projectControl || projectDiscovery) {
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
  if (projectDiscovery) registerProjectDiscoveryTools(app, projectDiscovery);
  registerConsoleViewer(app);
  return { app, controlPlane };
}

async function createProjectControl(
  options: CreateConsoleServerOptions,
): Promise<ProjectControlToolDependencies> {
  const activeThreadSnapshots = new FileThreadSnapshotStore(
    options.threadSnapshotDirectory ?? DEFAULT_THREAD_SNAPSHOT_DIRECTORY,
  );
  const threadSnapshots = new OrderedExactThreadSnapshotReader([
    activeThreadSnapshots,
    new FileExactThreadSnapshotDirectory(
      options.projectBaselineDirectory ?? DEFAULT_PROJECT_BASELINE_DIRECTORY,
    ),
  ]);
  const discoveries = new FileProjectDiscoveryRevisionStore(
    options.projectDiscoveryDirectory ?? DEFAULT_PROJECT_DISCOVERY_DIRECTORY,
  );
  const captures = new FileApprovedDiscoveryBaselineCaptureStore(
    options.approvedDiscoveryCaptureDirectory ??
      DEFAULT_APPROVED_DISCOVERY_CAPTURE_DIRECTORY,
  );
  const runtime = await createEngineeringProjectCommandRuntime({
    projectId: options.projectId ?? DEFAULT_PROJECT_ID,
    trackedManifestPath: options.projectPath ?? DEFAULT_PROJECT_PATH,
    activeDirectory: options.activeProjectDirectory ??
      DEFAULT_ACTIVE_PROJECT_DIRECTORY,
    evidenceSnapshots: threadSnapshots,
    planning: {
      discoveries,
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
    },
    initialEvidenceValidator: new ExactInitialBaselineEvidenceValidator(
      activeThreadSnapshots,
      captures,
    ),
  });
  return {
    projects: runtime.projects,
    commands: runtime.commands,
    baselineExecutor: new ApprovedDiscoveryBaselineRunExecutor({
      projects: runtime.projects,
      commands: runtime.commands,
      discoveries,
      captures,
      snapshots: activeThreadSnapshots,
      lease: new FileEngineeringProjectRunLease(
        options.engineeringProjectRunLeaseDirectory ??
          DEFAULT_ENGINEERING_PROJECT_RUN_LEASE_DIRECTORY,
      ),
      liveUpdates: new FileLiveThreadUpdateStore(
        options.liveThreadUpdateDirectory ?? DEFAULT_LIVE_THREAD_UPDATE_DIRECTORY,
      ),
    }),
  };
}

function createProjectDiscovery(
  options: CreateConsoleServerOptions,
): ProjectDiscoveryToolDependencies {
  const discoveries = new FileProjectDiscoveryRevisionStore(
    options.projectDiscoveryDirectory ?? DEFAULT_PROJECT_DISCOVERY_DIRECTORY,
  );
  return {
    discoveries,
    commands: new ProjectDiscoveryCommandService(discoveries),
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

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}
