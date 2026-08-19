/**
 * Capability-first boundary for the private mcp-modelica resumable 2.1
 * contract.  It deliberately names no MCP tool, transport, or resource-list
 * operation: those are adapter concerns.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  type ExpectedProviderResource,
  validateExpectedProviderResource,
} from "../../compile/source/provider-resource-reader.ts";

export const MODELICA_RESUMABLE_CONTRACT_VERSION = "2.1" as const;
export const MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION =
  "modelica-qualified-manifest/1.0" as const;

/**
 * Exact JSON representation sealed by mcp-modelica 2.1.
 *
 * This is intentionally distinct from Digital Thread's compact CAS JSON:
 * provider manifest, scenario-projection, request, and run-ledger digests
 * attest the provider's recursively sorted, two-space-indented bytes with a
 * trailing newline.
 */
export function canonicalModelicaResumableProviderJson(value: unknown): string {
  return JSON.stringify(sortModelicaResumableProviderJson(value), null, 2) + "\n";
}

/** SHA-256 of the exact mcp-modelica 2.1 canonical JSON representation. */
export async function fingerprintModelicaResumableProviderJson(
  value: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalModelicaResumableProviderJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface ModelicaResumableManifestSelection {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly scenarioId: string;
}

export interface ModelicaResumableQuantity {
  readonly value: number;
  readonly unit: string;
}

export interface ModelicaResumableResource extends ExpectedProviderResource {
  readonly qualification: "qualified-kit" | "compiler-derived-verified";
}

export interface ModelicaResumableScenarioPublic {
  readonly id: string;
  readonly description: string;
  readonly startTimeS: number;
  readonly stopTimeS: number;
  readonly numberOfIntervals: number;
  readonly solver: string;
  readonly targetTemperature: ModelicaResumableQuantity;
}

export interface ModelicaResumableParameter {
  readonly id: string;
  readonly modelicaName: string;
  readonly modelicaType: string;
  readonly description: string;
  readonly unit: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly conversion: {
    readonly from: string;
    readonly to: string;
    readonly factor: number;
    readonly offset: number;
  };
}

export interface ModelicaResumableProducedMetric {
  readonly id: string;
  readonly unit: string;
  readonly description: string;
  readonly required: boolean;
}

export interface ModelicaResumableIdentity {
  readonly id: string;
  readonly version: string;
}

export interface ModelicaResumableEngineIdentity {
  readonly name: string;
  readonly version: string;
  readonly mslVersion: string;
}

/**
 * Persistable, provider-neutral projection of one fully checked 2.1 manifest.
 * Its provider fingerprint remains verifiable without importing an MCP parser.
 */
export interface ModelicaQualifiedManifestDocument {
  readonly schemaVersion: typeof MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION;
  readonly contractVersion: typeof MODELICA_RESUMABLE_CONTRACT_VERSION;
  readonly selection: ModelicaResumableManifestSelection;
  readonly fingerprint: string;
  readonly modelName: string;
  readonly model: ModelicaResumableResource;
  readonly scenario: ModelicaResumableResource;
  readonly scenarioPublic: ModelicaResumableScenarioPublic;
  readonly scenarioProjectionSha256: string;
  readonly parameterSchema?: ModelicaResumableResource;
  readonly parameters: readonly ModelicaResumableParameter[];
  readonly producedMetrics: readonly ModelicaResumableProducedMetric[];
  readonly resultNormalizer: ModelicaResumableIdentity;
  readonly lowering: ModelicaResumableIdentity;
  readonly engine: ModelicaResumableEngineIdentity;
}

export type ModelicaResumableManifest = ModelicaQualifiedManifestDocument;

/**
 * Validate persisted normalized bytes and re-attest the original provider
 * manifest fingerprint by rebuilding its exact 2.1 snake_case payload.
 */
export async function validateModelicaQualifiedManifestDocument(
  value: unknown,
  path = "$qualifiedManifest",
): Promise<ModelicaQualifiedManifestDocument> {
  const root = exactOptionalRecord(
    value,
    [
      "schemaVersion",
      "contractVersion",
      "selection",
      "fingerprint",
      "modelName",
      "model",
      "scenario",
      "scenarioPublic",
      "scenarioProjectionSha256",
      "parameters",
      "producedMetrics",
      "resultNormalizer",
      "lowering",
      "engine",
    ],
    ["parameterSchema"],
    path,
  );
  literalValue(
    root.schemaVersion,
    MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.contractVersion,
    MODELICA_RESUMABLE_CONTRACT_VERSION,
    `${path}.contractVersion`,
  );
  const selectionInput = exactRecord(
    root.selection,
    ["modelId", "modelVersion", "scenarioId"],
    `${path}.selection`,
  );
  const selection = deepFreeze({
    modelId: canonicalText(selectionInput.modelId, `${path}.selection.modelId`),
    modelVersion: canonicalText(
      selectionInput.modelVersion,
      `${path}.selection.modelVersion`,
    ),
    scenarioId: canonicalText(
      selectionInput.scenarioId,
      `${path}.selection.scenarioId`,
    ),
  });
  const fingerprint = sha256Hex(root.fingerprint, `${path}.fingerprint`);
  const modelName = modelicaIdentifier(root.modelName, `${path}.modelName`);
  const model = qualifiedResource(
    root.model,
    `${path}.model`,
    modelResourceUri(selection),
    "text/x-modelica",
    "qualified-kit",
  );
  const scenario = qualifiedResource(
    root.scenario,
    `${path}.scenario`,
    scenarioResourceUri(selection),
    "application/json",
    "qualified-kit",
  );
  const scenarioPublic = normalizedScenarioPublic(
    root.scenarioPublic,
    `${path}.scenarioPublic`,
    selection.scenarioId,
  );
  const scenarioProjectionSha256 = sha256Hex(
    root.scenarioProjectionSha256,
    `${path}.scenarioProjectionSha256`,
  );
  if (
    await fingerprintModelicaResumableProviderJson(
      providerScenarioPublicPayload(scenarioPublic),
    ) !==
      scenarioProjectionSha256
  ) {
    throw new TypeError(
      `${path}.scenarioProjectionSha256 does not match the canonical provider scenario projection.`,
    );
  }
  const parameterSchema = root.parameterSchema === undefined
    ? undefined
    : qualifiedResource(
      root.parameterSchema,
      `${path}.parameterSchema`,
      parameterSchemaResourceUri(selection),
      "application/json",
      "compiler-derived-verified",
    );
  const parameters = normalizedParameters(root.parameters, `${path}.parameters`);
  const producedMetrics = normalizedMetrics(
    root.producedMetrics,
    `${path}.producedMetrics`,
  );
  const resultNormalizer = normalizedIdentity(
    root.resultNormalizer,
    `${path}.resultNormalizer`,
  );
  const lowering = normalizedIdentity(root.lowering, `${path}.lowering`);
  const engine = normalizedEngine(root.engine, `${path}.engine`);
  const document = deepFreeze<ModelicaQualifiedManifestDocument>({
    schemaVersion: MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION,
    contractVersion: MODELICA_RESUMABLE_CONTRACT_VERSION,
    selection,
    fingerprint,
    modelName,
    model,
    scenario,
    scenarioPublic,
    scenarioProjectionSha256,
    ...(parameterSchema === undefined ? {} : { parameterSchema }),
    parameters,
    producedMetrics,
    resultNormalizer,
    lowering,
    engine,
  });
  if (
    await fingerprintModelicaResumableProviderJson(
      providerManifestUnsignedPayload(document),
    ) !==
      fingerprint
  ) {
    throw new TypeError(
      `${path}.fingerprint does not match the reconstructed provider 2.1 manifest payload.`,
    );
  }
  return document;
}

/** Canonical CAS bytes for the validated normalized manifest document. */
export async function canonicalModelicaQualifiedManifestDocumentText(
  value: unknown,
): Promise<string> {
  return deterministicJson(await validateModelicaQualifiedManifestDocument(value));
}

function providerManifestUnsignedPayload(
  manifest: ModelicaQualifiedManifestDocument,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: MODELICA_RESUMABLE_CONTRACT_VERSION,
    model: {
      id: manifest.selection.modelId,
      version: manifest.selection.modelVersion,
      name: manifest.modelName,
      source: providerResourcePayload(manifest.model),
    },
    scenario: {
      id: manifest.selection.scenarioId,
      source: providerResourcePayload(manifest.scenario),
      public: providerScenarioPublicPayload(manifest.scenarioPublic),
      projection_sha256: manifest.scenarioProjectionSha256,
    },
    ...(manifest.parameterSchema === undefined ? {} : {
      parameter_schema: providerResourcePayload(manifest.parameterSchema),
    }),
    parameters: manifest.parameters.map((parameter) => ({
      id: parameter.id,
      modelica_name: parameter.modelicaName,
      modelica_type: parameter.modelicaType,
      description: parameter.description,
      unit: parameter.unit,
      minimum: parameter.minimum,
      maximum: parameter.maximum,
      conversion: { ...parameter.conversion },
    })),
    produced_metrics: manifest.producedMetrics.map((metric) => ({ ...metric })),
    result_normalizer: { ...manifest.resultNormalizer },
    lowering: { ...manifest.lowering },
    engine: {
      name: manifest.engine.name,
      version: manifest.engine.version,
      msl_version: manifest.engine.mslVersion,
    },
  };
}

function sortModelicaResumableProviderJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortModelicaResumableProviderJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, sortModelicaResumableProviderJson(child)]),
    );
  }
  return value;
}

function providerResourcePayload(resource: ModelicaResumableResource) {
  return {
    uri: resource.uri,
    mediaType: resource.mediaType,
    bytes: resource.byteCount,
    sha256: resource.sha256,
    qualification: resource.qualification,
  };
}

function providerScenarioPublicPayload(
  scenario: ModelicaResumableScenarioPublic,
) {
  return {
    id: scenario.id,
    description: scenario.description,
    start_time_s: scenario.startTimeS,
    stop_time_s: scenario.stopTimeS,
    number_of_intervals: scenario.numberOfIntervals,
    solver: scenario.solver,
    target_temperature: { ...scenario.targetTemperature },
  };
}

function qualifiedResource(
  value: unknown,
  path: string,
  expectedUri: string,
  expectedMediaType: string,
  expectedQualification: ModelicaResumableResource["qualification"],
): ModelicaResumableResource {
  const input = exactRecord(
    value,
    ["uri", "mediaType", "byteCount", "sha256", "qualification"],
    path,
  );
  literalValue(input.uri, expectedUri, `${path}.uri`);
  literalValue(input.mediaType, expectedMediaType, `${path}.mediaType`);
  literalValue(input.qualification, expectedQualification, `${path}.qualification`);
  return deepFreeze({
    ...validateExpectedProviderResource({
      uri: input.uri,
      mediaType: input.mediaType,
      byteCount: input.byteCount,
      sha256: input.sha256,
    }, path),
    qualification: expectedQualification,
  });
}

