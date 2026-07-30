const MCP_PROTOCOL_VERSION = "2025-06-18";
const TARGET_TEMPERATURE_METRIC = "water_temperature_max";

export interface Quantity {
  value: number;
  unit: string;
}

export interface ModelicaModelIdentity {
  id: string;
  version: string;
  sha256: string;
}

/**
 * mcp-modelica versions the model and identifies a scenario by its content
 * hash. A scenario version is therefore represented by its id + sha256.
 */
export interface ModelicaScenarioIdentity {
  id: string;
  sha256: string;
}

export interface ModelicaScenarioEvidence {
  runId?: string;
  model: ModelicaModelIdentity;
  scenario: ModelicaScenarioIdentity;
  metrics: Readonly<Record<string, Quantity>>;
}

export interface ScenarioConstraint {
  id: string;
  name: string;
  expression: {
    kind: "binary";
    op: ">=";
    left: {
      kind: "ref";
      featurePath: readonly [string];
    };
    right: {
      kind: "literal";
      value: number;
      unit: string;
    };
  };
}

export interface ScenarioContractSource {
  kind: "versioned-modelica-scenario";
  sourcePath: string;
  targetTemperature: Quantity;
  horizon: Quantity;
}

export interface LoadedScenarioContractPlan {
  /** Local plan path used for this evaluation. */
  path: string;
  /** SHA-256 of the exact UTF-8 plan source, before parsing. */
  sha256: string;
  schemaVersion: "1.0";
  id: string;
  title: string;
  version: string;
  provisional: true;
  source: ScenarioContractSource;
  model: ModelicaModelIdentity;
  scenario: ModelicaScenarioIdentity;
  constraints: readonly ScenarioConstraint[];
}

export interface ScenarioContractVerifierOptions {
  planPath: string;
  /** Streamable HTTP MCP endpoint owned by mcp-syson. */
  sysonMcpUrl: string;
  fetch?: typeof fetch;
  readTextFile?: (path: string | URL) => Promise<string>;
  timeoutMs?: number;
}

export interface ScenarioContractVerification {
  plan: LoadedScenarioContractPlan;
  evidence: Pick<ModelicaScenarioEvidence, "runId" | "model" | "scenario">;
  request: {
    tool: "syson_constraint_evaluate";
    arguments: {
      constraints: readonly ScenarioConstraint[];
      values: Readonly<Record<string, Quantity>>;
    };
  };
  /** Unmapped structured result returned by syson_constraint_evaluate. */
  outcome: Record<string, unknown>;
}

export class ScenarioContractVerifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioContractVerifierError";
  }
}

/**
 * Load, structurally validate, and content-hash a scenario contract plan.
 * The raw-source digest makes both the plan path and its exact reviewed bytes
 * available to an eventual evidence wrapper.
 */
export async function loadScenarioContractPlan(
  path: string | URL,
  readTextFile: (path: string | URL) => Promise<string> = Deno.readTextFile,
): Promise<LoadedScenarioContractPlan> {
  const source = await readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new ScenarioContractVerifierError(
      `Scenario contract plan ${String(path)} contains invalid JSON.`,
    );
  }
  const plan = parsePlan(parsed, String(path));
  return { ...plan, path: String(path), sha256: await sha256(source) };
}

/**
 * A narrow bridge between an approved Modelica record and SysON's offline
 * units-aware constraint evaluator. It has no control-plane or UI dependency.
 */
export class ScenarioContractVerifier {
  readonly #planPath: string;
  readonly #sysonMcpUrl: string;
  readonly #fetch: typeof fetch;
  readonly #readTextFile: (path: string | URL) => Promise<string>;
  readonly #timeoutMs: number;
  #planPromise?: Promise<LoadedScenarioContractPlan>;

  constructor(options: ScenarioContractVerifierOptions) {
    this.#planPath = options.planPath;
    this.#sysonMcpUrl = options.sysonMcpUrl;
    this.#fetch = options.fetch ?? fetch;
    this.#readTextFile = options.readTextFile ?? Deno.readTextFile;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
  }

  /**
   * Returns undefined when evidence belongs to another versioned model or
   * scenario. That is a normal non-applicability result: SysON is not called.
   */
  async verify(
    evidence: ModelicaScenarioEvidence,
  ): Promise<ScenarioContractVerification | undefined> {
    const plan = await this.prepare();
    if (!matchesPlan(plan, evidence)) return undefined;

    const values = explicitMetricValues(plan, evidence);
    const args = { constraints: plan.constraints, values };
    const outcome = await this.#callConstraintEvaluate(args);
    return {
      plan,
      evidence: {
        runId: evidence.runId,
        model: evidence.model,
        scenario: evidence.scenario,
      },
      request: {
        tool: "syson_constraint_evaluate",
        arguments: args,
      },
      outcome,
    };
  }

