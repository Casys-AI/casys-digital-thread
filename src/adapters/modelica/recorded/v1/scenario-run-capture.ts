import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  DynamicSystemRun,
  SimulationCaseIdentity as PortSimulationCaseIdentity,
} from "../../../../domain/modelica/recorded/simulation-capabilities.ts";

// ── Schema version constants ─────────────────────────────────────────────────

/**
 * Two distinct CAS object families — never confuse their canonical texts.
 *
 * providerRunRecord → sealed by the Modelica server identity; embeds both
 * normalized provider envelopes so an auditor can verify the double
 * attestation without a live provider.
 *
 * executionReceipt → sealed by digital-thread; asserts the lineage between
 * the signed simulation case and the concrete provider run record.
 */
export const MODELICA_SCENARIO_RUN_CAPTURE_SCHEMA =
  "modelica-scenario-run-capture/1.0" as const;
export const MODELICA_SCENARIO_EXECUTION_RECEIPT_SCHEMA =
  "modelica-scenario-execution-receipt/1.0" as const;

/** Schema version the provider envelope must declare. */
const PROVIDER_ENVELOPE_SCHEMA_VERSION = "1.0";

// ── Artifact kind ledger ─────────────────────────────────────────────────────

/**
 * The three artifact kinds that a succeeded run must contain exactly once.
 * Any artifact with kind "verdict" triggers an immediate hard rejection —
 * a run record must never carry a verdict (verdictStatus belongs to the
 * domain layer, not to the raw provider response).
 */
const REQUIRED_ARTIFACT_KINDS = ["evidence", "model", "result"] as const;

/**
 * Optional artifact kinds; any number of these may appear, each at most once.
 * Together with REQUIRED_ARTIFACT_KINDS they form the complete allowed set.
 */
const OPTIONAL_ARTIFACT_KINDS = [
  "diagnostics",
  "request",
  "resolved_parameters",
  "script",
] as const;

const ALLOWED_ARTIFACT_KINDS = [
  ...REQUIRED_ARTIFACT_KINDS,
  ...OPTIONAL_ARTIFACT_KINDS,
] as const;
type RunArtifactKind = (typeof ALLOWED_ARTIFACT_KINDS)[number];

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * The contract already validated against the sealed simulation case.
 *
 * Passed into the capture functions as the authority for identity and
 * parameter exactness checks. The caller (executor) obtained this from the
 * re-validated simulation-case artifact; the capture layer never looks up
 * or re-derives any of these values from the provider response.
 */
export type SimulationCaseIdentity = PortSimulationCaseIdentity;

/** Minimal envelope extracted before the WAL provider-run-known transition. */
export interface ModelicaEnvelopeMinimal {
  readonly schemaVersion: string;
  readonly kind: string;
  readonly runId: string;
  readonly status: string;
}

export interface ParsedRunArtifact {
  readonly kind: RunArtifactKind;
  readonly uri: string;
  readonly fingerprint: ContentFingerprint;
  readonly bytes: number;
}

export interface ParsedQuantity {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
}

/**
 * Fully validated, immutable representation of a succeeded provider run.
 *
 * `canonicalEnvelopeText` is the deterministicJson of the raw run_get
 * structured content, computed before any transformation. It is the
 * normalized form used by assertSimulateMatchesRunGet to verify that the
 * provider persisted exactly the same data that simulate returned.
 */
export type ParsedModelicaRun = DynamicSystemRun;

/** Canonical text and its SHA-256 fingerprint digest for a CAS object. */
export interface CasEnvelope {
  readonly canonicalText: string;
  readonly fingerprintDigest: string;
}

export class ModelicaScenarioRunCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaScenarioRunCaptureError";
  }
}

// ── Step 10 — minimal envelope parse (before WAL transition) ─────────────────

/**
 * Parse the four fields required before the WAL provider-run-known transition.
 *
 * Fail-closed on these four fields only; extra envelope or run fields are
 * accepted so that the WAL can capture the full raw response regardless of
 * future schema additions. The executor checks status after this call and
 * only proceeds to the durable transition when status is "succeeded".
 */
