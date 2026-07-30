import type {
  EvidenceArtifact,
  ObservedRunCatalog,
  RunDetail,
  RunMeasurement,
  RunProvenance,
  RunStage,
  RunStatus,
  RunSummary,
} from "../domain/types.ts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MODEL_RUN_PREFIX = "modelica:";
// mcp-modelica bounds its active, unarchived evidence ledger to 20 records;
// requesting that maximum therefore reads the whole owner catalog, not a
// partial page that the console could incorrectly call "latest".
const MAX_LISTED_RUNS = 20;

export interface ModelicaRunObserverOptions {
  /** Streamable HTTP MCP endpoint owned by mcp-modelica. */
  mcpUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class ModelicaRunObserverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaRunObserverError";
  }
}

/**
 * Read-only projection of persisted Modelica evidence. The console talks MCP
 * to the owner service; it never reads the /runs Docker volume itself and it
 * never invokes modelica_simulate.
 */
export class ModelicaRunObserver implements ObservedRunCatalog {
  readonly #mcpUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: ModelicaRunObserverOptions) {
    this.#mcpUrl = options.mcpUrl;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
  }

  async list(): Promise<readonly RunSummary[]> {
    const response = await this.#callTool("modelica_run_list", {
      limit: MAX_LISTED_RUNS,
    });
    if (!Array.isArray(response)) {
      throw new ModelicaRunObserverError(
        "modelica_run_list returned an unsupported structuredContent contract.",
      );
    }
    return response.map((run, index) => toSummary(run, `runs[${index}]`));
  }

  async detail(id: string): Promise<RunDetail | undefined> {
    if (!id.startsWith(MODEL_RUN_PREFIX)) return undefined;
    const runId = id.slice(MODEL_RUN_PREFIX.length);
    if (runId.length === 0) return undefined;
    const response = await this.#callTool("modelica_run_get", {
      run_id: runId,
    });
    return toDetail(response, "modelica_run_get");
  }

  async #callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    let sessionId: string | undefined;
    try {
      const initialized = await this.#rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "casys-digital-thread-console",
            version: "0.1.0",
          },
        },
      });
      sessionId = initialized.response.headers.get("mcp-session-id") ?? undefined;
      requireResult(initialized.payload, "initialize");

      if (sessionId) {
        await this.#rpc(
          {
            jsonrpc: "2.0",
            method: "notifications/initialized",
          },
          sessionId,
          true,
        );
      }

      const result = await this.#rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: args },
      }, sessionId);
      const toolResult = requireResult(result.payload, `tools/call ${name}`);
      if (toolResult.isError === true) {
        throw new ModelicaRunObserverError(toolError(toolResult));
      }
      if (
        "structuredContent" in toolResult && toolResult.structuredContent !== undefined
      ) {
        return toolResult.structuredContent;
      }
      // mcp-modelica currently uses the portable MCP text envelope rather
      // than structuredContent. Parse only its one JSON text value; retain
      // structuredContent support for a future server release.
      return parseToolJsonContent(toolResult, name);
    } finally {
      if (sessionId) await this.#closeSession(sessionId);
    }
  }

  async #rpc(
    body: Record<string, unknown>,
    sessionId?: string,
    allowEmpty = false,
  ): Promise<{ response: Response; payload: RpcEnvelope }> {
    const headers: Record<string, string> = {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await this.#request({
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ModelicaRunObserverError(
        `MCP endpoint returned HTTP ${response.status}.`,
      );
    }
    const text = await response.text();
    if (allowEmpty && text.trim() === "") return { response, payload: {} };
    return { response, payload: parseRpcBody(text, response.headers) };
  }

  async #closeSession(sessionId: string): Promise<void> {
    try {
      await this.#request({
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
      });
    } catch {
      // A closing best-effort request must not obscure a tool response.
    }
  }

  async #request(init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(this.#mcpUrl, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ModelicaRunObserverError("Modelica MCP request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface RpcEnvelope {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

function toSummary(value: unknown, path: string): RunSummary {
  const run = parseSummary(value, path);
  return {
    id: `${MODEL_RUN_PREFIX}${run.runId}`,
    name: `${run.model.id} / ${run.scenario.id}`,
    subject: `Modelica ${run.model.version}`,
    status: run.status,
    verdictStatus: "not_evaluated",
    source: "observed",
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
  };
}

