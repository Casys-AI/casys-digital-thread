import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../application/ports/out/mcp-tool-client.ts";
import {
  type LiveThreadGraphPatch,
  type LiveThreadUpdateJournal,
  redactLiveThreadGraphPatch,
} from "./shared/stores/live-thread-update-store.ts";

export type RecordingMcpToolPhase = "started" | "completed" | "failed";

export interface RecordingMcpToolEvent {
  phase: RecordingMcpToolPhase;
  subjectId: string;
  runId: string;
  operationId: string;
  serverId: string;
  toolName: string;
  recordedAt: string;
  /** Backend-only. Neither this call nor its arguments are stored by the sink. */
  call: McpToolCall;
  /** Backend-only provider result, available only to the explicit projector. */
  result?: McpToolResult;
  /** Backend-only failure message, available only to the explicit projector. */
  error?: string;
}

export interface RecordingMcpToolClientOptions {
  client: McpToolClient;
  updates: LiveThreadUpdateJournal;
  subjectId: string;
  runId: string;
  serverId: string;
  baseRevision: number;
  project: (event: RecordingMcpToolEvent) => LiveThreadGraphPatch;
  operationId?: (call: McpToolCall, callIndex: number) => string;
  now?: () => Date;
}

/**
 * Decorates a no-retry McpToolClient with browser-safe activity projections.
 * It calls the wrapped client exactly once and rethrows provider failures.
 */
export class RecordingMcpToolClient implements McpToolClient {
  readonly #client: McpToolClient;
  readonly #updates: LiveThreadUpdateJournal;
  readonly #subjectId: string;
  readonly #runId: string;
  readonly #serverId: string;
  readonly #baseRevision: number;
  readonly #project: RecordingMcpToolClientOptions["project"];
  readonly #operationId: NonNullable<RecordingMcpToolClientOptions["operationId"]>;
  readonly #now: () => Date;
  #callIndex = 0;

  constructor(options: RecordingMcpToolClientOptions) {
    this.#client = options.client;
    this.#updates = options.updates;
    this.#subjectId = required(options.subjectId, "subjectId");
    this.#runId = required(options.runId, "runId");
    this.#serverId = required(options.serverId, "serverId");
    if (!Number.isSafeInteger(options.baseRevision) || options.baseRevision < 0) {
      throw new TypeError("baseRevision must be a non-negative safe integer");
    }
    this.#baseRevision = options.baseRevision;
    this.#project = options.project;
    this.#operationId = options.operationId ??
      ((call, callIndex) => `${this.#serverId}:${call.name}:${callIndex}`);
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Delegates to the wrapped client's text-result channel without recording.
   *
   * Recording infrastructure is built around McpToolResult (structuredContent +
   * text). Text-only tools like syson_constraint_solve do not produce
   * structuredContent, so they cannot be recorded via the existing event schema.
   * Wiring that recording would be premature: no production DAG uses this path
   * today. If a future DAG node needs text-result recording, extend the event
   * schema and the projector before enabling it here.
   */
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return this.#client.callToolTextResult(call);
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const callIndex = ++this.#callIndex;
    const operationId = required(
      this.#operationId(call, callIndex),
      "operationId",
    );
    await this.#append({
      phase: "started",
      operationId,
      call,
    });

    let result: McpToolResult;
    try {
      // Deliberately one call: retrying an engineering operation may repeat an
      // expensive computation or a durable provider mutation.
      result = await this.#client.callTool(call);
    } catch (error) {
      await this.#append({
        phase: "failed",
        operationId,
        call,
        error: errorMessage(error),
      });
      throw error;
    }

    await this.#append({
      phase: "completed",
      operationId,
      call,
      result,
    });
    return result;
  }

  async #append(input: {
    phase: RecordingMcpToolPhase;
    operationId: string;
    call: McpToolCall;
    result?: McpToolResult;
    error?: string;
  }): Promise<void> {
    const recordedAt = this.#now().toISOString();
    const event: RecordingMcpToolEvent = {
      phase: input.phase,
      subjectId: this.#subjectId,
      runId: this.#runId,
      operationId: input.operationId,
      serverId: this.#serverId,
      toolName: input.call.name,
      recordedAt,
      call: structuredClone(input.call),
      ...(input.result ? { result: structuredClone(input.result) } : {}),
      ...(input.error ? { error: input.error } : {}),
    };
    const projected = this.#project(event);
    const redacted = redactLiveThreadGraphPatch(projected, [
      input.call.arguments,
      input.result?.structuredContent,
    ]);
    await this.#updates.append({
      subjectId: this.#subjectId,
      runId: this.#runId,
      operationId: input.operationId,
      baseRevision: this.#baseRevision,
      state: phaseState(input.phase),
      recordedAt,
      graph: redacted,
    });
  }
}

function phaseState(
  phase: RecordingMcpToolPhase,
): "running" | "fresh" | "failed" {
  switch (phase) {
    case "started":
      return "running";
    case "completed":
      return "fresh";
    case "failed":
      return "failed";
  }
}

function required(value: string, label: string): string {
  if (value.trim() === "") throw new TypeError(`${label} must not be empty`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