export function parseSimulateEnvelopeMinimal(
  structuredContent: unknown,
): ModelicaEnvelopeMinimal {
  const envelope = recordOf(structuredContent, "modelica_simulate response");
  const schemaVersion = text(envelope.schemaVersion, "modelica_simulate.schemaVersion");
  const kind = text(envelope.kind, "modelica_simulate.kind");
  const run = recordOf(envelope.run, "modelica_simulate.run");
  const runId = identifier(run.run_id, "modelica_simulate.run.run_id");
  const status = text(run.status, "modelica_simulate.run.status");
  return deepFreeze({ schemaVersion, kind, runId, status });
}

// ── Step 10 — canonical simulate envelope (embedded in WAL) ─────────────────

/**
 * Produce the canonical, durable text of the complete simulate response.
 *
 * Written into the WAL at the provider-run-known transition. On the recovery
 * path (provider-run-known → run_get only) the same text is used for the
 * double attestation, ensuring normal and resumed paths apply identical logic.
 */
export function canonicalizeSimulateEnvelope(structuredContent: unknown): string {
  return deterministicJson(structuredContent);
}

// ── Step 11 — full fail-closed parse of run_get ──────────────────────────────

/**
 * Parse and validate the complete run_get response against the sealed case.
 *
 * Validation is exhaustive and fail-closed: identity (model id/version/sha256,
 * scenario id/sha256), parameter exactness (exact ids, values, units),
 * metric presence (each expectedMetric present with its unit; surplus kept),
 * artifact ledger (no verdict, required three present once each, no duplicate
 * kinds or URIs, model sha256 matches case), and status "succeeded".
 *
 * `canonicalEnvelopeText` in the returned record is the deterministicJson of
 * the raw input, suitable for byte-exact comparison with the stored simulate
 * envelope text.
 */
export function parseModelicaRunRecord(
  structuredContent: unknown,
  expected: SimulationCaseIdentity,
): ParsedModelicaRun {
  // Canonical text from the raw input before any field transformation.
  // Must be computed first so it reflects exactly what the provider returned.
  const canonicalEnvelopeText = deterministicJson(structuredContent);

  const envelope = exactRecord(
    structuredContent,
    ["kind", "run", "schemaVersion"],
    "run_get response",
  );
  exact(
    envelope.schemaVersion,
    PROVIDER_ENVELOPE_SCHEMA_VERSION,
    "run_get.schemaVersion",
  );
  exact(envelope.kind, "run", "run_get.kind");

  const run = exactRecord(
    envelope.run,
    [
      "artifacts",
      "completed_at",
      "engine",
      "fingerprint",
      "metrics",
      "model",
      "resolved_parameters",
      "run_id",
      "scenario",
      "started_at",
      "status",
      "warnings",
    ],
    "run_get.run",
  );

  exact(run.status, "succeeded", "run_get.run.status");

  const runId = identifier(run.run_id, "run_get.run.run_id");
  const startedAt = isoDate(run.started_at, "run_get.run.started_at");
  const completedAt = isoDate(run.completed_at, "run_get.run.completed_at");
  if (Date.parse(startedAt) > Date.parse(completedAt)) {
    fail("run_get.run.completed_at must not precede started_at.");
  }

  const fingerprint = parseFingerprint(run.fingerprint, "run_get.run.fingerprint");
  const model = parseModelIdentity(run.model, "run_get.run.model");
  const scenario = parseScenarioIdentity(run.scenario, "run_get.run.scenario");
  requireCaseIdentity(model, scenario, expected);

  const engineRecord = exactRecord(
    run.engine,
    ["msl_version", "name", "version"],
    "run_get.run.engine",
  );
  const engine = {
    mslVersion: text(engineRecord.msl_version, "run_get.run.engine.msl_version"),
    name: text(engineRecord.name, "run_get.run.engine.name"),
    version: text(engineRecord.version, "run_get.run.engine.version"),
  };

  const resolvedParameters = parseResolvedParameters(
    run.resolved_parameters,
    expected.parameters,
    "run_get.run.resolved_parameters",
  );
  const metrics = parseMetrics(
    run.metrics,
    expected.expectedMetrics,
    "run_get.run.metrics",
  );
  const artifacts = parseArtifacts(
    run.artifacts,
    expected.kit.modelSha256,
    "run_get.run.artifacts",
  );
  const warnings = stringArray(run.warnings, "run_get.run.warnings");

  return deepFreeze({
    artifacts,
    canonicalEnvelopeText,
    completedAt,
    engine,
    fingerprint,
    metrics,
    model,
    resolvedParameters,
    runId,
    scenario,
    startedAt,
    warnings,
  });
}

