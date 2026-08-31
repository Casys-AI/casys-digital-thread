import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  buildAgentStackCommands,
  defaultAgentStackConfig,
  type ManagedProcess,
  parseAgentStackArgs,
  type ServiceCommand,
  stackExitCode,
  type StackSignal,
  superviseServices,
  type SupervisorRuntime,
} from "./supervise-agent-stack.ts";

const EXITED = { success: true, code: 0, signal: null } satisfies Deno.CommandStatus;
const FAILED = { success: false, code: 42, signal: null } satisfies Deno.CommandStatus;
const denoConfig = JSON.parse(
  await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
) as { tasks: Record<string, string> };

Deno.test("start:agent grants the supervisor portable run permission", () => {
  const command = denoConfig.tasks["start:agent"];

  assertStringIncludes(command, "deno run --allow-run --allow-net=127.0.0.1:5175");
  assert(!command.includes("--allow-run=deno"));
});

Deno.test("the normal stack starts only MCP and the focused cockpit", () => {
  const config = defaultAgentStackConfig();
  config.cwd = "/workspace";
  config.denoExecutable = "/bin/deno";

  const commands = buildAgentStackCommands(config);

  assertEquals(defaultAgentStackConfig().uiPort, 5173);
  assertEquals(defaultAgentStackConfig().cockpitPort, 5175);
  assertEquals(commands.map((command) => command.name), ["cockpit", "mcp"]);
  const [cockpit, mcp] = commands;
  assertEquals(cockpit.command, "/bin/deno");
  assertEquals(cockpit.exitPolicy, "keep-stack");
  assertEquals(cockpit.readiness?.url, "http://127.0.0.1:5175/healthz");
  assert(cockpit.args.includes("--allow-net=127.0.0.1:5175"));
  assert(
    cockpit.args.includes(
      "--allow-read=state,src/ui/dist/thread,config/projects,config/thread-subjects",
    ),
  );
  assert(!cockpit.args.some((argument) => argument.startsWith("--allow-write")));
  assert(!cockpit.args.some((argument) => argument.startsWith("--allow-env")));
  assert(!cockpit.args.some((argument) => argument.startsWith("--allow-run")));
  assert(cockpit.args.includes("--workspace-id=primary"));
  assert(cockpit.args.includes("--no-seed"));
  assert(
    !cockpit.args.some((argument) => argument.includes("review-intent")),
  );
  assert(
    mcp.args.includes(
      "--allow-read=config,state,src/ui,mcp-server.yaml,node_modules",
    ),
  );
  assert(mcp.args.includes("--node-modules-dir=auto"));
  assert(mcp.args.includes("--allow-write=state/local"));
  assert(!mcp.args.some((argument) => argument.includes("review-intent")));
  assert(mcp.args.includes("--allow-net=127.0.0.1,localhost,127.0.0.1:3020"));
  assert(
    mcp.args.includes(
      "--allow-env=LOG,MCP_FLEET_MANIFEST,MCP_RUN_FIXTURE,MCP_MRTR_SIGNING_KEY," +
        "CASYS_CHRONO_MCP_BEARER_TOKEN,MCP_AUTH_PROVIDER,MCP_AUTH_AUDIENCE," +
        "MCP_AUTH_RESOURCE,MCP_AUTH_DOMAIN," +
        "MCP_AUTH_ISSUER,MCP_AUTH_JWKS_URI,MCP_AUTH_SCOPES," +
        "MCP_AUTH_RESOURCE_METADATA_URL,NAPI_RS_ENFORCE_VERSION_CHECK," +
        "NAPI_RS_NATIVE_LIBRARY_PATH,NAPI_RS_FORCE_WASI,NAPI_RS_WASI_FLAVOR," +
        "MSB_PATH,MSB_LIBKRUNFW_PATH,MSB_CONFIG_PATH,MSB_HOME,MSB_BACKEND," +
        "MSB_API_URL,MSB_API_KEY,MSB_PROFILE",
    ),
  );
  assert(mcp.args.includes("--allow-run=docker"));
  assert(mcp.args.includes("--allow-ffi=node_modules"));
  assert(!cockpit.args.some((argument) => argument.startsWith("--allow-ffi")));
  assert(!mcp.args.includes("--allow-net"));
  assert(!commands.some((command) => command.command === "npm"));
});

