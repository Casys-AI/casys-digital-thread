const STACK_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type StackSignal = (typeof STACK_SIGNALS)[number];

export interface ChildPermissions {
  read: string[];
  write: string[];
  net: string[];
  env: string[];
  run: string[];
}

export interface AgentStackConfig {
  cwd: string;
  denoExecutable: string;
  npmExecutable: string;
  mcpEntryPoint: string;
  cockpitEntryPoint: string;
  uiRoot: string;
  uiScript: string;
  mcpHostname: string;
  cockpitHostname: string;
  uiHostname: string;
  mcpPort: number;
  cockpitPort: number;
  uiPort: number;
  cockpitHealthPath: string;
  workspaceId: string;
  dev: boolean;
  ui: boolean;
  readinessTimeoutMs: number;
  readinessPollMs: number;
  shutdownGraceMs: number;
  mcpPermissions: ChildPermissions;
  cockpitPermissions: ChildPermissions;
  mcpExtraArgs: string[];
  cockpitExtraArgs: string[];
  uiExtraArgs: string[];
}

export interface ParsedAgentStackArgs {
  config: AgentStackConfig;
  help: boolean;
}

export interface ServiceCommand {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly processGroup?: boolean;
  readonly readiness?: ServiceReadiness;
  readonly exitPolicy?: "stop-stack" | "keep-stack";
}

export interface ServiceReadiness {
  readonly url: string;
  readonly timeoutMs: number;
  readonly pollMs: number;
}

export interface ManagedProcess {
  readonly status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
  groupIsRunning?(): boolean;
}

export interface SupervisorRuntime {
  spawn(spec: ServiceCommand): ManagedProcess;
  listen(signal: StackSignal, listener: () => void): () => void;
  schedule(callback: () => void, delayMs: number): () => void;
  probe(url: string, timeoutMs: number): CancellableProbe;
  now(): number;
}

export interface CancellableProbe {
  readonly result: Promise<boolean>;
  cancel(): void;
}

export type StackOutcome =
  | {
    readonly kind: "signal";
    readonly signal: StackSignal;
  }
  | {
    readonly kind: "service-exit";
    readonly service: string;
    readonly status: Deno.CommandStatus;
  }
  | {
    readonly kind: "spawn-error";
    readonly service: string;
    readonly error: unknown;
  }
  | {
    readonly kind: "readiness-error";
    readonly service: string;
    readonly url: string;
  };

interface RunningService {
  readonly spec: ServiceCommand;
  readonly process: ManagedProcess;
  status: Promise<Deno.CommandStatus>;
  settled: boolean;
}

const PERMISSION_KEYS = ["read", "write", "net", "env", "run"] as const;
type PermissionKey = (typeof PERMISSION_KEYS)[number];

const SCALAR_FLAGS = new Set([
  "--cwd",
  "--deno",
  "--npm",
  "--mcp-entry",
  "--cockpit-entry",
  "--ui-root",
  "--ui-script",
  "--mcp-hostname",
  "--cockpit-hostname",
  "--ui-hostname",
  "--mcp-port",
  "--cockpit-port",
  "--ui-port",
  "--cockpit-health-path",
  "--workspace-id",
  "--readiness-timeout-ms",
  "--readiness-poll-ms",
  "--shutdown-grace-ms",
]);

const LIST_FLAGS = new Set([
  "--mcp-allow-read",
  "--mcp-allow-write",
  "--mcp-allow-net",
  "--mcp-allow-env",
  "--mcp-allow-run",
  "--cockpit-allow-read",
  "--cockpit-allow-write",
  "--cockpit-allow-net",
  "--cockpit-allow-env",
  "--cockpit-allow-run",
  "--mcp-arg",
  "--cockpit-arg",
  "--ui-arg",
]);

