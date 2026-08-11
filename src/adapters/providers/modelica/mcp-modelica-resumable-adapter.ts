/** Strict private MCP adapter for mcp-modelica resumable contract 2.1. */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  canonicalModelicaResumableProviderJson,
  expectedModelicaResumableResources,
  fingerprintModelicaResumableProviderJson,
  MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION,
  MODELICA_RESUMABLE_CONTRACT_VERSION,
  type ModelicaResumableArtifact,
  type ModelicaResumableCapturedEvidence,
  type ModelicaResumableCapturedEvidenceNormalizer,
  type ModelicaResumableCapturedResource,
  type ModelicaResumableCapturedResourceTuple,
  type ModelicaResumableCompletedRun,
  type ModelicaResumableEngineIdentity,
  type ModelicaResumableEvidenceVerifier,
  type ModelicaResumableIdentity,
  type ModelicaResumableManifest,
  type ModelicaResumableManifestReader,
  type ModelicaResumableManifestSelection,
  type ModelicaResumableQuantity,
  type ModelicaResumableRequest,
  type ModelicaResumableRequestReader,
  type ModelicaResumableResource,
  type ModelicaResumableScenarioPublic,
  type ModelicaResumableSubmission,
  type ModelicaResumableSubmitter,
  validateModelicaQualifiedManifestDocument,
} from "../../../domain/analysis/modelica-resumable-capabilities.ts";
import {
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  validateExpectedProviderResource,
} from "../../../domain/analysis/provider-resource-reader.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";

const MANIFEST_GET = "modelica_simulation_manifest_get";
const SUBMIT = "modelica_simulation_submit";
const REQUEST_GET = "modelica_simulation_request_get";
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RUN_ID =
  /^run_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class McpModelicaResumableResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpModelicaResumableResponseError";
  }
}