Deno.test("dev UI is an explicit third service with configurable ports", () => {
  const { config } = parseAgentStackArgs([
    "--dev",
    "--ui",
    "--cockpit-port=6200",
    "--mcp-hostname=localhost",
    "--mcp-port=6202",
    "--ui-port",
    "6201",
    "--mcp-allow-net=engineering.internal:443",
    "--mcp-allow-net=localhost:3009",
    "--cockpit-arg=--project-id=drone",
  ]);

  const commands = buildAgentStackCommands(config);

  assertEquals(commands.map((command) => command.name), ["cockpit", "mcp", "ui"]);
  assert(commands[0].args.includes("--watch"));
  assert(
    commands[1].args.includes(
      "--allow-net=engineering.internal:443,localhost:3009,localhost:6202",
    ),
  );
  assert(commands[0].args.includes("--port=6200"));
  assert(commands[0].args.includes("--allow-net=127.0.0.1:6200"));
  assert(
    !commands[0].args.some((argument) => argument.includes("review-intent")),
  );
  assert(commands[0].args.includes("--project-id=drone"));
  assertEquals(commands[2].env, {
    CASYS_COCKPIT_BFF_PORT: "6200",
    CASYS_COCKPIT_UI_PORT: "6201",
  });
  assert(commands[2].args.includes("--port=6201"));
  assertEquals(commands[2].processGroup, true);
});

Deno.test("watch is a dev-mode alias for task integration", () => {
  const { config } = parseAgentStackArgs(["--watch"]);
  const commands = buildAgentStackCommands(config);

  assert(commands.every((command) => command.args.includes("--watch")));
});

Deno.test("the retired review-intent outbox flag is unknown", () => {
  assertThrows(
    () => parseAgentStackArgs(["--review-intent-dir=/var/tmp/casys-review-outbox"]),
    TypeError,
    "Unknown argument",
  );
});

Deno.test("the canonical stack cannot disable focused workspace mode", () => {
  assertThrows(
    () => parseAgentStackArgs(["--no-workspace"]),
    TypeError,
    "Unknown argument",
  );
});

Deno.test("passthrough arguments cannot override supervised ports or focus", () => {
  assertThrows(
    () => parseAgentStackArgs(["--mcp-arg=--port=9999"]),
    TypeError,
    "cannot override supervised argument",
  );
  assertThrows(
    () => parseAgentStackArgs(["--cockpit-arg=--workspace-id=other"]),
    TypeError,
    "cannot override supervised argument",
  );
  assertThrows(
    () => parseAgentStackArgs(["--ui-arg=--port=9998"]),
    TypeError,
    "cannot override supervised argument",
  );
});

Deno.test("MCP passthrough cannot enable local execution", () => {
  assertThrows(
    () => parseAgentStackArgs(["--mcp-arg=--local-execution"]),
    TypeError,
    "cannot override supervised argument",
  );
});

Deno.test("cockpit readiness gates MCP spawning", async () => {
  const runtime = new FakeRuntime();
  const specs = serviceSpecs("cockpit", "mcp");
  specs[0] = {
    ...specs[0],
    readiness: {
      url: "http://127.0.0.1:5175/healthz",
      timeoutMs: 20,
      pollMs: 1,
    },
  };

  const supervising = superviseServices(specs, {
    runtime,
    shutdownGraceMs: 20,
  });
  assertEquals(runtime.specs.map((spec) => spec.name), ["cockpit"]);
  await until(() => runtime.specs.length === 2);
  assertEquals(runtime.specs.map((spec) => spec.name), ["cockpit", "mcp"]);
  runtime.processes[1].exit(FAILED);

  const outcome = await supervising;
  assertEquals(outcome.kind, "service-exit");
});

Deno.test("readiness timeout never exposes MCP authority", async () => {
  const runtime = new FakeRuntime({ probeReady: false });
  const specs = serviceSpecs("cockpit", "mcp");
  specs[0] = {
    ...specs[0],
    readiness: {
      url: "http://127.0.0.1:5175/healthz",
      timeoutMs: 1,
      pollMs: 1,
    },
  };

  const outcome = await superviseServices(specs, {
    runtime,
    shutdownGraceMs: 20,
  });

  assertEquals(outcome, {
    kind: "readiness-error",
    service: "cockpit",
    url: "http://127.0.0.1:5175/healthz",
  });
  assertEquals(runtime.specs.map((spec) => spec.name), ["cockpit"]);
  assertEquals(runtime.processes[0].signals, ["SIGTERM"]);
});