// ── Step 11 — double attestation ─────────────────────────────────────────────

/**
 * Assert that the stored simulate envelope and the parsed run_get envelope
 * represent the same persisted provider run.
 *
 * Both normalized representations are compared byte-for-byte. Any divergence
 * — a parameter value, a metric quantity, an artifact hash — fails closed
 * rather than silently retaining ambiguous evidence. This invariant holds on
 * both the normal path and the recovery path (provider-run-known → run_get).
 */
export function assertSimulateMatchesRunGet(
  simulateEnvelopeText: string,
  runGetParsed: ParsedModelicaRun,
): void {
  if (simulateEnvelopeText !== runGetParsed.canonicalEnvelopeText) {
    throw new ModelicaScenarioRunCaptureError(
      "modelica_run_get does not exactly match the persisted run returned by" +
        " modelica_simulate.",
    );
  }
}

// ── Step 12 — provider run record CAS envelope ───────────────────────────────

/**
 * Build the CAS object that seals the provider evidence.
 *
 * Both normalized provider envelopes (simulate + run_get) are embedded so
 * that an auditor can verify the double-attestation without access to a live
 * provider. The producer is "modelica" because all attested data originated
 * from that server.
 *
 * `capturedAt` is the exclusive timestamp source; no runtime Date.now() is
 * used inside this function.
 */
export async function buildProviderRunRecordEnvelope(
  parsed: ParsedModelicaRun,
  options: {
    readonly trustedRunId: string;
    readonly operation: string;
    readonly capturedAt: string;
    /** deterministicJson of the raw modelica_simulate response (from WAL). */
    readonly canonicalSimulateEnvelopeText: string;
  },
): Promise<CasEnvelope> {
  isoDateValue(options.capturedAt, "capturedAt");
  const record = {
    schemaVersion: MODELICA_SCENARIO_RUN_CAPTURE_SCHEMA,
    capturedAt: options.capturedAt,
    canonicalRunGetEnvelope: parsed.canonicalEnvelopeText,
    canonicalSimulateEnvelope: options.canonicalSimulateEnvelopeText,
    engine: parsed.engine,
    evidence: {
      artifacts: parsed.artifacts,
      completedAt: parsed.completedAt,
      fingerprint: parsed.fingerprint,
      metrics: parsed.metrics,
      model: parsed.model,
      runId: parsed.runId,
      scenario: parsed.scenario,
      startedAt: parsed.startedAt,
    },
    operation: options.operation,
    producer: "modelica",
    trustedRunId: options.trustedRunId,
    warnings: parsed.warnings,
  };
  const canonicalText = deterministicJson(record);
  const fp = await sha256Fingerprint(record);
  return deepFreeze({ canonicalText, fingerprintDigest: fp.digest });
}

// ── Step 13 — execution receipt CAS envelope ─────────────────────────────────

/**
 * Build the CAS object that ties the provider evidence to the sealed case.
 *
 * The receipt is produced by "digital-thread" because it asserts the lineage
 * between the simulation case artifact and the provider run record artifact.
 * `exactSimulateRequest` must be the verbatim arguments object passed to
 * modelica_simulate — never a summary or reconstruction.
 *
 * The two CAS objects (record and receipt) have intentionally different
 * canonical texts and therefore different fingerprint digests. Confusing them
 * would break the inputArtifactIds lineage on the receipt artifact.
 */
