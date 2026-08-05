import type {
  AppendLiveThreadUpdate,
  LiveThreadGraphPatch,
  LiveThreadUpdate,
  LiveThreadUpdateJournal,
} from "../stores/live-thread-update-store.ts";
import type { RecordingMcpToolEvent } from "../recording-mcp-tool-client.ts";
import type { ThreadGraphNode } from "../../contracts/thread-workbench.ts";

export const COFFEE_MACHINE_SYSON_OPERATION_ID = "coffee-machine-build-source" as const;
export const COFFEE_MACHINE_CAD_OPERATION_ID = "coffee-machine-cad-export" as const;

export interface CoffeeMachineBuildLiveProjectorOptions {
  runId: string;
  expectedSysonReads?: number;
}

/**
 * Coalesces every exact SysON value read into one stable graph identity.
 *
 * The projector is intentionally stateful: one instance belongs to one run.
 * RecordingMcpToolClient may call it concurrently, but each synchronous
 * projection advances the completed counter before the journal append.
 */
export function createCoffeeMachineSysonLiveProjector(
  options: CoffeeMachineBuildLiveProjectorOptions,
): (event: RecordingMcpToolEvent) => LiveThreadGraphPatch {
  const runId = stableRunId(options.runId);
  const expected = options.expectedSysonReads ?? 90;
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new TypeError("expectedSysonReads must be a positive safe integer");
  }
  const artifactId = sourceArtifactId(runId);
  let completed = 0;
  let failed = false;

  return (event) => {
    assertRun(event, runId, "SysON");
    if (event.toolName !== "syson_value_read") {
      throw new TypeError("SysON live projector only accepts syson_value_read");
    }
    if (event.phase === "completed") completed = Math.min(expected, completed + 1);
    if (event.phase === "failed") failed = true;
    const summary = failed
      ? `${completed}/${expected} completed · exact SysON capture failed`
      : completed === expected
      ? `${completed}/${expected} completed · exact SysON source captured`
      : `${completed}/${expected} completed · reading exact SysON values`;
    return {
      nodes: [artifactNode({
        artifactId,
        artifactKind: "sysml-source",
        label: "CoffeeMachine build source",
        system: event.serverId,
        summary,
        recordedAt: event.recordedAt,
      })],
      edges: [],
    };
  };
}

/** Projects the one build123d export call and its source-to-CAD handoff. */
export function createCoffeeMachineCadLiveProjector(
  options: CoffeeMachineBuildLiveProjectorOptions,
): (event: RecordingMcpToolEvent) => LiveThreadGraphPatch {
  const runId = stableRunId(options.runId);
  const sourceId = sourceArtifactId(runId);
  const cadId = cadArtifactId(runId);
  return (event) => {
    assertRun(event, runId, "build123d");
    if (event.toolName !== "build123d_export") {
      throw new TypeError(
        "CAD live projector only accepts build123d_export",
      );
    }
    const summary = event.phase === "started"
      ? "Generating the CoffeeMachine CAD assembly"
      : event.phase === "failed"
      ? "CoffeeMachine CAD export failed"
      : completedCadSummary(event.result?.structuredContent);
    return {
      nodes: [artifactNode({
        artifactId: cadId,
        artifactKind: "cad-model",
        label: "CoffeeMachine CAD assembly",
        system: event.serverId,
        summary,
        recordedAt: event.recordedAt,
      })],
      edges: [{
        id: `live-edge:${sourceId}:derived-from:${cadId}`,
        from: { kind: "artifact", id: sourceId },
        to: { kind: "artifact", id: cadId },
        relation: "derived_from",
        rationale:
          "The CAD assembly is generated from this run's exact SysON source capture.",
        origin: "provenance",
      }],
    };
  };
}

/**
 * Serializes journal access without serializing the wrapped MCP calls.
 *
 * SysON reads the 90 attributes concurrently. FileLiveThreadUpdateStore uses
 * read-sequence-append semantics, so one writer queue is required to preserve
 * strictly increasing JSONL sequence numbers.
 */