/** The only 2.1 surface: three exact tools, no resources/list capability. */
export class McpModelicaResumableAdapter
  implements
    ModelicaResumableManifestReader,
    ModelicaResumableSubmitter,
    ModelicaResumableRequestReader,
    ModelicaResumableEvidenceVerifier,
    ModelicaResumableCapturedEvidenceNormalizer {
  constructor(private readonly client: McpToolClient) {}

  async getManifest(
    selection: ModelicaResumableManifestSelection,
  ): Promise<ModelicaResumableManifest> {
    const result = await this.client.callTool({
      name: MANIFEST_GET,
      arguments: lowerManifestGet(selection),
    });
    return await parseManifestEnvelope(result.structuredContent, selection);
  }

  async submit(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest> {
    const validatedSubmission = await validateSubmissionManifest(submission);
    const result = await this.client.callTool({
      name: SUBMIT,
      arguments: lowerSubmission(validatedSubmission),
    });
    return await parseRequestEnvelope(result.structuredContent, validatedSubmission);
  }

  async getRequest(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest> {
    const validatedSubmission = await validateSubmissionManifest(submission);
    const result = await this.client.callTool({
      name: REQUEST_GET,
      arguments: { request_id: validatedSubmission.requestId },
    });
    return await parseRequestEnvelope(result.structuredContent, validatedSubmission);
  }

  async verifyCapturedEvidence(
    submission: ModelicaResumableSubmission,
    completed: ModelicaResumableCompletedRun,
    resources: readonly ModelicaResumableCapturedResource[],
  ): Promise<ModelicaResumableCapturedEvidence> {
    return await verifyCapturedModelicaResumableEvidence(
      submission,
      completed,
      resources,
    );
  }

  async normalizeCapturedEvidence(
    submission: ModelicaResumableSubmission,
    resources: readonly ModelicaResumableCapturedResourceTuple[],
  ): Promise<ModelicaResumableCapturedEvidence> {
    return await normalizeCapturedModelicaResumableEvidence(
      submission,
      resources,
    );
  }
}

export function lowerManifestGet(
  selection: ModelicaResumableManifestSelection,
): Readonly<Record<string, string>> {
  return Object.freeze({
    model_id: canonical(selection.modelId, "selection.modelId"),
    model_version: canonical(selection.modelVersion, "selection.modelVersion"),
    scenario_id: canonical(selection.scenarioId, "selection.scenarioId"),
  });
}

export function lowerSubmission(
  submission: ModelicaResumableSubmission,
): Readonly<Record<string, unknown>> {
  const selection = submission.manifest.selection;
  const parameters = canonicalQuantities(
    submission.parameters,
    "submission.parameters",
  );
  return Object.freeze({
    request_id: requestId(submission.requestId, "submission.requestId"),
    manifest_sha256: digest(
      submission.manifest.fingerprint,
      "submission.manifest.fingerprint",
    ),
    ...lowerManifestGet(selection),
    parameters,
    timeout_ms: timeout(submission.timeoutMs, "submission.timeoutMs"),
  });
}

/** Exact parse of the manifest_get envelope and all manifest identity/hash fields. */
export async function parseManifestEnvelope(
  value: unknown,
  expected: ModelicaResumableManifestSelection,
): Promise<ModelicaResumableManifest> {
  try {
    const envelope = exactRecord(
      value,
      ["schemaVersion", "kind", "manifest"],
      "manifest_get response",
    );
    literalValue(
      envelope.schemaVersion,
      MODELICA_RESUMABLE_CONTRACT_VERSION,
      "manifest_get.schemaVersion",
    );
    literalValue(envelope.kind, "simulation-manifest", "manifest_get.kind");
    const manifest = await parseManifest(envelope.manifest, "manifest_get.manifest");
    assertSelection(manifest.selection, expected, "manifest_get.manifest");
    return manifest;
  } catch (error) {
    throw responseError(error);
  }
}

/** Exact parse of submit/request_get envelopes and their durable cross-attestation. */
export async function parseRequestEnvelope(
  value: unknown,
  submission: ModelicaResumableSubmission,
): Promise<ModelicaResumableRequest> {
  try {
    const validatedSubmission = await validateSubmissionManifest(submission);
    const envelope = exactRecord(
      value,
      ["schemaVersion", "kind", "request"],
      "request response",
    );
    literalValue(
      envelope.schemaVersion,
      MODELICA_RESUMABLE_CONTRACT_VERSION,
      "request.schemaVersion",
    );
    literalValue(envelope.kind, "simulation-request", "request.kind");
    const expected = lowerSubmission(validatedSubmission);
    const expectedSha = await fingerprintModelicaResumableProviderJson(expected);
    const request = exactRecord(
      envelope.request,
      requestKeys(envelope.request),
      "request.request",
    );
    const id = requestId(request.request_id, "request.request.request_id");
    const requestSha256 = digest(
      request.request_sha256,
      "request.request.request_sha256",
    );
    const manifestSha256 = digest(
      request.manifest_sha256,
      "request.request.manifest_sha256",
    );
    if (
      id !== expected.request_id || requestSha256 !== expectedSha ||
      manifestSha256 !== expected.manifest_sha256
    ) {
      throw new TypeError(
        "request response does not attest the exact submitted request bytes and manifest.",
      );
    }
    const status = request.status;
    if (!isStatus(status)) {
      throw new TypeError("request.request.status is not a resumable status.");
    }
    if (status === "completed") {
      const run = await parseCompletedRun(
        request.run,
        validatedSubmission,
        requestSha256,
        manifestSha256,
      );
      return deepFreeze({
        requestId: id,
        requestSha256,
        manifestSha256,
        status,
        completedRun: run,
      });
    }
    if (status === "rejected") {
      literalValue(request.rejection, "manifest_mismatch", "request.request.rejection");
    }
    if (status === "recovery_required") {
      canonical(request.recovery, "request.request.recovery");
    }
    return deepFreeze({ requestId: id, requestSha256, manifestSha256, status });
  } catch (error) {
    throw responseError(error);
  }
}

/**
 * Reconstruct recorded evidence from an already acquired closed resource set.
 * This function is deterministic and performs no MCP/provider I/O: run.json
 * supplies the completed-run ledger, and every supplied tuple is checked
 * against both its bytes and the reconstructed ledger before normalization.
 */
export async function normalizeCapturedModelicaResumableEvidence(
  submissionValue: ModelicaResumableSubmission,
  capturedValue: readonly ModelicaResumableCapturedResourceTuple[],
): Promise<ModelicaResumableCapturedEvidence> {
  const submission = await validateSubmissionManifest(submissionValue);
  const captured = await Promise.all(capturedValue.map(async (item, index) => {
    const path = `captured resources[${index}]`;
    const role = canonical(item.role, `${path}.role`);
    const resource = validateExpectedProviderResource(
      item.resource,
      `${path}.resource`,
    );
    if (!(item.bytes instanceof Uint8Array)) {
      throw new TypeError(`${path}.bytes must be a byte value.`);
    }
    const bytes = Uint8Array.from(item.bytes);
    if (
      bytes.byteLength !== resource.byteCount ||
      await fingerprintResourceBytes(bytes) !== resource.sha256
    ) {
      throw new TypeError(
        `Captured Modelica resource ${role} differs from its supplied tuple.`,
      );
    }
    return { role, resource, bytes };
  }));
  rejectDuplicates(
    captured.map((item) => item.role),
    "captured Modelica resource roles",
  );
  rejectDuplicates(
    captured.map((item) => item.resource.uri),
    "captured Modelica resource URIs",
  );

  const runJsonResources = captured.filter((item) => item.role === "run.json");
  if (runJsonResources.length !== 1) {
    throw new TypeError(
      "Captured Modelica resources must contain exactly one run.json tuple.",
    );
  }
  const runJson = runJsonResources[0]!;
  const runLedger = parseCapturedRunLedger(runJson.bytes);
  const expectedRequestSha256 = await fingerprintModelicaResumableProviderJson(
    lowerSubmission(submission),
  );
  const completed = await parseCompletedRun(
    { ...runLedger, run_json: providerResourceWire(runJson.resource) },
    submission,
    expectedRequestSha256,
    submission.manifest.fingerprint,
  );
  const expected = expectedModelicaResumableResources({
    requestId: submission.requestId,
    requestSha256: expectedRequestSha256,
    manifestSha256: submission.manifest.fingerprint,
    status: "completed",
    completedRun: completed,
  });
  if (captured.length !== expected.length) {
    throw new TypeError(
      "Captured Modelica tuple set differs from the reconstructed run ledger.",
    );
  }
  const capturedByRole = new Map(captured.map((item) => [item.role, item]));
  for (const expectedResource of expected) {
    const actual = capturedByRole.get(expectedResource.role);
    if (
      !actual ||
      deterministicJson(actual.resource) !== deterministicJson({
          uri: expectedResource.uri,
          mediaType: expectedResource.mediaType,
          byteCount: expectedResource.byteCount,
          sha256: expectedResource.sha256,
        })
    ) {
      throw new TypeError(
        `Captured Modelica tuple ${expectedResource.role} differs from run.json.`,
      );
    }
  }
  return await verifyCapturedModelicaResumableEvidence(
    submission,
    completed,
    captured.map(({ role, bytes }) => ({ role, bytes })),
  );
}

/**
 * Re-open the exact resource set selected by the completed provider envelope
 * and cross-attest its canonical request, run ledger, lowering and evidence.
 * CSV interpretation remains owned by the exact normalizer sealed in the
 * provider manifest; the provider's run ledger proves that normalization.
 */
export async function verifyCapturedModelicaResumableEvidence(
  submissionValue: ModelicaResumableSubmission,
  completed: ModelicaResumableCompletedRun,
  captured: readonly ModelicaResumableCapturedResource[],
): Promise<ModelicaResumableCapturedEvidence> {
  const submission = await validateSubmissionManifest(submissionValue);
  const expectedRequestSha256 = await fingerprintModelicaResumableProviderJson(
    lowerSubmission(submission),
  );
  if (
    completed.requestId !== submission.requestId ||
    completed.requestSha256 !== expectedRequestSha256 ||
    completed.manifestSha256 !== submission.manifest.fingerprint
  ) {
    throw new TypeError(
      "Completed Modelica request does not match the sealed submission identity.",
    );
  }
  const expected = expectedModelicaResumableResources({
    requestId: completed.requestId,
    requestSha256: completed.requestSha256,
    manifestSha256: completed.manifestSha256,
    status: "completed",
    completedRun: completed,
  });
  const byRole = new Map<string, Uint8Array>();
  for (const item of captured) {
    if (byRole.has(item.role) || !(item.bytes instanceof Uint8Array)) {
      throw new TypeError(
        "Captured Modelica resources must have unique roles and byte values.",
      );
    }
    byRole.set(item.role, Uint8Array.from(item.bytes));
  }
  if (byRole.size !== expected.length) {
    throw new TypeError("Captured Modelica resource set is incomplete.");
  }
  for (const resource of expected) {
    const bytes = byRole.get(resource.role);
    if (!bytes) {
      throw new TypeError(`Captured Modelica resource ${resource.role} is missing.`);
    }
    if (
      bytes.byteLength !== resource.byteCount ||
      await fingerprintResourceBytes(bytes) !== resource.sha256
    ) {
      throw new TypeError(
        `Captured Modelica resource ${resource.role} differs from its ledger tuple.`,
      );
    }
  }
  for (const role of byRole.keys()) {
    if (!expected.some((resource) => resource.role === role)) {
      throw new TypeError(`Captured Modelica resource role ${role} is unexpected.`);
    }
  }

  const requestText = canonicalJsonText(requiredCaptured(byRole, "request"), "request");
  const expectedRequestText = canonicalModelicaResumableProviderJson(
    lowerSubmission(submission),
  );
  if (
    requestText !== expectedRequestText ||
    await fingerprintResourceBytes(new TextEncoder().encode(requestText)) !==
      completed.requestSha256
  ) {
    throw new TypeError(
      "Captured Modelica request.json does not equal the exact sealed submission.",
    );
  }
  const resolvedText = canonicalJsonText(
    requiredCaptured(byRole, "resolved_parameters"),
    "resolved_parameters",
  );
  if (
    resolvedText !== canonicalModelicaResumableProviderJson(
      completed.resolvedParameters,
    )
  ) {
    throw new TypeError(
      "Captured Modelica resolved parameters differ from the completed run.",
    );
  }
  const script = utf8Text(requiredCaptured(byRole, "script"), "script");
  if (
    script !== buildExpectedOmcScript(submission.manifest, completed.resolvedParameters)
  ) {
    throw new TypeError(
      "Captured Modelica run.mos does not equal the sealed lowering.",
    );
  }

  const evidenceText = canonicalJsonText(
    requiredCaptured(byRole, "evidence"),
    "evidence",
  );
  const expectedEvidence = canonicalModelicaResumableProviderJson({
    producer: "mcp-modelica",
    status: completed.status,
    request_id: completed.requestId,
    manifest_sha256: completed.manifestSha256,
    metrics: completed.metrics,
    warnings: completed.warnings,
    note:
      "This is computed evidence only. Requirement pass/fail belongs to mcp-syson and @casys/constraint-solver.",
  });
  if (evidenceText !== expectedEvidence) {
    throw new TypeError(
      "Captured Modelica evidence.json does not attest the completed observations.",
    );
  }

  const runValue = parseCapturedRunLedger(requiredCaptured(byRole, "run.json"));
  const reparsed = await parseCompletedRun(
    { ...runValue, run_json: providerResourceWire(completed.runJson) },
    submission,
    completed.requestSha256,
    completed.manifestSha256,
  );
  if (deterministicJson(reparsed) !== deterministicJson(completed)) {
    throw new TypeError(
      "Captured Modelica run.json differs from the completed request envelope.",
    );
  }
  return deepFreeze({
    runId: reparsed.runId,
    status: reparsed.status,
    startedAt: reparsed.startedAt,
    completedAt: reparsed.completedAt,
    resolvedParameters: reparsed.resolvedParameters,
    metrics: reparsed.metrics,
    warnings: reparsed.warnings,
  });
}

async function validateSubmissionManifest(
  submission: ModelicaResumableSubmission,
): Promise<ModelicaResumableSubmission> {
  const manifest = await validateModelicaQualifiedManifestDocument(
    submission.manifest,
    "$submission.manifest",
  );
  const parameters = canonicalQuantities(
    submission.parameters,
    "$submission.parameters",
  );
  assertSubmittedParameters(manifest, parameters, "$submission.parameters");
  return Object.freeze({
    requestId: requestId(submission.requestId, "$submission.requestId"),
    manifest,
    parameters,
    timeoutMs: timeout(submission.timeoutMs, "$submission.timeoutMs"),
  });
}

function requestKeys(value: unknown): string[] {
  const base = ["request_id", "request_sha256", "manifest_sha256", "status"];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return base;
  const status = (value as Record<string, unknown>).status;
  if (status === "completed") return [...base, "run"];
  if (status === "rejected") return [...base, "rejection"];
  if (status === "recovery_required") return [...base, "recovery"];
  return base;
}

async function parseManifest(
  value: unknown,
  path: string,
): Promise<ModelicaResumableManifest> {
  const root = exactOptionalRecord(
    value,
    [
      "schemaVersion",
      "fingerprint",
      "manifest_sha256",
      "model",
      "scenario",
      "parameters",
      "produced_metrics",
      "result_normalizer",
      "lowering",
      "engine",
    ],
    ["parameter_schema"],
    path,
  );
  literalValue(
    root.schemaVersion,
    MODELICA_RESUMABLE_CONTRACT_VERSION,
    `${path}.schemaVersion`,
  );
  const fingerprint = digest(root.fingerprint, `${path}.fingerprint`);
  if (fingerprint !== digest(root.manifest_sha256, `${path}.manifest_sha256`)) {
    throw new TypeError(`${path} fingerprint and manifest_sha256 differ.`);
  }
  const { fingerprint: _fingerprint, manifest_sha256: _manifest, ...unsigned } = root;
  if (await fingerprintModelicaResumableProviderJson(unsigned) !== fingerprint) {
    throw new TypeError(`${path} fingerprint does not match canonical manifest bytes.`);
  }
  const model = exactRecord(
    root.model,
    ["id", "version", "name", "source"],
    `${path}.model`,
  );
  const scenario = exactRecord(root.scenario, [
    "id",
    "source",
    "public",
    "projection_sha256",
  ], `${path}.scenario`);
  const modelName = canonical(model.name, `${path}.model.name`);
  const modelResource = parseResource(
    model.source,
    `${path}.model.source`,
    "qualified-kit",
  );
  const scenarioResource = parseResource(
    scenario.source,
    `${path}.scenario.source`,
    "qualified-kit",
  );
  const scenarioProjectionSha256 = digest(
    scenario.projection_sha256,
    `${path}.scenario.projection_sha256`,
  );
  const scenarioPublic = parseScenarioPublic(
    scenario.public,
    `${path}.scenario.public`,
    canonical(scenario.id, `${path}.scenario.id`),
  );
  if (
    await fingerprintModelicaResumableProviderJson(scenario.public) !==
      scenarioProjectionSha256
  ) {
    throw new TypeError(
      `${path}.scenario projection_sha256 does not match canonical public scenario bytes.`,
    );
  }
  const parameterSchema = root.parameter_schema === undefined
    ? undefined
    : parseResource(
      root.parameter_schema,
      `${path}.parameter_schema`,
      "compiler-derived-verified",
    );
  const parameters = parseManifestParameters(root.parameters, `${path}.parameters`);
  const producedMetrics = parseMetrics(
    root.produced_metrics,
    `${path}.produced_metrics`,
  );
  const resultNormalizer = parseIdentity(
    root.result_normalizer,
    `${path}.result_normalizer`,
  );
  const lowering = parseIdentity(root.lowering, `${path}.lowering`);
  const engine = parseEngine(root.engine, `${path}.engine`);
  return await validateModelicaQualifiedManifestDocument({
    schemaVersion: MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION,
    contractVersion: MODELICA_RESUMABLE_CONTRACT_VERSION,
    selection: {
      modelId: canonical(model.id, `${path}.model.id`),
      modelVersion: canonical(model.version, `${path}.model.version`),
      scenarioId: canonical(scenario.id, `${path}.scenario.id`),
    },
    fingerprint,
    modelName,
    model: modelResource,
    scenario: scenarioResource,
    scenarioPublic,
    scenarioProjectionSha256,
    ...(parameterSchema === undefined ? {} : { parameterSchema }),
    parameters,
    producedMetrics,
    resultNormalizer,
    lowering,
    engine,
  }, `${path}.normalized`);
}

async function parseCompletedRun(
  value: unknown,
  submission: ModelicaResumableSubmission,
  requestSha256: string,
  manifestSha256: string,
): Promise<ModelicaResumableCompletedRun> {
  const run = exactRecord(value, [
    "schemaVersion",
    "kind",
    "request_id",
    "request_sha256",
    "manifest",
    "run_id",
    "status",
    "started_at",
    "completed_at",
    "resolved_parameters",
    "metrics",
    "artifacts",
    "warnings",
    "run_json",
  ], "request.request.run");
  literalValue(
    run.schemaVersion,
    MODELICA_RESUMABLE_CONTRACT_VERSION,
    "request.request.run.schemaVersion",
  );
  literalValue(run.kind, "simulation-run", "request.request.run.kind");
  literalValue(run.request_id, submission.requestId, "request.request.run.request_id");
  literalValue(run.request_sha256, requestSha256, "request.request.run.request_sha256");
  const manifest = await parseManifest(run.manifest, "request.request.run.manifest");
  assertSelection(
    manifest.selection,
    submission.manifest.selection,
    "request.request.run.manifest",
  );
  if (
    manifest.fingerprint !== manifestSha256 ||
    manifest.fingerprint !== submission.manifest.fingerprint
  ) {
    throw new TypeError(
      "completed run manifest does not match the sealed submission manifest.",
    );
  }
  const runId = canonical(run.run_id, "request.request.run.run_id");
  if (!RUN_ID.test(runId)) {
    throw new TypeError("request.request.run.run_id is not a resumable run id.");
  }
  if (!isRunStatus(run.status)) {
    throw new TypeError("request.request.run.status is invalid.");
  }
  const status = run.status;
  const startedAt = iso(run.started_at, "request.request.run.started_at");
  const completedAt = iso(run.completed_at, "request.request.run.completed_at");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new TypeError("request.request.run completes before it starts.");
  }
  const resolvedParameters = canonicalQuantities(
    run.resolved_parameters as Record<string, unknown>,
    "request.request.run.resolved_parameters",
  );
  assertResolvedParameters(
    resolvedParameters,
    submission.manifest,
    submission.parameters,
    "request.request.run.resolved_parameters",
  );
  const metrics = canonicalQuantities(
    run.metrics as Record<string, unknown>,
    "request.request.run.metrics",
  );
  assertMetrics(metrics, submission.manifest, status, "request.request.run.metrics");
  const artifacts = arrayOf(run.artifacts, "request.request.run.artifacts").map((
    item,
    index,
  ) => parseArtifact(item, `request.request.run.artifacts[${index}]`, runId));
  rejectDuplicates(
    artifacts.map((artifact) => artifact.role),
    "request.request.run artifact roles",
  );
  rejectDuplicates(
    artifacts.map((artifact) => artifact.uri),
    "request.request.run artifact URIs",
  );
  assertArtifactProfile(
    artifacts,
    submission,
    status,
    runId,
    "request.request.run.artifacts",
  );
  const runJson = parseRunJson(
    run.run_json,
    "request.request.run.run_json",
    submission.requestId,
  );
  if (artifacts.some((artifact) => artifact.uri === runJson.uri)) {
    throw new TypeError("request.request.run run.json URI duplicates an artifact URI.");
  }
  if (
    !Array.isArray(run.warnings) ||
    run.warnings.some((warning) => typeof warning !== "string")
  ) throw new TypeError("request.request.run.warnings must be a string array.");
  const warnings = deepFreeze([...run.warnings] as string[]);
  return deepFreeze({
    requestId: submission.requestId,
    requestSha256,
    manifestSha256,
    runId,
    status,
    startedAt,
    completedAt,
    resolvedParameters,
    metrics,
    warnings,
    artifacts,
    runJson,
  });
}

function parseArtifact(
  value: unknown,
  path: string,
  runId: string,
): ModelicaResumableArtifact {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const role = (value as Record<string, unknown>).kind;
  if (!isArtifactRole(role)) {
    throw new TypeError(`${path}.kind is not a resumable artifact role.`);
  }
  if (role === "request") {
    const raw = exactRecord(value, [
      "kind",
      "file_name",
      "uri",
      "mediaType",
      "sha256",
      "bytes",
    ], path);
    literalValue(raw.file_name, "request.json", `${path}.file_name`);
    literalValue(raw.mediaType, "application/json", `${path}.mediaType`);
    return deepFreeze({
      role,
      fileName: "request.json",
      ...parseExpected({
        uri: raw.uri,
        mediaType: raw.mediaType,
        byteCount: raw.bytes,
        sha256: raw.sha256,
      }, path),
    });
  }
  const raw = exactOptionalRecord(
    value,
    ["kind", "file_name", "run_id", "uri", "mediaType", "sha256", "bytes"],
    ["qualification", "source_resource"],
    path,
  );
  literalValue(raw.run_id, runId, `${path}.run_id`);
  const fileName = canonical(raw.file_name, `${path}.file_name`);
  if (
    raw.qualification !== undefined && raw.qualification !== "qualified-kit" &&
    raw.qualification !== "compiler-derived-verified"
  ) throw new TypeError(`${path}.qualification is invalid.`);
  const sourceResource = raw.source_resource === undefined
    ? undefined
    : parseResource(raw.source_resource, `${path}.source_resource`);
  return deepFreeze({
    role,
    fileName,
    ...(raw.qualification === undefined ? {} : {
      qualification: raw.qualification as ModelicaResumableResource["qualification"],
    }),
    ...(sourceResource === undefined ? {} : { sourceResource }),
    ...parseExpected({
      uri: raw.uri,
      mediaType: raw.mediaType,
      byteCount: raw.bytes,
      sha256: raw.sha256,
    }, path),
  });
}

function parseRunJson(
  value: unknown,
  path: string,
  requestId: string,
): ExpectedProviderResource {
  const raw = exactRecord(value, ["uri", "mediaType", "sha256", "bytes"], path);
  literalValue(
    raw.uri,
    requestArtifactUri(requestId, "run.json"),
    `${path}.uri`,
  );
  literalValue(raw.mediaType, "application/json", `${path}.mediaType`);
  return parseExpected({
    uri: raw.uri,
    mediaType: raw.mediaType,
    byteCount: raw.bytes,
    sha256: raw.sha256,
  }, path);
}

function assertSubmittedParameters(
  manifest: ModelicaResumableManifest,
  parameters: Readonly<Record<string, ModelicaResumableQuantity>>,
  path: string,
): void {
  const expected = manifest.parameters.map((parameter) => parameter.id).sort();
  const actual = Object.keys(parameters).sort();
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError(`${path} must cover every sealed parameter and no extras.`);
  }
  for (const definition of manifest.parameters) {
    const quantity = parameters[definition.id];
    if (
      quantity.unit !== definition.unit || quantity.value < definition.minimum ||
      quantity.value > definition.maximum
    ) {
      throw new TypeError(
        `${path}.${definition.id} violates the sealed unit or bounds.`,
      );
    }
  }
}