export function defaultAgentStackConfig(): AgentStackConfig {
  return {
    cwd: Deno.cwd(),
    denoExecutable: Deno.execPath(),
    npmExecutable: "npm",
    mcpEntryPoint: "server.ts",
    cockpitEntryPoint: "scripts/serve/serve-native-workbench.ts",
    uiRoot: "src/ui",
    uiScript: "dev:thread",
    mcpHostname: "127.0.0.1",
    cockpitHostname: "127.0.0.1",
    uiHostname: "127.0.0.1",
    mcpPort: 3020,
    cockpitPort: 5175,
    uiPort: 5173,
    cockpitHealthPath: "/healthz",
    workspaceId: "primary",
    dev: false,
    ui: false,
    readinessTimeoutMs: 10_000,
    readinessPollMs: 100,
    shutdownGraceMs: 5_000,
    mcpPermissions: {
      read: ["config", "state", "src/ui", "mcp-server.yaml"],
      write: ["state/local"],
      net: ["127.0.0.1", "localhost"],
      env: [
        "MCP_FLEET_MANIFEST",
        "MCP_RUN_FIXTURE",
        "MCP_MRTR_SIGNING_KEY",
        "MCP_AUTH_PROVIDER",
        "MCP_AUTH_AUDIENCE",
        "MCP_AUTH_RESOURCE",
        "MCP_AUTH_DOMAIN",
        "MCP_AUTH_ISSUER",
        "MCP_AUTH_JWKS_URI",
        "MCP_AUTH_SCOPES",
        "MCP_AUTH_RESOURCE_METADATA_URL",
      ],
      run: ["docker"],
    },
    cockpitPermissions: {
      read: [
        "state/local",
        "src/ui/dist/thread",
        "config/projects",
        "config/thread-subjects",
      ],
      write: [],
      net: [],
      env: [],
      run: [],
    },
    mcpExtraArgs: [],
    cockpitExtraArgs: [],
    uiExtraArgs: [],
  };
}

export function parseAgentStackArgs(
  args: readonly string[],
  base = defaultAgentStackConfig(),
): ParsedAgentStackArgs {
  const config = cloneConfig(base);
  const replacedLists = new Set<string>();
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const raw = args[index];
    const equals = raw.indexOf("=");
    const flag = equals === -1 ? raw : raw.slice(0, equals);

    if (flag === "--help" || flag === "-h") {
      if (equals !== -1) throw new TypeError(`${flag} does not take a value`);
      help = true;
      continue;
    }
    if (
      flag === "--dev" || flag === "--watch" || flag === "--ui"
    ) {
      if (equals !== -1) throw new TypeError(`${flag} does not take a value`);
      if (flag === "--dev" || flag === "--watch") config.dev = true;
      if (flag === "--ui") config.ui = true;
      continue;
    }
    if (!SCALAR_FLAGS.has(flag) && !LIST_FLAGS.has(flag)) {
      throw new TypeError(`Unknown argument: ${raw}`);
    }

    let value: string;
    if (equals !== -1) {
      value = raw.slice(equals + 1);
    } else {
      index++;
      if (index >= args.length) throw new TypeError(`${flag} requires a value`);
      value = args[index];
    }

    if (LIST_FLAGS.has(flag)) {
      setListFlag(config, flag, value, replacedLists);
      continue;
    }

    const required = nonEmpty(value, flag);
    switch (flag) {
      case "--cwd":
        config.cwd = required;
        break;
      case "--deno":
        config.denoExecutable = required;
        break;
      case "--npm":
        config.npmExecutable = required;
        break;
      case "--mcp-entry":
        config.mcpEntryPoint = required;
        break;
      case "--cockpit-entry":
        config.cockpitEntryPoint = required;
        break;
      case "--ui-root":
        config.uiRoot = required;
        break;
      case "--ui-script":
        config.uiScript = required;
        break;
      case "--mcp-hostname":
        config.mcpHostname = hostname(required, flag);
        break;
      case "--cockpit-hostname":
        config.cockpitHostname = hostname(required, flag);
        break;
      case "--ui-hostname":
        config.uiHostname = hostname(required, flag);
        break;
      case "--mcp-port":
        config.mcpPort = port(required, flag);
        break;
      case "--cockpit-port":
        config.cockpitPort = port(required, flag);
        break;
      case "--ui-port":
        config.uiPort = port(required, flag);
        break;
      case "--cockpit-health-path":
        config.cockpitHealthPath = healthPath(required, flag);
        break;
      case "--workspace-id":
        config.workspaceId = required;
        break;
      case "--readiness-timeout-ms":
        config.readinessTimeoutMs = positiveInteger(required, flag);
        break;
      case "--readiness-poll-ms":
        config.readinessPollMs = positiveInteger(required, flag);
        break;
      case "--shutdown-grace-ms":
        config.shutdownGraceMs = nonNegativeInteger(required, flag);
        break;
    }
  }

  return { config, help };
}

