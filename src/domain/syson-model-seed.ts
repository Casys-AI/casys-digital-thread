import { deterministicJson, sha256Fingerprint } from "./deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "./thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "./thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

/** Canonical local capture of the first SysON project/document/root-package seed. */
export const SYSON_MODEL_SEED_CAPTURE_SCHEMA = "syson-model-seed-capture/1.0" as const;

/** The reviewed operation that owns this narrowly bounded technical step. */
export const SYSON_MODEL_SEED_OPERATION = {
  id: "architecture.seed-syson-model",
  version: "1",
} as const;

const CAPTURE_KIND = "syson-model-seed" as const;
const CAPTURE_SCOPE = "sysml-container-identity" as const;
const CAPTURE_STATEMENT =
  "Immutable normalized identity record of a newly created SysON project, SysML document, and root package. It does not capture model semantics, requirements, CAD, simulation, measurements, or verification verdicts.";

export interface SysonModelSeedProjectResult {
  readonly id: string;
  readonly name: string;
  readonly editingContextId: string;
}

export interface SysonModelSeedDocumentResult {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export interface SysonModelSeedRootPackageResult {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

/**
 * The only provider values that become durable evidence. The executor receives
 * raw tool outputs, but this closed structure deliberately excludes transport
 * metadata, credentials, arbitrary tool arguments, and provider-only noise.
 */
export interface SysonModelSeedNormalizedResults {
  readonly project: SysonModelSeedProjectResult;
  readonly document: SysonModelSeedDocumentResult;
  readonly rootPackage: SysonModelSeedRootPackageResult;
}

export interface SysonModelSeedCapture {
  readonly schemaVersion: typeof SYSON_MODEL_SEED_CAPTURE_SCHEMA;
  readonly kind: typeof CAPTURE_KIND;
  readonly scope: typeof CAPTURE_SCOPE;
  readonly statement: typeof CAPTURE_STATEMENT;
  readonly capturedAt: string;
  /** The trusted engineering agent run, never a provider-generated run id. */
  readonly trustedRunId: string;
  readonly operation: {
    readonly id: typeof SYSON_MODEL_SEED_OPERATION.id;
    readonly version: typeof SYSON_MODEL_SEED_OPERATION.version;
  };
  readonly provider: {
    readonly serverId: "syson";
    readonly tools: {
      readonly projectCreate: "syson_project_create";
      readonly modelCreate: "syson_model_create";
      readonly rootPackageGet: "syson_element_get";
    };
  };
  /**
   * The exact, normalized projection of the three trusted SysON results.
   * `rootPackage` is read back after creation, so its kind and label are not
   * inferred from the model-create response.
   */
  readonly normalizedResults: SysonModelSeedNormalizedResults;
}

export interface MaterializeSysonModelSeedInput {
  /** Exact documentary r1 against which this first technical result is applied. */
  readonly base: ThreadSnapshot;
  readonly trustedRunId: string;
  readonly capturedAt: string;
  /** Result of the trusted fixed `syson_project_create` call. */
  readonly projectCreateResult: unknown;
  /** Result of the trusted fixed `syson_model_create` call. */
  readonly modelCreateResult: unknown;
  /** Read-back result of `syson_element_get` for the created root package. */
  readonly rootPackageGetResult: unknown;
  /** Logical content-addressed URI allocated by the persistence adapter. */
  readonly captureUri?: string;
}

export interface SysonModelSeedMaterialization {
  readonly capture: SysonModelSeedCapture;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly sha256: ContentFingerprint;
  readonly extension: ThreadSnapshotExtension;
  /** Deterministic revision 2 descendant of the supplied documentary root. */
  readonly snapshot: ThreadSnapshot;
}

export type SysonModelSeedMaterializationErrorCode =
  | "invalid_input"
  | "invalid_baseline"
  | "invalid_provider_result"
  | "inconsistent_provider_result";

export class SysonModelSeedMaterializationError extends Error {
  constructor(
    readonly code: SysonModelSeedMaterializationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SysonModelSeedMaterializationError";
  }
}

/**
 * Materialize, but do not persist or call a provider for, the first SysON
 * model-container result. The input is intentionally only a documentary r1
 * plus the fixed, normalized outputs a future trusted executor obtained.
 */
export async function materializeSysonModelSeed(
  input: MaterializeSysonModelSeedInput,
): Promise<SysonModelSeedMaterialization> {
  const base = requireSysonModelSeedDocumentaryBaseline(input.base);
  const trustedRunId = stableIdentifier(input.trustedRunId, "trustedRunId");
  const capturedAt = canonicalUtcInstant(input.capturedAt, "capturedAt");
  const captureUri = optionalCaptureUri(input.captureUri);
  const normalizedResults = normalizeResults(
    input.projectCreateResult,
    input.modelCreateResult,
    input.rootPackageGetResult,
  );

  const capture: SysonModelSeedCapture = {
    schemaVersion: SYSON_MODEL_SEED_CAPTURE_SCHEMA,
    kind: CAPTURE_KIND,
    scope: CAPTURE_SCOPE,
    statement: CAPTURE_STATEMENT,
    capturedAt,
    trustedRunId,
    operation: SYSON_MODEL_SEED_OPERATION,
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults,
  };
  const text = deterministicJson(capture);
  const bytes = new TextEncoder().encode(text);
  const sha256 = await sha256Fingerprint(capture);
  const extension = extensionFor(
    base.subject.id,
    capture,
    sha256,
    captureUri,
  );
  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capturedAt,
  });
  if (!applied.applied || applied.snapshot.revision !== 2) {
    throw invalid(
      "invalid_baseline",
      "The SysON model seed must create exactly revision 2 from a documentary revision 1 root.",
    );
  }