export async function buildExecutionReceiptEnvelope(options: {
  readonly caseArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly caseDigest: string;
  readonly providerRunId: string;
  readonly exactSimulateRequest: unknown;
  readonly policyVersion: string;
  readonly capturedAt: string;
}): Promise<CasEnvelope> {
  isoDateValue(options.capturedAt, "capturedAt");
  if (!/^[a-f0-9]{64}$/.test(options.caseDigest)) {
    fail("caseDigest must be a lowercase hex-64 SHA-256 digest.");
  }
  const receipt = {
    schemaVersion: MODELICA_SCENARIO_EXECUTION_RECEIPT_SCHEMA,
    capturedAt: options.capturedAt,
    caseArtifact: options.caseArtifact,
    caseDigest: options.caseDigest,
    exactSimulateRequest: options.exactSimulateRequest,
    policyVersion: options.policyVersion,
    producer: "digital-thread",
    providerRunId: options.providerRunId,
  };
  const canonicalText = deterministicJson(receipt);
  const fp = await sha256Fingerprint(receipt);
  return deepFreeze({ canonicalText, fingerprintDigest: fp.digest });
}

// ── Private identity checks ──────────────────────────────────────────────────

/**
 * Verify that the persisted run attests the exact model and scenario from
 * the sealed simulation case. The provider attests the sha256 values at
 * run_get time (step 11); this is the only point where they are checked.
 */
function requireCaseIdentity(
  model: ParsedModelicaRun["model"],
  scenario: ParsedModelicaRun["scenario"],
  expected: SimulationCaseIdentity,
): void {
  exact(model.id, expected.kit.modelId, "run_get.run.model.id");
  exact(model.version, expected.kit.modelVersion, "run_get.run.model.version");
  exact(
    model.fingerprint.digest,
    expected.kit.modelSha256,
    "run_get.run.model.sha256",
  );
  exact(scenario.id, expected.scenario.id, "run_get.run.scenario.id");
  exact(
    scenario.fingerprint.digest,
    expected.scenario.sha256,
    "run_get.run.scenario.sha256",
  );
}

function parseModelIdentity(
  value: unknown,
  path: string,
): ParsedModelicaRun["model"] {
  const record = exactRecord(value, ["id", "sha256", "version"], path);
  return {
    fingerprint: parseFingerprint(record.sha256, `${path}.sha256`),
    id: identifier(record.id, `${path}.id`),
    version: text(record.version, `${path}.version`),
  };
}

function parseScenarioIdentity(
  value: unknown,
  path: string,
): ParsedModelicaRun["scenario"] {
  const record = exactRecord(value, ["id", "sha256"], path);
  return {
    fingerprint: parseFingerprint(record.sha256, `${path}.sha256`),
    id: identifier(record.id, `${path}.id`),
  };
}

// ── Private quantity parsers ─────────────────────────────────────────────────

/**
 * Parse resolved_parameters as an exact bijection of case.parameters.
 *
 * The provider must echo back exactly the overrides that were sent: same ids
 * (no surplus, no missing), same values (float-exact), same units. This
 * ensures the executor cannot inadvertently accept a run computed with
 * different parameter values than what the sealed case requested.
 */
function parseResolvedParameters(
  value: unknown,
  expectedParams: readonly { id: string; value: number; unit: string }[],
  path: string,
): readonly ParsedQuantity[] {
  const record = recordOf(value, path);
  const actualIds = Object.keys(record).sort();
  const expectedIds = expectedParams.map((p) => p.id).sort();
  if (deterministicJson(actualIds) !== deterministicJson(expectedIds)) {
    fail(`${path} must contain exactly the simulation case parameter ids.`);
  }
  return expectedParams.map((expected) => {
    const q = exactRecord(
      record[expected.id],
      ["unit", "value"],
      `${path}.${expected.id}`,
    );
    const num = finite(q.value, `${path}.${expected.id}.value`);
    exact(num, expected.value, `${path}.${expected.id}.value`);
    exact(q.unit, expected.unit, `${path}.${expected.id}.unit`);
    return { id: expected.id, unit: expected.unit, value: num };
  });
}

/**
 * Parse metrics, enforcing presence and unit for each expected metric.
 *
 * Surplus metrics returned by the provider are conserved in the output;
 * the executor maps all of them to observations. Removing surplus would
 * silently discard provider evidence.
 */