Deno.test("a service failure terminates every surviving sibling", async () => {
  const runtime = new FakeRuntime();
  const supervising = superviseServices(serviceSpecs("mcp", "cockpit"), {
    runtime,
    shutdownGraceMs: 20,
  });
  runtime.processes[0].exit(FAILED);

  const outcome = await supervising;

  assertEquals(outcome, {
    kind: "service-exit",
    service: "mcp",
    status: FAILED,
  });
  assertEquals(runtime.processes[0].signals, []);
  assertEquals(runtime.processes[1].signals, ["SIGTERM"]);
  assertEquals(runtime.listenerCount(), 0);
  assertEquals(stackExitCode(outcome), 42);
});

Deno.test("SIGINT shuts down all services and retains the conventional exit code", async () => {
  const runtime = new FakeRuntime();
  const supervising = superviseServices(serviceSpecs("mcp", "cockpit", "ui"), {
    runtime,
    shutdownGraceMs: 20,
  });

  runtime.emit("SIGINT");
  const outcome = await supervising;

  assertEquals(outcome, { kind: "signal", signal: "SIGINT" });
  assertEquals(runtime.processes.map((process) => process.signals), [
    ["SIGINT"],
    ["SIGINT"],
    ["SIGINT"],
  ]);
  assertEquals(stackExitCode(outcome), 130);
  assertEquals(runtime.listenerCount(), 0);
});

Deno.test("a second operator signal forces immediate shutdown", async () => {
  const runtime = new FakeRuntime({ exitOnTerm: false });
  const supervising = superviseServices(serviceSpecs("mcp", "cockpit"), {
    runtime,
    shutdownGraceMs: 1_000,
  });

  runtime.emit("SIGINT");
  await Promise.resolve();
  runtime.emit("SIGINT");
  const outcome = await supervising;

  assertEquals(outcome, { kind: "signal", signal: "SIGINT" });
  assertEquals(runtime.processes.map((process) => process.signals), [
    ["SIGINT", "SIGKILL"],
    ["SIGINT", "SIGKILL"],
  ]);
});

Deno.test("shutdown escalates only children that ignore SIGTERM", async () => {
  const runtime = new FakeRuntime({ exitOnTerm: false });
  const supervising = superviseServices(serviceSpecs("mcp", "cockpit"), {
    runtime,
    shutdownGraceMs: 0,
  });

  runtime.emit("SIGTERM");
  const outcome = await supervising;

  assertEquals(outcome, { kind: "signal", signal: "SIGTERM" });
  assertEquals(runtime.processes.map((process) => process.signals), [
    ["SIGTERM", "SIGKILL"],
    ["SIGTERM", "SIGKILL"],
  ]);
  assertEquals(stackExitCode(outcome), 143);
});

Deno.test("a later spawn error cleans up children already started", async () => {
  const spawnError = new Error("npm unavailable");
  const runtime = new FakeRuntime({ failSpawnAt: 1, spawnError });

  const outcome = await superviseServices(serviceSpecs("mcp", "ui"), {
    runtime,
    shutdownGraceMs: 20,
  });

  assertEquals(outcome.kind, "spawn-error");
  if (outcome.kind !== "spawn-error") throw new Error("unreachable");
  assertEquals(outcome.service, "ui");
  assertEquals(outcome.error, spawnError);
  assertEquals(runtime.processes[0].signals, ["SIGTERM"]);
  assertEquals(runtime.listenerCount(), 0);
});

Deno.test("an unexpected successful service exit still fails the linked stack", async () => {
  const runtime = new FakeRuntime();
  const supervising = superviseServices(serviceSpecs("mcp", "cockpit"), {
    runtime,
    shutdownGraceMs: 20,
  });
  runtime.processes[0].exit(EXITED);

  const outcome = await supervising;

  assertEquals(outcome.kind, "service-exit");
  assertEquals(stackExitCode(outcome), 1);
  assertEquals(runtime.processes[1].signals, ["SIGTERM"]);
});

Deno.test("a post-readiness cockpit crash does not revoke MCP authority", async () => {
  const runtime = new FakeRuntime();
  const specs = serviceSpecs("cockpit", "mcp");
  specs[0] = { ...specs[0], exitPolicy: "keep-stack" };
  const supervising = superviseServices(specs, {
    runtime,
    shutdownGraceMs: 20,
  });
  runtime.processes[0].exit(FAILED);
  await Promise.resolve();
  assertEquals(runtime.processes[1].signals, []);

  runtime.processes[1].exit(FAILED);
  const outcome = await supervising;

  assertEquals(outcome, {
    kind: "service-exit",
    service: "mcp",
    status: FAILED,
  });
});