  return {
    capture: structuredClone(capture),
    text,
    bytes: bytes.slice(),
    sha256: structuredClone(sha256),
    extension: structuredClone(extension),
    snapshot: structuredClone(applied.snapshot),
  };
}

/**
 * Validate the sole admissible input to the first SysON provider operation.
 *
 * The trusted executor calls this before it dispatches any non-idempotent
 * SysON write. Keeping the gate here, next to materialization, means the
 * provider boundary and the evidence boundary share exactly one definition of
 * an admissible documentary root.
 */
export function requireSysonModelSeedDocumentaryBaseline(
  value: ThreadSnapshot,
): ThreadSnapshot {
  return documentaryBaseline(value);
}

/**
 * Parse an externally re-read capture fail-closed. This is intended for a
 * later completion-evidence validator; it also documents the exact durable
 * capture shape independently from the provider wire format.
 */
export function parseSysonModelSeedCapture(value: unknown): SysonModelSeedCapture {
  const root = closedRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "scope",
      "statement",
      "capturedAt",
      "trustedRunId",
      "operation",
      "provider",
      "normalizedResults",
    ],
    "$capture",
  );
  literal(
    root.schemaVersion,
    SYSON_MODEL_SEED_CAPTURE_SCHEMA,
    "$capture.schemaVersion",
  );
  literal(root.kind, CAPTURE_KIND, "$capture.kind");
  literal(root.scope, CAPTURE_SCOPE, "$capture.scope");
  literal(root.statement, CAPTURE_STATEMENT, "$capture.statement");
  const capturedAt = canonicalUtcInstant(root.capturedAt, "$capture.capturedAt");
  const trustedRunId = stableIdentifier(root.trustedRunId, "$capture.trustedRunId");
  const operation = closedRecord(
    root.operation,
    ["id", "version"],
    "$capture.operation",
  );
  literal(operation.id, SYSON_MODEL_SEED_OPERATION.id, "$capture.operation.id");
  literal(
    operation.version,
    SYSON_MODEL_SEED_OPERATION.version,
    "$capture.operation.version",
  );
  const provider = closedRecord(
    root.provider,
    ["serverId", "tools"],
    "$capture.provider",
  );
  literal(provider.serverId, "syson", "$capture.provider.serverId");
  const tools = closedRecord(
    provider.tools,
    ["projectCreate", "modelCreate", "rootPackageGet"],
    "$capture.provider.tools",
  );
  literal(
    tools.projectCreate,
    "syson_project_create",
    "$capture.provider.tools.projectCreate",
  );
  literal(
    tools.modelCreate,
    "syson_model_create",
    "$capture.provider.tools.modelCreate",
  );
  literal(
    tools.rootPackageGet,
    "syson_element_get",
    "$capture.provider.tools.rootPackageGet",
  );
  const normalizedResults = parseNormalizedResults(
    root.normalizedResults,
    "$capture.normalizedResults",
  );

  return {
    schemaVersion: SYSON_MODEL_SEED_CAPTURE_SCHEMA,
    kind: CAPTURE_KIND,
    scope: CAPTURE_SCOPE,
    statement: CAPTURE_STATEMENT,
    capturedAt,
    trustedRunId,
    operation: SYSON_MODEL_SEED_OPERATION,
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults,
  };
}