function assertResolvedParameters(
  actual: Readonly<Record<string, ModelicaResumableQuantity>>,
  manifest: ModelicaResumableManifest,
  submitted: Readonly<Record<string, ModelicaResumableQuantity>>,
  path: string,
): void {
  assertSubmittedParameters(manifest, actual, path);
  if (deterministicJson(actual) !== deterministicJson(submitted)) {
    throw new TypeError(`${path} does not equal the exact submitted quantities.`);
  }
}

function assertMetrics(
  metrics: Readonly<Record<string, ModelicaResumableQuantity>>,
  manifest: ModelicaResumableManifest,
  status: ModelicaResumableCompletedRun["status"],
  path: string,
): void {
  if (status !== "succeeded" && Object.keys(metrics).length !== 0) {
    throw new TypeError(`${path} must be empty for a non-successful run.`);
  }
  const definitions = new Map(
    manifest.producedMetrics.map((metric) => [metric.id, metric]),
  );
  for (const [id, quantity] of Object.entries(metrics)) {
    const definition = definitions.get(id);
    if (!definition || quantity.unit !== definition.unit) {
      throw new TypeError(`${path}.${id} is not a sealed metric/unit pair.`);
    }
  }
  if (status === "succeeded") {
    for (const definition of manifest.producedMetrics) {
      if (definition.required && !Object.hasOwn(metrics, definition.id)) {
        throw new TypeError(`${path} is missing required metric ${definition.id}.`);
      }
    }
  }
}