export function buildAgentStackCommands(
  config: AgentStackConfig,
): ServiceCommand[] {
  validateConfig(config);
  const mcpPermissions = clonePermissions(config.mcpPermissions);
  mcpPermissions.net = unique([
    ...mcpPermissions.net,
    networkTarget(config.mcpHostname, config.mcpPort),
  ]);
  const cockpitPermissions = clonePermissions(config.cockpitPermissions);
  cockpitPermissions.net = unique([
    ...cockpitPermissions.net,
    networkTarget(config.cockpitHostname, config.cockpitPort),
  ]);
  const watchArgs = config.dev ? ["--watch", "--no-clear-screen"] : [];

  /**
   * The passive projection boots first. Its health contract gates the MCP
   * authority. Once ready, its projection may fail without revoking MCP.
   */
  const commands: ServiceCommand[] = [
    {
      name: "cockpit",
      command: config.denoExecutable,
      cwd: config.cwd,
      exitPolicy: "keep-stack",
      readiness: {
        url: httpUrl(
          config.cockpitHostname,
          config.cockpitPort,
          config.cockpitHealthPath,
        ),
        timeoutMs: config.readinessTimeoutMs,
        pollMs: config.readinessPollMs,
      },
      args: [
        "run",
        ...watchArgs,
        ...denoPermissionArgs(cockpitPermissions),
        config.cockpitEntryPoint,
        `--host=${config.cockpitHostname}`,
        `--port=${config.cockpitPort}`,
        "--no-seed",
        `--workspace-id=${config.workspaceId}`,
        ...config.cockpitExtraArgs,
      ],
    },
    {
      name: "mcp",
      command: config.denoExecutable,
      cwd: config.cwd,
      args: [
        "run",
        ...watchArgs,
        ...denoPermissionArgs(mcpPermissions),
        config.mcpEntryPoint,
        `--hostname=${config.mcpHostname}`,
        `--port=${config.mcpPort}`,
        ...config.mcpExtraArgs,
      ],
    },
  ];

  if (config.ui) {
    commands.push({
      name: "ui",
      command: config.npmExecutable,
      cwd: config.cwd,
      processGroup: true,
      env: {
        CASYS_COCKPIT_BFF_PORT: String(config.cockpitPort),
        CASYS_COCKPIT_UI_PORT: String(config.uiPort),
      },
      args: [
        "--prefix",
        config.uiRoot,
        "run",
        config.uiScript,
        "--",
        `--host=${config.uiHostname}`,
        `--port=${config.uiPort}`,
        "--strictPort",
        ...config.uiExtraArgs,
      ],
    });
  }
  return commands;
}

export const denoSupervisorRuntime: SupervisorRuntime = {
  spawn(spec) {
    if (spec.processGroup && Deno.build.os === "windows") {
      throw new TypeError(
        "Detached process-group supervision for --ui is available only on POSIX",
      );
    }
    const child = new Deno.Command(spec.command, {
      args: [...spec.args],
      cwd: spec.cwd,
      env: spec.env ? { ...spec.env } : undefined,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      detached: spec.processGroup === true,
    }).spawn();
    if (!spec.processGroup) return child;
    return {
      status: child.status,
      kill(signal) {
        try {
          Deno.kill(-child.pid, signal);
        } catch {
          // A group leader can exit just before teardown; direct kill is fallback only.
          child.kill(signal);
        }
      },
      groupIsRunning() {
        try {
          Deno.kill(-child.pid, 0);
          return true;
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return false;
          throw error;
        }
      },
    };
  },
  listen(signal, listener) {
    Deno.addSignalListener(signal, listener);
    return () => Deno.removeSignalListener(signal, listener);
  },
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
  probe(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const result = fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    }).then((response) => response.ok).catch(() => false).finally(() => {
      clearTimeout(timer);
    });
    return {
      result,
      cancel() {
        clearTimeout(timer);
        controller.abort();
      },
    };
  },
  now: performance.now.bind(performance),
};