function extensionFor(
  subjectId: string,
  capture: SysonModelSeedCapture,
  fingerprint: ContentFingerprint,
  captureUri: string | undefined,
): ThreadSnapshotExtension {
  const artifactId = `syson-model-seed-${fingerprint.digest}`;
  const operation: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_model_create",
    runId: capture.trustedRunId,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `SysON SysML model container: ${capture.normalizedResults.document.name}`,
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint: structuredClone(fingerprint),
    ...(captureUri === undefined ? {} : { uri: captureUri }),
    mediaType: "application/json",
    producer: operation,
    // The documentary r1 authorizes this run through its project receipt and
    // exact run basis; it was not a byte-level input to SysON.
    inputArtifactIds: [],
    freshness,
  };

  return {
    id: `capture-syson-model-seed-${fingerprint.digest}`,
    name: "Capture the first SysON SysML model container",
    subjectId,
    capturedAt: capture.capturedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
    bindingProofs: [{
      provider: "syson",
      kind: "project",
      id: capture.normalizedResults.project.id,
    }],
  };
}

function documentaryBaseline(value: ThreadSnapshot): ThreadSnapshot {
  let base: ThreadSnapshot;
  try {
    base = validateThreadSnapshot(value);
  } catch (error) {
    throw invalid(
      "invalid_baseline",
      `base must be a valid immutable ThreadSnapshot: ${errorMessage(error)}`,
    );
  }
  if (base.revision !== 1 || base.previous !== undefined) {
    throw invalid(
      "invalid_baseline",
      "The first SysON model seed requires the exact documentary ThreadSnapshot revision 1 root.",
    );
  }
  if (
    base.artifacts.length !== 1 ||
    base.consumptions.length !== 0 ||
    base.observations.length !== 0 ||
    base.requirements.length !== 0 ||
    base.evaluations.length !== 0 ||
    base.violations.length !== 0 ||
    base.proposedActions.length !== 0
  ) {
    throw invalid(
      "invalid_baseline",
      "The first SysON model seed requires a documentary-only ThreadSnapshot revision 1 root.",
    );
  }
  const document = base.artifacts[0]!;
  if (
    document.id !== base.subject.modelArtifactId ||
    document.kind !== "document" ||
    document.inputArtifactIds.length !== 0 ||
    document.producer.serverId !== "casys-digital-thread" ||
    document.producer.tool !== "baseline_from_approved_discovery"
  ) {
    throw invalid(
      "invalid_baseline",
      "The first SysON model seed requires the approved-discovery documentary artifact as the current subject model reference.",
    );
  }
  return structuredClone(base);
}

function normalizeResults(
  projectCreateResult: unknown,
  modelCreateResult: unknown,
  rootPackageGetResult: unknown,
): SysonModelSeedNormalizedResults {
  const project = normalizeProjectCreateResult(projectCreateResult);
  const model = normalizeModelCreateResult(modelCreateResult);
  const rootPackage = normalizeRootPackageGetResult(rootPackageGetResult);
  if (model.rootPackageId !== rootPackage.id) {
    throw invalid(
      "inconsistent_provider_result",
      "syson_model_create.rootPackageId must exactly match syson_element_get.id.",
    );
  }
  if (model.rootPackageLabel !== rootPackage.label) {
    throw invalid(
      "inconsistent_provider_result",
      "syson_model_create.rootPackageLabel must exactly match syson_element_get.label.",
    );
  }
  return {
    project,
    document: {
      id: model.documentId,
      name: model.documentName,
      kind: model.documentKind,
    },
    rootPackage,
  };
}

function normalizeProjectCreateResult(value: unknown): SysonModelSeedProjectResult {
  const root = record(value, "$projectCreateResult", "invalid_provider_result");
  return {
    id: nonEmptyString(root.id, "$projectCreateResult.id", "invalid_provider_result"),
    name: nonEmptyString(
      root.name,
      "$projectCreateResult.name",
      "invalid_provider_result",
    ),
    editingContextId: nonEmptyString(
      root.editingContextId,
      "$projectCreateResult.editingContextId",
      "invalid_provider_result",
    ),
  };
}