export class SerializedLiveThreadUpdateJournal implements LiveThreadUpdateJournal {
  readonly #inner: LiveThreadUpdateJournal;
  readonly #expectedSysonReads?: number;
  #tail: Promise<void> = Promise.resolve();
  #completedSysonReads = 0;
  #sysonFailed = false;

  constructor(
    inner: LiveThreadUpdateJournal,
    options: { expectedSysonReads?: number } = {},
  ) {
    this.#inner = inner;
    if (
      options.expectedSysonReads !== undefined &&
      (!Number.isSafeInteger(options.expectedSysonReads) ||
        options.expectedSysonReads < 1)
    ) {
      throw new TypeError(
        "expectedSysonReads must be a positive safe integer",
      );
    }
    this.#expectedSysonReads = options.expectedSysonReads;
  }

  append(input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    return this.#enqueue(() => this.#inner.append(this.#coalesce(input)));
  }

  reconcileRun(
    subjectId: string,
    runId: string,
    recordedAt?: string,
  ): Promise<LiveThreadUpdate> {
    return this.#enqueue(() => this.#inner.reconcileRun(subjectId, runId, recordedAt));
  }

  list(subjectId: string): Promise<LiveThreadUpdate[]> {
    return this.#enqueue(() => this.#inner.list(subjectId));
  }

  version(subjectId: string): Promise<number> {
    return this.#enqueue(() => this.#inner.version(subjectId));
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  #coalesce(input: AppendLiveThreadUpdate): AppendLiveThreadUpdate {
    if (
      input.operationId !== COFFEE_MACHINE_SYSON_OPERATION_ID ||
      this.#expectedSysonReads === undefined
    ) {
      return input;
    }
    if (input.state === "failed") this.#sysonFailed = true;
    if (input.state === "fresh") this.#completedSysonReads += 1;
    const state = this.#sysonFailed ? "failed" : input.state === "fresh" &&
        this.#completedSysonReads < this.#expectedSysonReads
      ? "running"
      : input.state;
    return state === input.state ? input : { ...input, state };
  }
}

export function coffeeMachineBuildSourceArtifactId(runId: string): string {
  return sourceArtifactId(stableRunId(runId));
}

export function coffeeMachineBuildCadArtifactId(runId: string): string {
  return cadArtifactId(stableRunId(runId));
}

function artifactNode(input: {
  artifactId: string;
  artifactKind: string;
  label: string;
  system: string;
  summary: string;
  recordedAt: string;
}): ThreadGraphNode {
  return {
    id: `graph:artifact:${input.artifactId}`,
    ref: { kind: "artifact", id: input.artifactId },
    entityKind: "artifact",
    artifactKind: input.artifactKind,
    label: input.label,
    system: input.system,
    // The journal replaces this with the event phase's authoritative state.
    freshness: "running",
    summary: input.summary,
    recordedAt: input.recordedAt,
  };
}

function completedCadSummary(
  structuredContent: Readonly<Record<string, unknown>> | undefined,
): string {
  const files = Array.isArray(structuredContent?.files)
    ? structuredContent.files.filter(isRecord)
    : [];
  const step = files.find((file) => file.format === "step");
  const digest = typeof step?.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(step.sha256)
    ? step.sha256
    : undefined;
  return `${files.length} exports completed · STEP ${
    digest ? `sha256:${digest.slice(0, 12)}…` : "hash unavailable"
  }`;
}

function sourceArtifactId(runId: string): string {
  return `coffee-machine-build-source-${runId}`;
}

function cadArtifactId(runId: string): string {
  return `coffee-machine-cad-${runId}`;
}

function assertRun(
  event: RecordingMcpToolEvent,
  expectedRunId: string,
  provider: string,
): void {
  if (event.runId !== expectedRunId) {
    throw new TypeError(`${provider} live projector runId mismatch`);
  }
}

function stableRunId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError("runId must be a safe stable identifier");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