export async function superviseServices(
  specs: readonly ServiceCommand[],
  options: {
    readonly runtime?: SupervisorRuntime;
    readonly shutdownGraceMs?: number;
  } = {},
): Promise<StackOutcome> {
  if (specs.length === 0) throw new TypeError("At least one service is required");
  const names = new Set<string>();
  for (const spec of specs) {
    if (spec.name.trim() === "") throw new TypeError("Service names must not be empty");
    if (names.has(spec.name)) {
      throw new TypeError(`Duplicate service name: ${spec.name}`);
    }
    names.add(spec.name);
  }
  if (specs.every((spec) => spec.exitPolicy === "keep-stack")) {
    throw new TypeError("At least one service must use the stop-stack exit policy");
  }
  const shutdownGraceMs = options.shutdownGraceMs ?? 5_000;
  if (!Number.isSafeInteger(shutdownGraceMs) || shutdownGraceMs < 0) {
    throw new TypeError("shutdownGraceMs must be a non-negative integer");
  }
  const runtime = options.runtime ?? denoSupervisorRuntime;
  const running: RunningService[] = [];
  let signalRequested = false;
  let initialSignalSent = false;
  let stopping = false;
  let resolveSignal!: (outcome: StackOutcome) => void;
  const signalOutcome = new Promise<StackOutcome>((resolve) => {
    resolveSignal = resolve;
  });
  const removeSignalListeners: Array<() => void> = [];

  try {
    for (const signal of STACK_SIGNALS) {
      removeSignalListeners.push(
        runtime.listen(signal, () => {
          if (signalRequested || stopping) {
            signalUnsettled(running, "SIGKILL");
            return;
          }
          signalRequested = true;
          initialSignalSent = true;
          signalUnsettled(running, signal);
          resolveSignal({ kind: "signal", signal });
        }),
      );
    }

    for (const spec of specs) {
      try {
        const process = runtime.spawn(spec);
        const service: RunningService = {
          spec,
          process,
          status: Promise.resolve({ success: false, code: 1, signal: null }),
          settled: false,
        };
        service.status = process.status.then((status) => {
          service.settled = true;
          return status;
        });
        running.push(service);
        if (spec.readiness) {
          const earlyOutcome = await waitForReadiness(
            service,
            spec.readiness,
            signalOutcome,
            runtime,
          );
          if (earlyOutcome) {
            stopping = true;
            await stopServices(
              running,
              shutdownGraceMs,
              runtime,
              earlyOutcome.kind === "signal" && initialSignalSent ? null : "SIGTERM",
            );
            return earlyOutcome;
          }
        }
      } catch (error) {
        stopping = true;
        await stopServices(running, shutdownGraceMs, runtime);
        return { kind: "spawn-error", service: spec.name, error };
      }
    }

    const serviceOutcomes = running.filter((service) =>
      service.spec.exitPolicy !== "keep-stack"
    ).map((service) =>
      service.status.then((status): StackOutcome => ({
        kind: "service-exit",
        service: service.spec.name,
        status,
      }))
    );
    const outcome = await Promise.race([signalOutcome, ...serviceOutcomes]);
    stopping = true;
    await stopServices(
      running,
      shutdownGraceMs,
      runtime,
      outcome.kind === "signal" && initialSignalSent ? null : "SIGTERM",
    );
    return outcome;
  } finally {
    for (const remove of removeSignalListeners) remove();
  }
}

export function stackExitCode(outcome: StackOutcome): number {
  if (outcome.kind === "signal") {
    return outcome.signal === "SIGINT" ? 130 : 143;
  }
  if (outcome.kind === "spawn-error" || outcome.kind === "readiness-error") return 1;
  if (outcome.status.success) return 1;
  return outcome.status.code > 0 && outcome.status.code <= 255
    ? outcome.status.code
    : 1;
}