function assertArtifactProfile(
  artifacts: readonly ModelicaResumableArtifact[],
  submission: ModelicaResumableSubmission,
  status: ModelicaResumableCompletedRun["status"],
  runId: string,
  path: string,
): void {
  const manifest = submission.manifest;
  const expected: Array<{
    role: ModelicaResumableArtifact["role"];
    fileName: string;
    mediaType: string;
    source?: ModelicaResumableResource;
  }> = [
    { role: "request", fileName: "request.json", mediaType: "application/json" },
    {
      role: "resolved_parameters",
      fileName: "resolved-parameters.json",
      mediaType: "application/json",
    },
    {
      role: "model",
      fileName: `${manifest.modelName}.mo`,
      mediaType: "text/x-modelica",
      source: manifest.model,
    },
    {
      role: "scenario",
      fileName: "scenario.json",
      mediaType: "application/json",
      source: manifest.scenario,
    },
    ...(manifest.parameterSchema === undefined ? [] : [{
      role: "parameter_schema" as const,
      fileName: "parameter-schema.json",
      mediaType: "application/json",
      source: manifest.parameterSchema,
    }]),
    { role: "script", fileName: "run.mos", mediaType: "text/plain" },
    { role: "diagnostics", fileName: "omc.log", mediaType: "text/plain" },
    ...(status === "succeeded"
      ? [{
        role: "result" as const,
        fileName: "result.csv",
        mediaType: "text/csv",
      }]
      : []),
    { role: "evidence", fileName: "evidence.json", mediaType: "application/json" },
  ];
  if (artifacts.length !== expected.length) {
    throw new TypeError(`${path} does not contain the exact resumable profile.`);
  }
  for (const [index, profile] of expected.entries()) {
    const artifact = artifacts[index];
    if (
      artifact.role !== profile.role || artifact.fileName !== profile.fileName ||
      artifact.mediaType !== profile.mediaType ||
      artifact.uri !== requestArtifactUri(
          submission.requestId,
          profile.role === "request" ? "request.json" : `artifacts/${profile.fileName}`,
        )
    ) {
      throw new TypeError(
        `${path}[${index}] does not match its canonical role identity.`,
      );
    }
    if (profile.source) {
      if (
        !artifact.sourceResource ||
        deterministicJson(artifact.sourceResource) !==
          deterministicJson(profile.source) ||
        artifact.qualification !== profile.source.qualification ||
        artifact.sha256 !== profile.source.sha256 ||
        artifact.byteCount !== profile.source.byteCount
      ) {
        throw new TypeError(
          `${path}[${index}] does not cross-attest its sealed source resource.`,
        );
      }
    } else if (artifact.qualification !== undefined || artifact.sourceResource) {
      throw new TypeError(`${path}[${index}] has unexpected source qualification.`);
    }
  }
  // The parse step has already checked every non-request artifact run_id.
  canonical(runId, `${path}.runId`);
}