function parseMetrics(
  value: unknown,
  expectedMetrics: readonly { id: string; unit: string }[],
  path: string,
): readonly ParsedQuantity[] {
  const record = recordOf(value, path);
  for (const expected of expectedMetrics) {
    if (!(expected.id in record)) {
      fail(`${path} must contain expected metric "${expected.id}".`);
    }
    const q = exactRecord(
      record[expected.id],
      ["unit", "value"],
      `${path}.${expected.id}`,
    );
    exact(q.unit, expected.unit, `${path}.${expected.id}.unit`);
    finite(q.value, `${path}.${expected.id}.value`);
  }
  return Object.entries(record).map(([id, raw]) => {
    const q = exactRecord(raw, ["unit", "value"], `${path}.${id}`);
    return {
      id,
      unit: text(q.unit, `${path}.${id}.unit`),
      value: finite(q.value, `${path}.${id}.value`),
    };
  });
}

// ── Private artifact parser ──────────────────────────────────────────────────

/**
 * Parse and validate the artifact ledger.
 *
 * Hard invariants enforced here:
 *   • kind "verdict" is never permitted (verdictStatus belongs to the domain).
 *   • Unknown kinds are rejected (fail-closed, not warn-and-continue).
 *   • Kinds must be unique across the list.
 *   • URIs must be unique across the list.
 *   • Exactly one "model", one "result", one "evidence" artifact.
 *   • The "model" artifact SHA-256 must match the sealed case.
 *
 * Optional surplus (request, resolved_parameters, script, diagnostics) is
 * accepted as long as it satisfies the kind and URI uniqueness invariants.
 */
function parseArtifacts(
  value: unknown,
  modelSha256: string,
  path: string,
): readonly ParsedRunArtifact[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);

  const artifacts = value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = exactRecord(item, ["bytes", "kind", "sha256", "uri"], itemPath);
    const kind = text(record.kind, `${itemPath}.kind`);

    if (kind === "verdict") {
      fail(
        `${itemPath}.kind "verdict" is not permitted; a run record must not contain` +
          " a verdict artifact.",
      );
    }
    if (!ALLOWED_ARTIFACT_KINDS.includes(kind as RunArtifactKind)) {
      fail(`${itemPath}.kind "${kind}" is not a known Modelica artifact kind.`);
    }

    const uri = text(record.uri, `${itemPath}.uri`);
    const fingerprint = parseFingerprint(record.sha256, `${itemPath}.sha256`);
    const bytes = nonNegativeInteger(record.bytes, `${itemPath}.bytes`);
    return { bytes, fingerprint, kind: kind as RunArtifactKind, uri };
  });

  const kinds = artifacts.map((a) => a.kind);
  if (new Set(kinds).size !== kinds.length) {
    fail(`${path} artifact kinds must each appear at most once.`);
  }

  const uris = artifacts.map((a) => a.uri);
  if (new Set(uris).size !== uris.length) {
    fail(`${path} artifact URIs must each appear at most once.`);
  }

  for (const required of REQUIRED_ARTIFACT_KINDS) {
    if (!kinds.includes(required)) {
      fail(`${path} must contain exactly one "${required}" artifact.`);
    }
  }

  const modelArtifact = artifacts.find((a) => a.kind === "model")!;
  if (modelArtifact.fingerprint.digest !== modelSha256) {
    fail(`${path} model artifact SHA-256 does not match the simulation case.`);
  }

  return artifacts;
}

// ── Private validators ───────────────────────────────────────────────────────

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = recordOf(value, path);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    fail(`${path} has unsupported or missing fields.`);
  }
  return record;
}

function recordOf(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  const result = text(value, path);
  if (
    result.length > 255 ||
    [...result].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    fail(`${path} must be a bounded identifier.`);
  }
  return result;
}

function isoDate(value: unknown, path: string): string {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) fail(`${path} must be ISO-8601.`);
  return result;
}

function isoDateValue(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    fail(`${field} must be ISO-8601.`);
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const digest = text(value, path).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    fail(`${path} must be a SHA-256 hex-64 digest.`);
  }
  return { algorithm: "sha256", digest };
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

function exact(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) {
    fail(`${path} does not match the simulation case contract.`);
  }
}

function fail(message: string): never {
  throw new ModelicaScenarioRunCaptureError(message);
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