export const AGENT_STACK_USAGE = `Usage:
  deno run --allow-run=deno --allow-net=127.0.0.1:5175 \\
    scripts/serve/supervise-agent-stack.ts [options]

Starts the MCP server and agent-focused cockpit BFF as one supervised stack.
The cockpit must be ready before MCP starts. A later cockpit exit does not revoke
MCP authority; MCP and optional UI exits stop the linked stack. SIGINT and
SIGTERM are forwarded cleanly.

Modes:
  --dev, --watch              Watch and restart both Deno services
  --ui                        Start Vite via npm (parent needs unscoped --allow-run)

Endpoints:
  --mcp-hostname HOST         MCP bind hostname (default: 127.0.0.1)
  --mcp-port PORT             MCP port (default: 3020)
  --cockpit-hostname HOST     Cockpit BFF bind hostname (default: 127.0.0.1)
  --cockpit-port PORT         Agent-focused cockpit port (default: 5175)
  --ui-hostname HOST          Vite bind hostname (default: 127.0.0.1)
  --ui-port PORT              Vite port (default: 5173)
  --workspace-id ID           Focused cockpit workspace (default: primary)
  --cockpit-health-path PATH  Readiness path (default: /healthz)

Commands:
  --cwd PATH                  Child working directory
  --deno PATH                 Deno executable
  --npm PATH                  npm executable used only with --ui
  --mcp-entry PATH            MCP entry point
  --cockpit-entry PATH        Cockpit BFF entry point
  --ui-root PATH              npm prefix (default: src/ui)
  --ui-script NAME            npm Vite script (default: dev:thread)
  --readiness-timeout-ms MS   BFF readiness deadline (default: 10000)
  --readiness-poll-ms MS      BFF readiness polling period (default: 100)
  --shutdown-grace-ms MS      Grace before SIGKILL (default: 5000)

Permissions and passthrough arguments:
  --mcp-allow-{read,write,net,env,run}=CSV
  --cockpit-allow-{read,write,net,env,run}=CSV
  --mcp-arg=ARG --cockpit-arg=ARG --ui-arg=ARG

For --ui on POSIX, the parent needs unscoped --allow-run so Deno can signal the
detached npm/Vite process group; keep that mode development-only. Windows rejects
this optional mode before spawning npm. The normal MCP+BFF path uses
--allow-run=deno. The parent also needs narrowly scoped net access to the
configured cockpit /healthz endpoint. Child Deno permissions remain scoped and
fail closed.`;

function setListFlag(
  config: AgentStackConfig,
  flag: string,
  value: string,
  replacedLists: Set<string>,
): void {
  if (flag === "--mcp-arg" || flag === "--cockpit-arg" || flag === "--ui-arg") {
    const argument = nonEmpty(value, flag);
    rejectReservedExtraArgument(flag, argument);
    const target = flag === "--mcp-arg"
      ? config.mcpExtraArgs
      : flag === "--cockpit-arg"
      ? config.cockpitExtraArgs
      : config.uiExtraArgs;
    target.push(argument);
    return;
  }
  const match = /^--(mcp|cockpit)-allow-(read|write|net|env|run)$/.exec(flag);
  if (!match) throw new TypeError(`Unknown list argument: ${flag}`);
  const service = match[1] as "mcp" | "cockpit";
  const key = match[2] as PermissionKey;
  const permissions = service === "mcp"
    ? config.mcpPermissions
    : config.cockpitPermissions;
  const values = csv(value);
  if (!replacedLists.has(flag)) {
    permissions[key] = [];
    replacedLists.add(flag);
  }
  permissions[key].push(...values);
}

function cloneConfig(config: AgentStackConfig): AgentStackConfig {
  return {
    ...config,
    mcpPermissions: clonePermissions(config.mcpPermissions),
    cockpitPermissions: clonePermissions(config.cockpitPermissions),
    mcpExtraArgs: [...config.mcpExtraArgs],
    cockpitExtraArgs: [...config.cockpitExtraArgs],
    uiExtraArgs: [...config.uiExtraArgs],
  };
}

function clonePermissions(permissions: ChildPermissions): ChildPermissions {
  return {
    read: [...permissions.read],
    write: [...permissions.write],
    net: [...permissions.net],
    env: [...permissions.env],
    run: [...permissions.run],
  };
}