function parseExpected(value: unknown, path: string): ExpectedProviderResource {
  return validateExpectedProviderResource(value, path);
}

function parseResource(
  value: unknown,
  path: string,
  qualification?: ModelicaResumableResource["qualification"],
): ModelicaResumableResource {
  const raw = exactRecord(value, [
    "uri",
    "mediaType",
    "bytes",
    "sha256",
    "qualification",
  ], path);
  if (qualification) {
    literalValue(raw.qualification, qualification, `${path}.qualification`);
  }
  if (
    raw.qualification !== "qualified-kit" &&
    raw.qualification !== "compiler-derived-verified"
  ) throw new TypeError(`${path}.qualification is invalid.`);
  return deepFreeze({
    qualification: raw.qualification,
    ...parseExpected({
      uri: raw.uri,
      mediaType: raw.mediaType,
      byteCount: raw.bytes,
      sha256: raw.sha256,
    }, path),
  });
}

function exactOptionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`${path} has unsupported field ${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) throw new TypeError(`${path}.${key} is required.`);
  }
  return record;
}

function parseScenarioPublic(
  value: unknown,
  path: string,
  id: string,
): ModelicaResumableScenarioPublic {
  const raw = exactRecord(value, [
    "id",
    "description",
    "start_time_s",
    "stop_time_s",
    "number_of_intervals",
    "solver",
    "target_temperature",
  ], path);
  literalValue(raw.id, id, `${path}.id`);
  const startTimeS = finite(raw.start_time_s, `${path}.start_time_s`);
  const stopTimeS = finite(raw.stop_time_s, `${path}.stop_time_s`);
  if (startTimeS < 0 || stopTimeS <= startTimeS) {
    throw new TypeError(`${path} has invalid time bounds.`);
  }
  return deepFreeze({
    id,
    description: canonical(raw.description, `${path}.description`),
    startTimeS,
    stopTimeS,
    numberOfIntervals: positiveInteger(
      raw.number_of_intervals,
      `${path}.number_of_intervals`,
    ),
    solver: canonical(raw.solver, `${path}.solver`),
    targetTemperature: parseQuantity(
      raw.target_temperature,
      `${path}.target_temperature`,
    ),
  });
}
function parseManifestParameters(
  value: unknown,
  path: string,
): ModelicaResumableManifest["parameters"] {
  const entries = arrayOf(value, path);
  const ids: string[] = [];
  const names: string[] = [];
  const parameters = entries.map((entry, index) => {
    const p = exactRecord(entry, [
      "id",
      "modelica_name",
      "modelica_type",
      "description",
      "unit",
      "minimum",
      "maximum",
      "conversion",
    ], `${path}[${index}]`);
    const id = canonical(p.id, `${path}[${index}].id`);
    const modelicaName = canonical(p.modelica_name, `${path}[${index}].modelica_name`);
    const minimum = finite(p.minimum, `${path}[${index}].minimum`);
    const maximum = finite(p.maximum, `${path}[${index}].maximum`);
    ids.push(id);
    names.push(modelicaName);
    if (minimum > maximum) {
      throw new TypeError(`${path}[${index}] minimum exceeds maximum.`);
    }
    const c = exactRecord(
      p.conversion,
      ["from", "to", "factor", "offset"],
      `${path}[${index}].conversion`,
    );
    const factor = finite(c.factor, `${path}[${index}].conversion.factor`);
    if (factor === 0) {
      throw new TypeError(`${path}[${index}].conversion.factor must not be zero.`);
    }
    return deepFreeze({
      id,
      modelicaName,
      modelicaType: canonical(p.modelica_type, `${path}[${index}].modelica_type`),
      description: canonical(p.description, `${path}[${index}].description`),
      unit: canonical(p.unit, `${path}[${index}].unit`),
      minimum,
      maximum,
      conversion: {
        from: canonical(c.from, `${path}[${index}].conversion.from`),
        to: canonical(c.to, `${path}[${index}].conversion.to`),
        factor,
        offset: finite(c.offset, `${path}[${index}].conversion.offset`),
      },
    });
  });
  rejectDuplicates(ids, `${path} ids`);
  rejectDuplicates(names, `${path} Modelica names`);
  return deepFreeze(parameters);
}
function parseMetrics(
  value: unknown,
  path: string,
): ModelicaResumableManifest["producedMetrics"] {
  const values = arrayOf(value, path);
  if (values.length === 0) throw new TypeError(`${path} must not be empty.`);
  const ids: string[] = [];
  const metrics = values.map((entry, index) => {
    const m = exactRecord(
      entry,
      ["id", "unit", "description", "required"],
      `${path}[${index}]`,
    );
    const id = canonical(m.id, `${path}[${index}].id`);
    ids.push(id);
    if (typeof m.required !== "boolean") {
      throw new TypeError(`${path}[${index}].required must be boolean.`);
    }
    return deepFreeze({
      id,
      unit: canonical(m.unit, `${path}[${index}].unit`),
      description: canonical(m.description, `${path}[${index}].description`),
      required: m.required,
    });
  });
  rejectDuplicates(ids, `${path} ids`);
  return deepFreeze(metrics);
}
function parseIdentity(value: unknown, path: string): ModelicaResumableIdentity {
  const raw = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: canonical(raw.id, `${path}.id`),
    version: canonical(raw.version, `${path}.version`),
  });
}
function parseEngine(value: unknown, path: string): ModelicaResumableEngineIdentity {
  const raw = exactRecord(value, ["name", "version", "msl_version"], path);
  return deepFreeze({
    name: canonical(raw.name, `${path}.name`),
    version: canonical(raw.version, `${path}.version`),
    mslVersion: canonical(raw.msl_version, `${path}.msl_version`),
  });
}
function canonicalQuantities(
  value: Readonly<Record<string, unknown>>,
  path: string,
): Readonly<Record<string, { readonly value: number; readonly unit: string }>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const result: Record<string, { readonly value: number; readonly unit: string }> = {};
  for (const id of Object.keys(value).sort()) {
    result[canonical(id, `${path} key`)] = parseQuantity(
      (value as Record<string, unknown>)[id],
      `${path}.${id}`,
    );
  }
  return deepFreeze(result);
}
function parseQuantity(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: string } {
  const raw = exactRecord(value, ["value", "unit"], path);
  return deepFreeze({
    value: finite(raw.value, `${path}.value`),
    unit: canonical(raw.unit, `${path}.unit`),
  });
}
function assertSelection(
  actual: ModelicaResumableManifestSelection,
  expected: ModelicaResumableManifestSelection,
  path: string,
): void {
  if (
    actual.modelId !== expected.modelId ||
    actual.modelVersion !== expected.modelVersion ||
    actual.scenarioId !== expected.scenarioId
  ) {
    throw new TypeError(
      `${path} does not match the selected qualified model and scenario.`,
    );
  }
}
function requestId(value: unknown, path: string): string {
  const result = canonical(value, path);
  if (!REQUEST_ID.test(result)) {
    throw new TypeError(`${path} is not a canonical request id.`);
  }
  return result;
}
function digest(value: unknown, path: string): string {
  const result = canonical(value, path);
  if (!SHA256.test(result)) {
    throw new TypeError(`${path} must be lowercase sha256 hex.`);
  }
  return result;
}
function timeout(value: unknown, path: string): number {
  const result = positiveInteger(value, path);
  if (result > 120_000) throw new TypeError(`${path} must not exceed 120000.`);
  return result;
}
function canonical(value: unknown, path: string): string {
  return nonEmptyText(value, path);
}
function iso(value: unknown, path: string): string {
  const text = canonical(value, path);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) {
    throw new TypeError(`${path} must be an ISO UTC timestamp.`);
  }
  return text;
}
function isStatus(value: unknown): value is ModelicaResumableRequest["status"] {
  return value === "pending" || value === "running" || value === "completed" ||
    value === "rejected" || value === "recovery_required";
}
function isArtifactRole(value: unknown): value is ModelicaResumableArtifact["role"] {
  return value === "request" || value === "resolved_parameters" || value === "model" ||
    value === "scenario" || value === "parameter_schema" || value === "script" ||
    value === "diagnostics" || value === "result" || value === "evidence";
}

function requiredCaptured(
  resources: ReadonlyMap<string, Uint8Array>,
  role: string,
): Uint8Array {
  const bytes = resources.get(role);
  if (!bytes) throw new TypeError(`Captured Modelica resource ${role} is missing.`);
  return bytes;
}

function parseCapturedRunLedger(bytes: Uint8Array): Record<string, unknown> {
  const text = canonicalJsonText(bytes, "run.json");
  return exactRecord(JSON.parse(text), [
    "schemaVersion",
    "kind",
    "request_id",
    "request_sha256",
    "manifest",
    "run_id",
    "status",
    "started_at",
    "completed_at",
    "resolved_parameters",
    "metrics",
    "artifacts",
    "warnings",
  ], "captured run.json");
}

function utf8Text(bytes: Uint8Array, role: string): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (new TextEncoder().encode(text).byteLength !== bytes.byteLength) {
      throw new TypeError(`Captured Modelica ${role} is not canonical UTF-8.`);
    }
    return text;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("Captured Modelica")) {
      throw error;
    }
    throw new TypeError(`Captured Modelica ${role} is not valid UTF-8.`, {
      cause: error,
    });
  }
}

function canonicalJsonText(bytes: Uint8Array, role: string): string {
  const text = utf8Text(bytes, role);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`Captured Modelica ${role} is not valid JSON.`, {
      cause: error,
    });
  }
  if (canonicalModelicaResumableProviderJson(value) !== text) {
    throw new TypeError(`Captured Modelica ${role} is not canonical JSON.`);
  }
  return text;
}

function providerResourceWire(resource: ExpectedProviderResource) {
  return {
    uri: resource.uri,
    mediaType: resource.mediaType,
    sha256: resource.sha256,
    bytes: resource.byteCount,
  };
}

function requestArtifactUri(requestId: string, suffix = "request.json"): string {
  return `casys://modelica/requests/${encodeURIComponent(requestId)}/${suffix}`;
}