function toDetail(value: unknown, path: string): RunDetail {
  const run = parseSummary(value, path);
  const record = object(value, path);
  const engine = object(record.engine, `${path}.engine`);
  const resolvedParameters = object(
    record.resolved_parameters,
    `${path}.resolved_parameters`,
  );
  const metrics = object(record.metrics, `${path}.metrics`);
  const artifacts = array(record.artifacts, `${path}.artifacts`);
  const warnings = stringArray(record.warnings, `${path}.warnings`);
  const summary = toSummary(value, path);
  return {
    ...summary,
    description:
      "Observed OpenModelica simulation evidence. No SysON or constraint-solver requirement verdict has been attached to this run.",
    stages: [toStage(run, engine, resolvedParameters, metrics)],
    measurements: Object.entries(metrics)
      .map(([id, quantity]) => toMeasurement(id, quantity, `${path}.metrics.${id}`))
      .sort((left, right) => left.id.localeCompare(right.id)),
    provenance: toProvenance(run, engine),
    warnings,
    requirements: [],
    evidence: artifacts.map((artifact, index) =>
      toArtifact(artifact, run.runId, index, `${path}.artifacts[${index}]`)
    ),
    modelicaEvidence: {
      runId: run.runId,
      fingerprint: run.fingerprint,
      model: run.model,
      scenario: run.scenario,
    },
  };
}

function toStage(
  run: ParsedSummary,
  engine: Record<string, unknown>,
  resolvedParameters: Record<string, unknown>,
  metrics: Record<string, unknown>,
): RunStage {
  return {
    id: "modelica-simulation",
    title: "OpenModelica simulation",
    serverId: "modelica",
    tool: "modelica_simulate",
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    summary: run.status === "succeeded"
      ? "Approved Modelica scenario completed; its quantities are simulation evidence, not a requirement verdict."
      : "Approved Modelica scenario did not complete successfully; no requirement verdict is inferred.",
    inputs: {
      model: run.model,
      scenario: run.scenario,
      resolvedParameters,
    },
    outputs: {
      engine,
      fingerprint: run.fingerprint,
      metrics,
    },
  };
}

function toMeasurement(id: string, value: unknown, path: string): RunMeasurement {
  const quantity = object(value, path);
  const numeric = number(quantity.value, `${path}.value`);
  const unit = nonEmptyString(quantity.unit, `${path}.unit`);
  return {
    id,
    label: metricLabel(id),
    value: {
      value: numeric,
      unit,
      display: `${formatNumber(numeric)} ${unit}`,
    },
  };
}

function toProvenance(
  run: ParsedSummary,
  engine: Record<string, unknown>,
): RunProvenance[] {
  const engineName = nonEmptyString(engine.name, "modelica_run_get.engine.name");
  const engineVersion = nonEmptyString(
    engine.version,
    "modelica_run_get.engine.version",
  );
  const mslVersion = nonEmptyString(
    engine.msl_version,
    "modelica_run_get.engine.msl_version",
  );
  return [
    { label: "Model", value: `${run.model.id} @ ${run.model.version}` },
    { label: "Model SHA-256", value: run.model.sha256 },
    { label: "Scenario", value: run.scenario.id },
    { label: "Scenario SHA-256", value: run.scenario.sha256 },
    { label: "Engine", value: `${engineName} ${engineVersion} · MSL ${mslVersion}` },
    { label: "Fingerprint", value: run.fingerprint },
  ];
}

function toArtifact(
  value: unknown,
  runId: string,
  index: number,
  path: string,
): EvidenceArtifact {
  const artifact = object(value, path);
  const kind = nonEmptyString(artifact.kind, `${path}.kind`);
  if (!isArtifactKind(kind)) {
    throw new ModelicaRunObserverError(`${path}.kind is unsupported: ${kind}.`);
  }
  return {
    id: `modelica:${runId}:${index}:${kind}`,
    kind: kind === "resolved_parameters" ? "resolved-parameters" : kind,
    label: artifactLabel(kind),
    path: nonEmptyString(artifact.uri, `${path}.uri`),
    sha256: nonEmptyString(artifact.sha256, `${path}.sha256`),
    bytes: nonNegativeInteger(artifact.bytes, `${path}.bytes`),
    producedBy: "mcp-modelica",
  };
}

interface ParsedSummary {
  runId: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  fingerprint: string;
  model: { id: string; version: string; sha256: string };
  scenario: { id: string; sha256: string };
}