function denoPermissionArgs(permissions: ChildPermissions): string[] {
  const args = ["--no-prompt"];
  for (const key of PERMISSION_KEYS) {
    const values = unique(permissions[key]);
    if (values.length > 0) args.push(`--allow-${key}=${values.join(",")}`);
  }
  return args;
}

async function waitForReadiness(
  service: RunningService,
  readiness: ServiceReadiness,
  signalOutcome: Promise<StackOutcome>,
  runtime: SupervisorRuntime,
): Promise<StackOutcome | undefined> {
  const startedAt = runtime.now();
  const serviceOutcome = service.status.then((status): StackOutcome => ({
    kind: "service-exit",
    service: service.spec.name,
    status,
  }));

  while (runtime.now() - startedAt < readiness.timeoutMs) {
    const remaining = readiness.timeoutMs - (runtime.now() - startedAt);
    const attempt = runtime.probe(readiness.url, Math.min(remaining, 1_000));
    const probeOutcome = attempt.result.then((ready) => ({
      kind: "probe" as const,
      ready,
    }));
    const outcome = await Promise.race([
      signalOutcome,
      serviceOutcome,
      probeOutcome,
    ]);
    attempt.cancel();
    if (outcome.kind !== "probe") return outcome;
    if (outcome.ready) return undefined;

    const afterProbe = runtime.now() - startedAt;
    if (afterProbe >= readiness.timeoutMs) break;
    const delay = scheduledDelay(
      runtime,
      Math.min(readiness.pollMs, readiness.timeoutMs - afterProbe),
    );
    const delayedOutcome = await Promise.race([
      signalOutcome,
      serviceOutcome,
      delay.result,
    ]);
    delay.cancel();
    if (delayedOutcome.kind !== "delay") return delayedOutcome;
  }

  return {
    kind: "readiness-error",
    service: service.spec.name,
    url: readiness.url,
  };
}

function scheduledDelay(
  runtime: SupervisorRuntime,
  delayMs: number,
): { result: Promise<{ kind: "delay" }>; cancel(): void } {
  let resolve!: (value: { kind: "delay" }) => void;
  const result = new Promise<{ kind: "delay" }>((resolved) => {
    resolve = resolved;
  });
  const cancelTimer = runtime.schedule(() => resolve({ kind: "delay" }), delayMs);
  return { result, cancel: cancelTimer };
}

async function stopServices(
  services: readonly RunningService[],
  graceMs: number,
  runtime: SupervisorRuntime,
  initialSignal: Deno.Signal | null = "SIGTERM",
): Promise<void> {
  if (initialSignal) signalUnsettled(services, initialSignal);
  if (await settleBeforeTimeout(services, graceMs, runtime)) return;
  signalUnsettled(services, "SIGKILL");
  await settleBeforeTimeout(services, graceMs, runtime);
}

function signalUnsettled(
  services: readonly RunningService[],
  signal: Deno.Signal,
): void {
  for (const service of services) {
    if (service.settled && !service.spec.processGroup) continue;
    try {
      service.process.kill(signal);
    } catch {
      // The status promise is authoritative; kill may race a natural exit.
    }
  }
}

async function settleBeforeTimeout(
  services: readonly RunningService[],
  timeoutMs: number,
  runtime: SupervisorRuntime,
): Promise<boolean> {
  const startedAt = runtime.now();
  while (services.some(serviceIsRunning)) {
    const elapsed = runtime.now() - startedAt;
    if (elapsed >= timeoutMs) return false;
    const leaders = services.filter((service) => !service.settled);
    const delay = scheduledDelay(runtime, Math.min(25, timeoutMs - elapsed));
    await Promise.race([
      delay.result,
      ...leaders.map((service) => service.status),
    ]);
    delay.cancel();
  }
  return true;
}

function serviceIsRunning(service: RunningService): boolean {
  if (!service.settled) return true;
  if (!service.spec.processGroup) return false;
  return service.process.groupIsRunning?.() ?? false;
}