function normalizedScenarioPublic(
  value: unknown,
  path: string,
  expectedId: string,
): ModelicaResumableScenarioPublic {
  const input = exactRecord(
    value,
    [
      "id",
      "description",
      "startTimeS",
      "stopTimeS",
      "numberOfIntervals",
      "solver",
      "targetTemperature",
    ],
    path,
  );
  literalValue(input.id, expectedId, `${path}.id`);
  const startTimeS = finite(input.startTimeS, `${path}.startTimeS`);
  const stopTimeS = finite(input.stopTimeS, `${path}.stopTimeS`);
  if (startTimeS < 0 || stopTimeS <= startTimeS) {
    throw new TypeError(`${path} has invalid time bounds.`);
  }
  return deepFreeze({
    id: expectedId,
    description: canonicalText(input.description, `${path}.description`),
    startTimeS,
    stopTimeS,
    numberOfIntervals: positiveInteger(
      input.numberOfIntervals,
      `${path}.numberOfIntervals`,
    ),
    solver: canonicalText(input.solver, `${path}.solver`),
    targetTemperature: normalizedQuantity(
      input.targetTemperature,
      `${path}.targetTemperature`,
    ),
  });
}

function normalizedParameters(
  value: unknown,
  path: string,
): readonly ModelicaResumableParameter[] {
  const ids: string[] = [];
  const names: string[] = [];
  const parameters = arrayOf(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const input = exactRecord(
      item,
      [
        "id",
        "modelicaName",
        "modelicaType",
        "description",
        "unit",
        "minimum",
        "maximum",
        "conversion",
      ],
      itemPath,
    );
    const id = canonicalText(input.id, `${itemPath}.id`);
    const modelicaName = modelicaIdentifier(
      input.modelicaName,
      `${itemPath}.modelicaName`,
    );
    const minimum = finite(input.minimum, `${itemPath}.minimum`);
    const maximum = finite(input.maximum, `${itemPath}.maximum`);
    if (minimum > maximum) {
      throw new TypeError(`${itemPath}.minimum must not exceed maximum.`);
    }
    const unit = canonicalText(input.unit, `${itemPath}.unit`);
    const conversionInput = exactRecord(
      input.conversion,
      ["from", "to", "factor", "offset"],
      `${itemPath}.conversion`,
    );
    const conversion = deepFreeze({
      from: canonicalText(conversionInput.from, `${itemPath}.conversion.from`),
      to: canonicalText(conversionInput.to, `${itemPath}.conversion.to`),
      factor: finite(conversionInput.factor, `${itemPath}.conversion.factor`),
      offset: finite(conversionInput.offset, `${itemPath}.conversion.offset`),
    });
    if (conversion.from !== unit) {
      throw new TypeError(`${itemPath}.conversion.from must equal unit.`);
    }
    ids.push(id);
    names.push(modelicaName);
    return deepFreeze({
      id,
      modelicaName,
      modelicaType: canonicalText(input.modelicaType, `${itemPath}.modelicaType`),
      description: canonicalText(input.description, `${itemPath}.description`),
      unit,
      minimum,
      maximum,
      conversion,
    });
  });
  rejectDuplicates(ids, `${path} ids`);
  rejectDuplicates(names, `${path} Modelica names`);
  return deepFreeze(parameters);
}