function parseSummary(value: unknown, path: string): ParsedSummary {
  const record = object(value, path);
  const status = nonEmptyString(record.status, `${path}.status`);
  if (!isRunStatus(status)) {
    throw new ModelicaRunObserverError(`${path}.status is unsupported: ${status}.`);
  }
  return {
    runId: nonEmptyString(record.run_id, `${path}.run_id`),
    status,
    startedAt: optionalString(record.started_at, `${path}.started_at`),
    completedAt: optionalString(record.completed_at, `${path}.completed_at`),
    fingerprint: nonEmptyString(record.fingerprint, `${path}.fingerprint`),
    model: modelIdentity(record.model, `${path}.model`),
    scenario: scenarioIdentity(record.scenario, `${path}.scenario`),
  };
}

function modelIdentity(
  value: unknown,
  path: string,
): { id: string; version: string; sha256: string } {
  const record = object(value, path);
  return {
    id: nonEmptyString(record.id, `${path}.id`),
    version: nonEmptyString(record.version, `${path}.version`),
    sha256: nonEmptyString(record.sha256, `${path}.sha256`),
  };
}

function scenarioIdentity(
  value: unknown,
  path: string,
): { id: string; sha256: string } {
  const record = object(value, path);
  return {
    id: nonEmptyString(record.id, `${path}.id`),
    sha256: nonEmptyString(record.sha256, `${path}.sha256`),
  };
}

function parseRpcBody(text: string, headers: Headers): RpcEnvelope {
  const contentType = headers.get("content-type") ?? "";
  let jsonText = text.trim();
  if (contentType.includes("text/event-stream") || jsonText.startsWith("event:")) {
    const data = jsonText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .find((line) => line.length > 0);
    if (!data) {
      throw new ModelicaRunObserverError(
        "MCP endpoint returned an empty event stream.",
      );
    }
    jsonText = data;
  }
  if (jsonText === "") return {};
  try {
    return JSON.parse(jsonText) as RpcEnvelope;
  } catch {
    throw new ModelicaRunObserverError("MCP endpoint returned invalid JSON.");
  }
}

function requireResult(
  envelope: RpcEnvelope,
  operation: string,
): Record<string, unknown> {
  if (envelope.error) {
    throw new ModelicaRunObserverError(
      `${operation}: ${envelope.error.message ?? "JSON-RPC error"}.`,
    );
  }
  if (!isRecord(envelope.result)) {
    throw new ModelicaRunObserverError(`${operation}: missing result.`);
  }
  return envelope.result;
}

function toolError(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.flatMap((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      return [];
    }
    return [item.text];
  }).join(" ");
  return text || "mcp-modelica reported a tool error.";
}

function parseToolJsonContent(result: Record<string, unknown>, name: string): unknown {
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content.flatMap((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      return [];
    }
    return [item.text];
  });
  if (texts.length !== 1) {
    throw new ModelicaRunObserverError(
      `tools/call ${name} did not return one JSON text result.`,
    );
  }
  try {
    return JSON.parse(texts[0]);
  } catch {
    throw new ModelicaRunObserverError(
      `tools/call ${name} returned invalid JSON text.`,
    );
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ModelicaRunObserverError(`${path} must be an object.`);
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ModelicaRunObserverError(`${path} must be an array.`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) =>
    nonEmptyString(item, `${path}[${index}]`)
  );
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ModelicaRunObserverError(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, path);
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModelicaRunObserverError(`${path} must be a finite number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ModelicaRunObserverError(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunStatus(value: string): value is RunStatus {
  return value === "succeeded" || value === "failed" || value === "timed_out" ||
    value === "running" || value === "unavailable";
}

function isArtifactKind(
  value: string,
): value is EvidenceArtifact["kind"] | "resolved_parameters" {
  return [
    "request",
    "resolved_parameters",
    "model",
    "script",
    "cad",
    "solve-case",
    "diagnostics",
    "result",
    "evidence",
    "verdict",
  ].includes(value);
}

function metricLabel(id: string): string {
  const labels: Record<string, string> = {
    water_temperature_max: "Maximum water temperature",
    time_to_target_temperature: "Time to target temperature",
    heater_energy: "Heater energy",
    heater_power_peak: "Peak heater power",
  };
  return labels[id] ?? id.replaceAll("_", " ");
}

function artifactLabel(kind: string): string {
  const labels: Record<string, string> = {
    request: "Simulation request",
    resolved_parameters: "Resolved parameters",
    model: "Modelica model",
    script: "OpenModelica script",
    diagnostics: "OpenModelica diagnostics",
    result: "Simulation result",
    evidence: "Computed evidence",
  };
  return labels[kind] ?? kind.replaceAll("_", " ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 6,
    useGrouping: false,
  }).format(value);
}