function validateConfig(config: AgentStackConfig): void {
  hostname(config.mcpHostname, "mcpHostname");
  hostname(config.cockpitHostname, "cockpitHostname");
  hostname(config.uiHostname, "uiHostname");
  port(String(config.mcpPort), "mcpPort");
  port(String(config.cockpitPort), "cockpitPort");
  port(String(config.uiPort), "uiPort");
  healthPath(config.cockpitHealthPath, "cockpitHealthPath");
  positiveInteger(String(config.readinessTimeoutMs), "readinessTimeoutMs");
  positiveInteger(String(config.readinessPollMs), "readinessPollMs");
  nonNegativeInteger(String(config.shutdownGraceMs), "shutdownGraceMs");
  for (
    const value of [
      config.cwd,
      config.denoExecutable,
      config.npmExecutable,
      config.mcpEntryPoint,
      config.cockpitEntryPoint,
      config.uiRoot,
      config.uiScript,
      config.workspaceId,
    ]
  ) {
    nonEmpty(value, "stack configuration value");
  }
  for (const argument of config.mcpExtraArgs) {
    rejectReservedExtraArgument("--mcp-arg", argument);
  }
  for (const argument of config.cockpitExtraArgs) {
    rejectReservedExtraArgument("--cockpit-arg", argument);
  }
  for (const argument of config.uiExtraArgs) {
    rejectReservedExtraArgument("--ui-arg", argument);
  }
}

function networkTarget(host: string, targetPort: number): string {
  const normalized = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${normalized}:${targetPort}`;
}

function httpUrl(host: string, targetPort: number, path: string): string {
  const normalized = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalized}:${targetPort}${path}`;
}

function hostname(value: string, flag: string): string {
  if (value.includes(",")) {
    throw new TypeError(`${flag} must not contain a comma`);
  }
  return nonEmpty(value, flag);
}

function port(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`${flag} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${flag} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function nonEmpty(value: string, flag: string): string {
  if (value.trim() === "") throw new TypeError(`${flag} must not be empty`);
  return value;
}

function healthPath(value: string, flag: string): string {
  if (!/^\/[^\s?#]*$/.test(value)) {
    throw new TypeError(`${flag} must be an absolute path without query or fragment`);
  }
  return value;
}

function rejectReservedExtraArgument(flag: string, argument: string): void {
  const reserved = flag === "--mcp-arg"
    ? ["--hostname", "--port"]
    : flag === "--cockpit-arg"
    ? [
      "--host",
      "--port",
      "--workspace-id",
      "--no-seed",
      "--seed",
    ]
    : ["--host", "--port", "--strictPort"];
  if (
    reserved.some((name) => argument === name || argument.startsWith(`${name}=`))
  ) {
    throw new TypeError(`${flag} cannot override supervised argument ${argument}`);
  }
}

function csv(value: string): string[] {
  if (value === "") return [];
  const values = value.split(",").map((entry) => entry.trim());
  if (values.some((entry) => entry === "")) {
    throw new TypeError("Permission lists must not contain empty entries");
  }
  return values;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  try {
    const parsed = parseAgentStackArgs(Deno.args);
    if (parsed.help) {
      console.log(AGENT_STACK_USAGE);
    } else {
      const specs = buildAgentStackCommands(parsed.config);
      console.error(
        `Agent stack: starting ${specs.map((spec) => spec.name).join(", ")}`,
      );
      const outcome = await superviseServices(specs, {
        shutdownGraceMs: parsed.config.shutdownGraceMs,
      });
      if (outcome.kind === "signal") {
        console.error(`Agent stack: stopped by ${outcome.signal}`);
      } else if (outcome.kind === "spawn-error") {
        console.error(
          `Agent stack: could not start ${outcome.service}: ${
            formatError(outcome.error)
          }`,
        );
      } else if (outcome.kind === "readiness-error") {
        console.error(
          `Agent stack: ${outcome.service} was not ready at ${outcome.url}`,
        );
      } else {
        console.error(
          `Agent stack: ${outcome.service} exited (code ${outcome.status.code})`,
        );
      }
      Deno.exitCode = stackExitCode(outcome);
    }
  } catch (error) {
    console.error(`Agent stack: ${formatError(error)}`);
    Deno.exitCode = 1;
  }
}
