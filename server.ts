import { McpApp } from "@casys/mcp-server";
import {
  DockerComposeObserver,
  type DockerObserver,
} from "./src/adapters/docker-observer.ts";
import { HttpMcpProbe, type McpProbe } from "./src/adapters/http-mcp-probe.ts";
import { loadFleetManifest } from "./src/adapters/manifest.ts";
import { ModelicaRunObserver } from "./src/adapters/modelica-run-observer.ts";
import { loadRunFixtures } from "./src/adapters/run-fixtures.ts";
import { ScenarioContractVerifier } from "./src/adapters/scenario-contract-verifier.ts";
import { ScenarioVerifiedRunCatalog } from "./src/adapters/scenario-verified-run-catalog.ts";
import { ControlPlane } from "./src/domain/control-plane.ts";
import type {
  FleetManifest,
  ObservedRunCatalog,
  RunDetail,
} from "./src/domain/types.ts";
import {
  CONSOLE_RESOURCE_URI,
  registerControlPlaneTools,
} from "./src/tools/register.ts";

const DEFAULT_PORT = 3020;
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_MANIFEST_PATH = "config/mcp-fleet.json";
const DEFAULT_RUN_FIXTURE_PATH = "state/fixtures/runs/bracket-demo.json";
const DEFAULT_SCENARIO_CONTRACT_PLAN_PATH =
  "config/verification-plans/coffee-machine-nominal-v1.json";

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
  const app = new McpApp({
    name: "casys-digital-thread-console",
    version: "0.1.0",
    transport: "stateless",
    maxConcurrent: 8,
    backpressureStrategy: "queue",
    validateSchema: true,
    instructions:
      "Read-only control plane for the Casys engineering MCP fleet. Unavailable and demo data are explicitly labelled. No lifecycle mutation tools are exposed.",
    logger: options.logger,
    toolErrorMapper: (error) =>
      error instanceof Error &&
        (error.name === "ControlPlaneNotFoundError" ||
          error instanceof TypeError)
        ? error.message
        : null,
  });
  registerControlPlaneTools(app, controlPlane);
  registerConsoleViewer(app);
  return { app, controlPlane };
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
  const { app } = await createConsoleServer();
  if (cli.stdio) {
    await app.start();
  } else {
    const port = cli.port ?? integerEnv("MCP_PORT") ?? DEFAULT_PORT;
    const hostname = cli.hostname ?? env("MCP_HOSTNAME") ?? DEFAULT_HOSTNAME;
    await app.startHttp({
      port,
      hostname,
      corsOrigins: ["http://127.0.0.1", "http://localhost"],
      onListen: ({ hostname: boundHostname, port: boundPort }) => {
        console.error(
          `Casys digital-thread console: http://${boundHostname}:${boundPort}/mcp`,
        );
      },
    });
  }
}

interface CliOptions {
  stdio: boolean;
  port?: number;
  hostname?: string;
}

function parseCli(args: string[]): CliOptions {
  const result: CliOptions = { stdio: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--stdio") {
      result.stdio = true;
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