Deno.test("supervision rejects stacks with no authoritative service", async () => {
  const specs = serviceSpecs("cockpit", "secondary-projection").map((spec) => ({
    ...spec,
    exitPolicy: "keep-stack" as const,
  }));

  await assertRejects(
    () => superviseServices(specs, { runtime: new FakeRuntime() }),
    TypeError,
    "stop-stack exit policy",
  );
});

Deno.test("a surviving Vite group is killed after its npm leader settles", async () => {
  const runtime = new FakeRuntime({ groupExitOnTerm: false });
  const specs = serviceSpecs("ui", "mcp");
  specs[0] = { ...specs[0], processGroup: true };
  const supervising = superviseServices(specs, {
    runtime,
    shutdownGraceMs: 0,
  });
  runtime.processes[0].exit(FAILED);

  const outcome = await supervising;

  assertEquals(outcome.kind, "service-exit");
  assertEquals(runtime.processes[0].signals, ["SIGTERM", "SIGKILL"]);
  assertEquals(runtime.processes[1].signals, ["SIGTERM"]);
});

Deno.test("scoped command specs never grant all Deno permissions", () => {
  const commands = buildAgentStackCommands(defaultAgentStackConfig());
  for (const command of commands) {
    const rendered = command.args.join(" ");
    assert(!command.args.includes("-A"));
    assert(!command.args.includes("--allow-all"));
    assertStringIncludes(rendered, "--no-prompt");
  }
});

function serviceSpecs(...names: string[]): ServiceCommand[] {
  return names.map((name) => ({
    name,
    command: name,
    args: [],
    cwd: "/workspace",
  }));
}

interface FakeRuntimeOptions {
  readonly exitOnTerm?: boolean;
  readonly failSpawnAt?: number;
  readonly spawnError?: Error;
  readonly probeReady?: boolean;
  readonly groupExitOnTerm?: boolean;
}

class FakeProcess implements ManagedProcess {
  readonly signals: Deno.Signal[] = [];
  readonly status: Promise<Deno.CommandStatus>;
  #resolve!: (status: Deno.CommandStatus) => void;
  #exited = false;
  #groupRunning: boolean;

  constructor(
    private readonly exitOnTerm: boolean,
    processGroup: boolean,
    private readonly groupExitOnTerm: boolean,
  ) {
    this.#groupRunning = processGroup;
    this.status = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  kill(signal: Deno.Signal): void {
    this.signals.push(signal);
    if (signal === "SIGKILL" || this.groupExitOnTerm) {
      this.#groupRunning = false;
    }
    if (signal === "SIGKILL" || this.exitOnTerm) {
      this.exit({ success: false, code: signal === "SIGKILL" ? 137 : 143, signal });
    }
  }

  groupIsRunning(): boolean {
    return this.#groupRunning;
  }

  exit(status: Deno.CommandStatus): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#resolve(status);
  }
}

class FakeRuntime implements SupervisorRuntime {
  readonly processes: FakeProcess[] = [];
  readonly specs: ServiceCommand[] = [];
  readonly #listeners = new Map<StackSignal, Set<() => void>>();
  readonly #options: Required<FakeRuntimeOptions>;

  constructor(options: FakeRuntimeOptions = {}) {
    this.#options = {
      exitOnTerm: options.exitOnTerm ?? true,
      failSpawnAt: options.failSpawnAt ?? -1,
      spawnError: options.spawnError ?? new Error("spawn failed"),
      probeReady: options.probeReady ?? true,
      groupExitOnTerm: options.groupExitOnTerm ?? true,
    };
  }

  spawn(spec: ServiceCommand): ManagedProcess {
    if (this.specs.length === this.#options.failSpawnAt) {
      throw this.#options.spawnError;
    }
    this.specs.push(spec);
    const process = new FakeProcess(
      this.#options.exitOnTerm,
      spec.processGroup === true,
      this.#options.groupExitOnTerm,
    );
    this.processes.push(process);
    return process;
  }

  listen(signal: StackSignal, listener: () => void): () => void {
    const listeners = this.#listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(signal, listeners);
    return () => listeners.delete(listener);
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  }

  probe(): { result: Promise<boolean>; cancel(): void } {
    return {
      result: Promise.resolve(this.#options.probeReady),
      cancel() {},
    };
  }

  now(): number {
    return performance.now();
  }

  emit(signal: StackSignal): void {
    for (const listener of this.#listeners.get(signal) ?? []) listener();
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}