  /**
   * Validate and freeze the exact versioned plan before the console starts
   * serving observations. A missing or malformed plan is configuration
   * failure, not a verdict about an unrelated simulation.
   */
  prepare(): Promise<LoadedScenarioContractPlan> {
    this.#planPromise ??= loadScenarioContractPlan(
      this.#planPath,
      this.#readTextFile,
    );
    return this.#planPromise;
  }

  async #callConstraintEvaluate(
    args: {
      constraints: readonly ScenarioConstraint[];
      values: Readonly<Record<string, Quantity>>;
    },
  ): Promise<Record<string, unknown>> {
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
            name: "casys-digital-thread-scenario-contract-verifier",
            version: "0.1.0",
          },
        },
      });
      sessionId = initialized.response.headers.get("mcp-session-id") ?? undefined;
      requireResult(initialized.payload, "initialize");

      await this.#rpc(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        sessionId,
        true,
      );

      const response = await this.#rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "syson_constraint_evaluate", arguments: args },
      }, sessionId);
      const result = requireResult(
        response.payload,
        "tools/call syson_constraint_evaluate",
      );
      if (result.isError === true) {
        throw new ScenarioContractVerifierError(toolError(result));
      }
      return structuredToolOutcome(result);
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
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await this.#request({
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ScenarioContractVerifierError(
        `SysON MCP endpoint returned HTTP ${response.status}.`,
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
      // Session cleanup cannot obscure an otherwise valid verification result.
    }
  }

  async #request(init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(this.#sysonMcpUrl, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ScenarioContractVerifierError("SysON MCP request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface ParsedPlan {
  schemaVersion: "1.0";
  id: string;
  title: string;
  version: string;
  provisional: true;
  source: ScenarioContractSource;
  model: ModelicaModelIdentity;
  scenario: ModelicaScenarioIdentity;
  constraints: readonly ScenarioConstraint[];
}

interface RpcEnvelope {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

function parsePlan(value: unknown, path: string): ParsedPlan {
  const record = object(value, path);
  const schemaVersion = nonEmptyString(record.schema_version, `${path}.schema_version`);
  if (schemaVersion !== "1.0") {
    throw new ScenarioContractVerifierError(
      `${path}.schema_version must be "1.0".`,
    );
  }
  if (record.provisional !== true) {
    throw new ScenarioContractVerifierError(`${path}.provisional must be true.`);
  }
  const source = parseSource(record.source, `${path}.source`);
  const constraints = parseConstraints(
    record.constraints,
    source,
    `${path}.constraints`,
  );
  return {
    schemaVersion,
    id: nonEmptyString(record.id, `${path}.id`),
    title: nonEmptyString(record.title, `${path}.title`),
    version: nonEmptyString(record.version, `${path}.version`),
    provisional: true,
    source,
    model: parseModelIdentity(record.model, `${path}.model`),
    scenario: parseScenarioIdentity(record.scenario, `${path}.scenario`),
    constraints,
  };
}

function parseSource(value: unknown, path: string): ScenarioContractSource {
  const record = object(value, path);
  if (record.kind !== "versioned-modelica-scenario") {
    throw new ScenarioContractVerifierError(
      `${path}.kind must be "versioned-modelica-scenario".`,
    );
  }
  const targetTemperature = quantity(
    record.target_temperature,
    `${path}.target_temperature`,
  );
  const horizon = quantity(record.horizon, `${path}.horizon`);
  if (targetTemperature.unit !== "degC" || horizon.unit !== "s" || horizon.value <= 0) {
    throw new ScenarioContractVerifierError(
      `${path} must declare a positive seconds horizon and a degC target temperature.`,
    );
  }
  return {
    kind: "versioned-modelica-scenario",
    sourcePath: nonEmptyString(record.source_path, `${path}.source_path`),
    targetTemperature,
    horizon,
  };
}

function parseConstraints(
  value: unknown,
  source: ScenarioContractSource,
  path: string,
): readonly ScenarioConstraint[] {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ScenarioContractVerifierError(
      `${path} must contain exactly the one scenario-derived target condition.`,
    );
  }
  const constraint = object(value[0], `${path}[0]`);
  if (
    nonEmptyString(constraint.id, `${path}[0].id`) !==
      "scenario-target-temperature-reached" ||
    nonEmptyString(constraint.name, `${path}[0].name`) !==
      "Scenario target temperature reached"
  ) {
    throw new ScenarioContractVerifierError(
      `${path}[0] must be the named scenario target condition.`,
    );
  }
  const expression = object(constraint.expression, `${path}[0].expression`);
  const left = object(expression.left, `${path}[0].expression.left`);
  const right = object(expression.right, `${path}[0].expression.right`);
  const featurePath = left.featurePath;
  if (
    expression.kind !== "binary" || expression.op !== ">=" ||
    left.kind !== "ref" || !Array.isArray(featurePath) || featurePath.length !== 1 ||
    featurePath[0] !== TARGET_TEMPERATURE_METRIC || right.kind !== "literal"
  ) {
    throw new ScenarioContractVerifierError(
      `${path}[0] must compare ${TARGET_TEMPERATURE_METRIC} >= the scenario target.`,
    );
  }
  const target = quantity(right, `${path}[0].expression.right`);
  if (!sameQuantity(target, source.targetTemperature)) {
    throw new ScenarioContractVerifierError(
      `${path}[0] must use source.target_temperature exactly; product limits do not belong in this provisional plan.`,
    );
  }
  return [{
    id: "scenario-target-temperature-reached",
    name: "Scenario target temperature reached",
    expression: {
      kind: "binary",
      op: ">=",
      left: { kind: "ref", featurePath: [TARGET_TEMPERATURE_METRIC] },
      right: { kind: "literal", value: target.value, unit: target.unit },
    },
  }];
}