function buildExpectedOmcScript(
  manifest: ModelicaResumableManifest,
  resolved: Readonly<Record<string, ModelicaResumableQuantity>>,
): string {
  if (
    manifest.lowering.id !== "modelica-omc-lowering" ||
    manifest.lowering.version !== "1.0.0"
  ) {
    throw new TypeError("Modelica manifest names an unsupported lowering identity.");
  }
  assertSubmittedParameters(manifest, resolved, "completed.resolvedParameters");
  const modelicaValues = manifest.parameters.map((parameter) => {
    const quantity = resolved[parameter.id];
    const converted = quantity.value * parameter.conversion.factor +
      parameter.conversion.offset;
    if (!Number.isFinite(converted)) {
      throw new TypeError("A sealed Modelica unit conversion is non-finite.");
    }
    return [parameter.modelicaName, Object.is(converted, -0) ? 0 : converted] as const;
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const overrides = modelicaValues.map(([name, value]) =>
    `${name}=${formatModelicaNumber(value)}`
  ).join(",");
  const scenario = manifest.scenarioPublic;
  return [
    "// Generated by mcp-modelica 2.1. Do not edit: the server owns this script.",
    "loadModel(Modelica);",
    `loadFile("${manifest.modelName}.mo");`,
    `simulate(${manifest.modelName}, startTime=${
      formatModelicaNumber(scenario.startTimeS)
    }, stopTime=${
      formatModelicaNumber(scenario.stopTimeS)
    }, numberOfIntervals=${scenario.numberOfIntervals}, method="${scenario.solver}", outputFormat="csv", fileNamePrefix="result", simflags="-override=${overrides}");`,
    "getErrorString();",
    "",
  ].join("\n");
}

function formatModelicaNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Modelica lowering received a non-finite number.");
  }
  return Object.is(value, -0) ? "0" : String(value);
}

function isRunStatus(
  value: unknown,
): value is ModelicaResumableCompletedRun["status"] {
  return value === "succeeded" || value === "failed" || value === "timed_out";
}
function responseError(error: unknown): McpModelicaResumableResponseError {
  return new McpModelicaResumableResponseError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