function normalizeModelCreateResult(value: unknown): {
  readonly documentId: string;
  readonly documentName: string;
  readonly documentKind: string;
  readonly rootPackageId: string;
  readonly rootPackageLabel: string;
} {
  const root = record(value, "$modelCreateResult", "invalid_provider_result");
  return {
    documentId: nonEmptyString(
      root.documentId,
      "$modelCreateResult.documentId",
      "invalid_provider_result",
    ),
    documentName: nonEmptyString(
      root.documentName,
      "$modelCreateResult.documentName",
      "invalid_provider_result",
    ),
    documentKind: nonEmptyString(
      root.documentKind,
      "$modelCreateResult.documentKind",
      "invalid_provider_result",
    ),
    rootPackageId: nonEmptyString(
      root.rootPackageId,
      "$modelCreateResult.rootPackageId",
      "invalid_provider_result",
    ),
    rootPackageLabel: nonEmptyString(
      root.rootPackageLabel,
      "$modelCreateResult.rootPackageLabel",
      "invalid_provider_result",
    ),
  };
}

function normalizeRootPackageGetResult(
  value: unknown,
): SysonModelSeedRootPackageResult {
  const root = record(value, "$rootPackageGetResult", "invalid_provider_result");
  return {
    id: nonEmptyString(
      root.id,
      "$rootPackageGetResult.id",
      "invalid_provider_result",
    ),
    kind: nonEmptyString(
      root.kind,
      "$rootPackageGetResult.kind",
      "invalid_provider_result",
    ),
    label: nonEmptyString(
      root.label,
      "$rootPackageGetResult.label",
      "invalid_provider_result",
    ),
  };
}

function parseNormalizedResults(
  value: unknown,
  path: string,
): SysonModelSeedNormalizedResults {
  const root = closedRecord(value, ["project", "document", "rootPackage"], path);
  const project = closedRecord(
    root.project,
    ["id", "name", "editingContextId"],
    `${path}.project`,
  );
  const document = closedRecord(
    root.document,
    ["id", "name", "kind"],
    `${path}.document`,
  );
  const rootPackage = closedRecord(
    root.rootPackage,
    ["id", "kind", "label"],
    `${path}.rootPackage`,
  );
  return {
    project: {
      id: nonEmptyString(project.id, `${path}.project.id`, "invalid_input"),
      name: nonEmptyString(project.name, `${path}.project.name`, "invalid_input"),
      editingContextId: nonEmptyString(
        project.editingContextId,
        `${path}.project.editingContextId`,
        "invalid_input",
      ),
    },
    document: {
      id: nonEmptyString(document.id, `${path}.document.id`, "invalid_input"),
      name: nonEmptyString(document.name, `${path}.document.name`, "invalid_input"),
      kind: nonEmptyString(document.kind, `${path}.document.kind`, "invalid_input"),
    },
    rootPackage: {
      id: nonEmptyString(rootPackage.id, `${path}.rootPackage.id`, "invalid_input"),
      kind: nonEmptyString(
        rootPackage.kind,
        `${path}.rootPackage.kind`,
        "invalid_input",
      ),
      label: nonEmptyString(
        rootPackage.label,
        `${path}.rootPackage.label`,
        "invalid_input",
      ),
    },
  };
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const root = record(value, path, "invalid_input");
  const actual = Object.keys(root).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalid(
      "invalid_input",
      `${path} must contain exactly: ${expected.join(", ")}.`,
    );
  }
  return root;
}

function record(
  value: unknown,
  path: string,
  code: SysonModelSeedMaterializationErrorCode,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(code, `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(
  value: unknown,
  path: string,
  code: SysonModelSeedMaterializationErrorCode,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(code, `${path} must be a non-empty string.`);
  }
  return value;
}

function stableIdentifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    throw invalid(
      "invalid_input",
      `${path} must be a stable non-empty identifier containing only letters, digits, dot, underscore, colon, or hyphen.`,
    );
  }
  return value;
}

function canonicalUtcInstant(value: unknown, path: string): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  const normalized = Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  const expectedNormalized = typeof value === "string"
    ? value.includes(".") ? value : value.replace("Z", ".000Z")
    : undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    normalized !== expectedNormalized
  ) {
    throw invalid(
      "invalid_input",
      `${path} must be a canonical UTC ISO-8601 instant ending in Z.`,
    );
  }
  return value;
}

function optionalCaptureUri(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, "captureUri", "invalid_input");
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw invalid("invalid_input", `${path} must equal ${String(expected)}.`);
  }
}

function invalid(
  code: SysonModelSeedMaterializationErrorCode,
  message: string,
): SysonModelSeedMaterializationError {
  return new SysonModelSeedMaterializationError(code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