function parseModelIdentity(value: unknown, path: string): ModelicaModelIdentity {
  const record = object(value, path);
  return {
    id: nonEmptyString(record.id, `${path}.id`),
    version: nonEmptyString(record.version, `${path}.version`),
    sha256: sha256Value(record.sha256, `${path}.sha256`),
  };
}

function parseScenarioIdentity(value: unknown, path: string): ModelicaScenarioIdentity {
  const record = object(value, path);
  return {
    id: nonEmptyString(record.id, `${path}.id`),
    sha256: sha256Value(record.sha256, `${path}.sha256`),
  };
}

function matchesPlan(
  plan: LoadedScenarioContractPlan,
  evidence: ModelicaScenarioEvidence,
): boolean {
  return evidence.model?.id === plan.model.id &&
    evidence.model?.version === plan.model.version &&
    evidence.model?.sha256 === plan.model.sha256 &&
    evidence.scenario?.id === plan.scenario.id &&
    evidence.scenario?.sha256 === plan.scenario.sha256;
}

function explicitMetricValues(
  plan: LoadedScenarioContractPlan,
  evidence: ModelicaScenarioEvidence,
): Readonly<Record<string, Quantity>> {
  const values: Record<string, Quantity> = {};
  for (const constraint of plan.constraints) {
    const metricId = constraint.expression.left.featurePath[0];
    const metric = evidence.metrics?.[metricId];
    // A missing Modelica metric must remain absent: the constraint evaluator
    // returns its native unresolved result rather than treating it as zero.
    if (metric === undefined) continue;
    values[metricId] = quantity(metric, `evidence.metrics.${metricId}`);
  }
  return values;
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
      throw new ScenarioContractVerifierError(
        "SysON MCP endpoint returned an empty event stream.",
      );
    }
    jsonText = data;
  }
  if (jsonText === "") return {};
  try {
    return JSON.parse(jsonText) as RpcEnvelope;
  } catch {
    throw new ScenarioContractVerifierError(
      "SysON MCP endpoint returned invalid JSON.",
    );
  }
}

function requireResult(
  envelope: RpcEnvelope,
  operation: string,
): Record<string, unknown> {
  if (envelope.error) {
    throw new ScenarioContractVerifierError(
      `${operation}: ${envelope.error.message ?? "JSON-RPC error"}.`,
    );
  }
  if (!isRecord(envelope.result)) {
    throw new ScenarioContractVerifierError(`${operation}: missing result.`);
  }
  return envelope.result;
}

function structuredToolOutcome(
  result: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content.flatMap((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      return [];
    }
    return [item.text];
  });
  if (texts.length !== 1) {
    throw new ScenarioContractVerifierError(
      "syson_constraint_evaluate did not return one structured JSON result.",
    );
  }
  try {
    const parsed: unknown = JSON.parse(texts[0]);
    return object(parsed, "syson_constraint_evaluate result");
  } catch (error) {
    if (error instanceof ScenarioContractVerifierError) throw error;
    throw new ScenarioContractVerifierError(
      "syson_constraint_evaluate returned invalid JSON text.",
    );
  }
}

function toolError(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.flatMap((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      return [];
    }
    return [item.text];
  }).join(" ");
  return text || "syson_constraint_evaluate reported a tool error.";
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ScenarioContractVerifierError(`${path} must be an object.`);
  }
  return value;
}

function quantity(value: unknown, path: string): Quantity {
  const record = object(value, path);
  const numeric = record.value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    throw new ScenarioContractVerifierError(`${path}.value must be a finite number.`);
  }
  return { value: numeric, unit: nonEmptyString(record.unit, `${path}.unit`) };
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScenarioContractVerifierError(`${path} must be a non-empty string.`);
  }
  return value;
}

function sha256Value(value: unknown, path: string): string {
  const hash = nonEmptyString(value, path);
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new ScenarioContractVerifierError(`${path} must be a lowercase SHA-256.`);
  }
  return hash;
}

function sameQuantity(left: Quantity, right: Quantity): boolean {
  return left.value === right.value && left.unit === right.unit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
