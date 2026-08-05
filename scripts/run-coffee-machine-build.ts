import { parseArgs, stableId } from "./cli.ts";
import {
  CoffeeMachineBuildOrchestrator,
  type CoffeeMachineBuildRunCapture,
} from "../src/adapters/historical/coffee-machine-build-orchestrator.ts";
import {
  COFFEE_MACHINE_CAD_OPERATION_ID,
  COFFEE_MACHINE_SYSON_OPERATION_ID,
  createCoffeeMachineCadLiveProjector,
  createCoffeeMachineSysonLiveProjector,
  SerializedLiveThreadUpdateJournal,
} from "../src/adapters/projectors/coffee-machine-build-live-projector.ts";
import { FileLiveThreadUpdateStore } from "../src/adapters/stores/live-thread-update-store.ts";
import { RecordingMcpToolClient } from "../src/adapters/recording-mcp-tool-client.ts";
import { FileThreadSnapshotStore } from "../src/adapters/stores/file-thread-snapshot-store.ts";
import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../src/adapters/http-mcp-tool-client.ts";

export interface RunCoffeeMachineBuildOptions {
  declarationPath?: string;
  snapshotDirectory?: string;
  liveUpdateDirectory?: string;
  outputDirectory?: string;
  subjectId?: string;
  runId?: string;
  sysonMcpUrl?: string;
  build123dMcpUrl?: string;
  /** Test seam; production uses HttpMcpToolClient. */
  sysonClient?: McpToolClient;
  /** Test seam; production uses HttpMcpToolClient. */
  build123dClient?: McpToolClient;
  now?: () => Date;
}

export interface RunCoffeeMachineBuildResult {
  runId: string;
  subjectId: string;
  baseRevision: number;
  capturePath: string;
  capture: CoffeeMachineBuildRunCapture;
}

/**
 * Execute one reviewed SysON -> build123d capture with live graph projection.
 *
 * This runner persists only the run capture. A later canonical snapshot
 * materializer owns reconciliation; provisional nodes must stay visible until
 * that final snapshot exists.
 */
export async function runCoffeeMachineBuild(
  options: RunCoffeeMachineBuildOptions = {},
): Promise<RunCoffeeMachineBuildResult> {
  const declarationPath = options.declarationPath ??
    "config/thread-subjects/coffee-machine-cm01.build.json";
  const snapshotDirectory = options.snapshotDirectory ??
    "state/local/thread-snapshots";
  const liveUpdateDirectory = options.liveUpdateDirectory ??
    "state/local/live-thread-updates";
  const outputDirectory = options.outputDirectory ??
    "state/local/coffee-machine-build-runs";
  const subjectId = stableId(options.subjectId ?? "coffee-machine-cm01", "subjectId");
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  if (Number.isNaN(startedAt.valueOf())) {
    throw new TypeError("now returned an invalid date");
  }
  const runId = stableId(
    options.runId ?? timestampRunId(startedAt),
    "runId",
  );
  const capturePath = joinPath(outputDirectory, `${runId}.json`);
  await assertAbsent(capturePath, "build capture");

  const declaration: unknown = JSON.parse(
    await Deno.readTextFile(declarationPath),
  );
  const expectedSysonReads = sourceBindingCount(declaration);
  const snapshotStore = new FileThreadSnapshotStore(snapshotDirectory);
  const base = await snapshotStore.latest(subjectId);
  if (!base) {
    throw new Error(
      `No canonical ThreadSnapshot for ${subjectId} was found in ${snapshotDirectory}.`,
    );
  }

  const fileUpdates = new FileLiveThreadUpdateStore(liveUpdateDirectory);
  if ((await fileUpdates.list(subjectId)).some((update) => update.runId === runId)) {
    throw new Error(`Live activity for runId ${runId} already exists.`);
  }
  const updates = new SerializedLiveThreadUpdateJournal(fileUpdates, {
    expectedSysonReads,
  });
  const sysonProvider = options.sysonClient ?? new HttpMcpToolClient({
    mcpUrl: options.sysonMcpUrl ?? "http://127.0.0.1:3009/mcp",
    timeoutMs: 30_000,
  });
  const build123dProvider = options.build123dClient ?? new HttpMcpToolClient({
    mcpUrl: options.build123dMcpUrl ?? "http://127.0.0.1:3014/mcp",
    timeoutMs: 120_000,
  });
  const sysonClient = new RecordingMcpToolClient({
    client: sysonProvider,
    updates,
    subjectId,
    runId,
    serverId: "mcp-syson",
    baseRevision: base.revision,
    operationId: () => COFFEE_MACHINE_SYSON_OPERATION_ID,
    project: createCoffeeMachineSysonLiveProjector({
      runId,
      expectedSysonReads,
    }),
  });
  const build123dClient = new RecordingMcpToolClient({
    client: build123dProvider,
    updates,
    subjectId,
    runId,
    serverId: "mcp-build123d",
    baseRevision: base.revision,
    operationId: () => COFFEE_MACHINE_CAD_OPERATION_ID,
    project: createCoffeeMachineCadLiveProjector({ runId }),
  });
  const capture = await new CoffeeMachineBuildOrchestrator({
    sysonClient,
    build123dClient,
    now: () => startedAt,
  }).run(declaration);

  await Deno.mkdir(outputDirectory, { recursive: true });
  await Deno.writeTextFile(
    capturePath,
    `${JSON.stringify(capture, null, 2)}\n`,
    { createNew: true },
  );
  // Deliberately no reconcileRun(): canonical materialization must happen first.
  return {
    runId,
    subjectId,
    baseRevision: base.revision,
    capturePath,
    capture,
  };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await runCoffeeMachineBuild({
    declarationPath: args["config"],
    snapshotDirectory: args["snapshot-dir"],
    liveUpdateDirectory: args["live-update-dir"],
    outputDirectory: args["output-dir"],
    subjectId: args["subject"],
    runId: args["run-id"],
    sysonMcpUrl: args["syson-mcp-url"],
    build123dMcpUrl: args["build123d-mcp-url"],
  });
  console.log(JSON.stringify(
    {
      runId: result.runId,
      subjectId: result.subjectId,
      baseRevision: result.baseRevision,
      capturedAt: result.capture.capturedAt,
      sourceAttributes: result.capture.sourceCapture.source.exactAttributeIds.length,
      exports: result.capture.result.files.map((file) => ({
        format: file.format,
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
      capturePath: result.capturePath,
      liveActivity: "retained-until-canonical-snapshot",
    },
    null,
    2,
  ));
}

function sourceBindingCount(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("build declaration must be an object");
  }
  const sourceBindings = (value as { sourceBindings?: unknown }).sourceBindings;
  if (!Array.isArray(sourceBindings) || sourceBindings.length < 1) {
    throw new TypeError("build declaration sourceBindings must be non-empty");
  }
  return sourceBindings.length;
}

function timestampRunId(value: Date): string {
  return `coffee-machine-build-${value.toISOString().replace(/[-:.]/g, "")}`;
}

function joinPath(directory: string, name: string): string {
  if (directory.trim() === "") throw new TypeError("directory must not be empty");
  return `${directory.replace(/\/$/, "")}/${name}`;
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(`${label} already exists at ${path}`);
}