function normalizedMetrics(
  value: unknown,
  path: string,
): readonly ModelicaResumableProducedMetric[] {
  const values = arrayOf(value, path);
  if (values.length === 0) throw new TypeError(`${path} must not be empty.`);
  const ids: string[] = [];
  const metrics = values.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const input = exactRecord(
      item,
      ["id", "unit", "description", "required"],
      itemPath,
    );
    const id = canonicalText(input.id, `${itemPath}.id`);
    if (typeof input.required !== "boolean") {
      throw new TypeError(`${itemPath}.required must be boolean.`);
    }
    ids.push(id);
    return deepFreeze({
      id,
      unit: canonicalText(input.unit, `${itemPath}.unit`),
      description: canonicalText(input.description, `${itemPath}.description`),
      required: input.required,
    });
  });
  rejectDuplicates(ids, `${path} ids`);
  return deepFreeze(metrics);
}

function normalizedIdentity(
  value: unknown,
  path: string,
): ModelicaResumableIdentity {
  const input = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: canonicalText(input.id, `${path}.id`),
    version: canonicalText(input.version, `${path}.version`),
  });
}

function normalizedEngine(
  value: unknown,
  path: string,
): ModelicaResumableEngineIdentity {
  const input = exactRecord(value, ["name", "version", "mslVersion"], path);
  return deepFreeze({
    name: canonicalText(input.name, `${path}.name`),
    version: canonicalText(input.version, `${path}.version`),
    mslVersion: canonicalText(input.mslVersion, `${path}.mslVersion`),
  });
}

function normalizedQuantity(
  value: unknown,
  path: string,
): ModelicaResumableQuantity {
  const input = exactRecord(value, ["value", "unit"], path);
  return deepFreeze({
    value: finite(input.value, `${path}.value`),
    unit: canonicalText(input.unit, `${path}.unit`),
  });
}

function modelResourceUri(selection: ModelicaResumableManifestSelection): string {
  return `${kitResourcePrefix(selection)}model.mo`;
}

function scenarioResourceUri(selection: ModelicaResumableManifestSelection): string {
  return `${kitResourcePrefix(selection)}scenarios/${
    encodeURIComponent(selection.scenarioId)
  }.json`;
}

function parameterSchemaResourceUri(
  selection: ModelicaResumableManifestSelection,
): string {
  return `${kitResourcePrefix(selection)}parameter-schema.json`;
}

function kitResourcePrefix(selection: ModelicaResumableManifestSelection): string {
  return `casys://modelica/kits/${encodeURIComponent(selection.modelId)}/${
    encodeURIComponent(selection.modelVersion)
  }/`;
}

function modelicaIdentifier(value: unknown, path: string): string {
  const identifier = canonicalText(value, path);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new TypeError(`${path} must be a Modelica identifier.`);
  }
  return identifier;
}

function sha256Hex(value: unknown, path: string): string {
  const digest = canonicalText(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path} must be lowercase sha256 hex.`);
  }
  return digest;
}

function canonicalText(value: unknown, path: string): string {
  return nonEmptyText(value, path);
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

/** An explicit, idempotent request.  Never infer defaults in this port. */
export interface ModelicaResumableSubmission {
  readonly requestId: string;
  readonly manifest: ModelicaResumableManifest;
  readonly parameters: Readonly<Record<string, ModelicaResumableQuantity>>;
  readonly timeoutMs: number;
}

export type ModelicaResumableRequestStatus =
  | "pending"
  | "running"
  | "completed"
  | "rejected"
  | "recovery_required";

export interface ModelicaResumableArtifact extends ExpectedProviderResource {
  readonly role:
    | "request"
    | "resolved_parameters"
    | "model"
    | "scenario"
    | "parameter_schema"
    | "script"
    | "diagnostics"
    | "result"
    | "evidence";
  readonly fileName: string;
  readonly qualification?: ModelicaResumableResource["qualification"];
  readonly sourceResource?: ModelicaResumableResource;
}

export interface ModelicaResumableCompletedRun {
  readonly requestId: string;
  readonly requestSha256: string;
  readonly manifestSha256: string;
  readonly runId: string;
  readonly status: "succeeded" | "failed" | "timed_out";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resolvedParameters: Readonly<Record<string, ModelicaResumableQuantity>>;
  readonly metrics: Readonly<Record<string, ModelicaResumableQuantity>>;
  readonly warnings: readonly string[];
  readonly artifacts: readonly ModelicaResumableArtifact[];
  /** The sealed run ledger is evidence too; it must be acquired explicitly. */
  readonly runJson: ExpectedProviderResource;
}

export interface ModelicaResumableRequest {
  readonly requestId: string;
  readonly requestSha256: string;
  readonly manifestSha256: string;
  readonly status: ModelicaResumableRequestStatus;
  readonly completedRun?: ModelicaResumableCompletedRun;
}

/** Read a re-hashed qualified manifest for an exact model/scenario selection. */
export interface ModelicaResumableManifestReader {
  getManifest(
    selection: ModelicaResumableManifestSelection,
  ): Promise<ModelicaResumableManifest>;
}

/** Claim/submit one exact request.  A retry uses the same requestId and bytes. */
export interface ModelicaResumableSubmitter {
  submit(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest>;
}

/** Read one known request; it never discovers provider resources. */
export interface ModelicaResumableRequestReader {
  getRequest(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest>;
}

/** Exact bytes selected by the already-attested provider resource ledger. */
export interface ModelicaResumableCapturedResource {
  readonly role: string;
  readonly bytes: Uint8Array;
}

/**
 * One exact provider-ledger tuple and the already captured bytes it selects.
 * A CAS-only normalizer receives this closed set; it cannot discover or fetch
 * any provider resource while reconstructing the recorded evidence.
 */
export interface ModelicaResumableCapturedResourceTuple
  extends ModelicaResumableCapturedResource {
  readonly resource: ExpectedProviderResource;
}

/**
 * Post-acquisition semantic attestation. It proves internal consistency of the
 * exact provider resources; it is still an observation, never a requirement
 * verdict or an MRTR decision.
 */
export interface ModelicaResumableCapturedEvidence {
  readonly runId: string;
  readonly status: ModelicaResumableCompletedRun["status"];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resolvedParameters: Readonly<Record<string, ModelicaResumableQuantity>>;
  readonly metrics: Readonly<Record<string, ModelicaResumableQuantity>>;
  readonly warnings: readonly string[];
}

export interface ModelicaResumableEvidenceVerifier {
  verifyCapturedEvidence(
    submission: ModelicaResumableSubmission,
    completed: ModelicaResumableCompletedRun,
    resources: readonly ModelicaResumableCapturedResource[],
  ): Promise<ModelicaResumableCapturedEvidence>;
}

/**
 * Pure, CAS-only reconstruction boundary. Implementations must derive the
 * completed run from run.json and the exact supplied tuples/bytes. They have
 * no authority to read the provider or discover replacement resources.
 */
export interface ModelicaResumableCapturedEvidenceNormalizer {
  normalizeCapturedEvidence(
    submission: ModelicaResumableSubmission,
    resources: readonly ModelicaResumableCapturedResourceTuple[],
  ): Promise<ModelicaResumableCapturedEvidence>;
}

/**
 * Produces the exact acquisition tuples for a completed request only.  The
 * separate run.json tuple prevents a caller from treating its URI/hash as an
 * informal side channel outside the provider-resource ledger.
 */
export function expectedModelicaResumableResources(
  request: ModelicaResumableRequest,
): readonly (ExpectedProviderResource & { readonly role: string })[] {
  if (request.status !== "completed" || !request.completedRun) {
    throw new TypeError(
      "Only a completed Modelica resumable request has provider resources.",
    );
  }
  const resources = [
    ...request.completedRun.artifacts,
    { role: "run.json", ...request.completedRun.runJson },
  ];
  const roles = new Set<string>();
  const uris = new Set<string>();
  for (const resource of resources) {
    if (roles.has(resource.role) || uris.has(resource.uri)) {
      throw new TypeError(
        "Completed Modelica resumable resources must have unique roles and URIs.",
      );
    }
    roles.add(resource.role);
    uris.add(resource.uri);
  }
  return Object.freeze(resources.map((resource) =>
    Object.freeze({
      role: resource.role,
      uri: resource.uri,
      mediaType: resource.mediaType,
      byteCount: resource.byteCount,
      sha256: resource.sha256,
    })
  ));
}
