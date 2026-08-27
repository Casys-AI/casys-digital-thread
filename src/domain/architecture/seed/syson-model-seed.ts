import { safeId } from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringCommandActor,
  EngineeringThreadSnapshotRef,
} from "../../project/engineering-project.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../thread/thread-snapshot-validation.ts";

/** Canonical local capture of the first SysON project/document/root-package seed. */
export const SYSON_MODEL_SEED_CAPTURE_SCHEMA = "syson-model-seed-capture/2.0" as const;

/** Reviewed V3 operation authorized by the canonical in-project brief. */
export const SYSON_MODEL_SEED_OPERATION = {
  id: "architecture.seed-syson-model",
  version: "2",
} as const;

/**
 * Terminal failure recorded when a non-idempotent SysON seed write has a
 * durable dispatched marker but no durable normalized provider response.
 *
 * The exact run may be released only through the human uncertain-writer
 * reconciliation ceremony. Keeping the code beside the operation identity
 * prevents the executor and reconciliation policy from inventing aliases.
 */
export const SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE =
  "architecture-seed-syson-model-provider-outcome-unknown" as const;

const CAPTURE_KIND = "syson-model-seed" as const;
/** Capture and MRTR scope of the blank SysON container. Not a model name. */
export const SYSON_MODEL_SEED_SCOPE = "sysml-container-identity" as const;
const CAPTURE_SCOPE = SYSON_MODEL_SEED_SCOPE;
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

/** Provider-free identity of one exact, re-read r2 SysON model container. */
export interface ExactSysonModelSeed {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly normalizedResults: SysonModelSeedCapture["normalizedResults"];
}

/** The generic r2 gate must not inherit a product or architecture name. */
export class SysonModelSeedBasisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SysonModelSeedBasisError";
  }
}

/**
 * Closed planning and documentary lineage authorizing the first SysON write.
 *
 * The brief and plan are not technical inputs to SysON. They are retained as
 * exact authorization anchors so the provider result can be audited back to
 * the human-approved V3 brief and the additive project change that introduced
 * this operation.
 */
export interface SysonModelSeedLineage {
  readonly approvedBriefBasis: EngineeringApprovedBriefBasis;
  readonly plan: {
    readonly publishedAt: string;
    readonly publishedBy: EngineeringCommandActor;
  };
  readonly projectChange: {
    readonly id: string;
    readonly commandId: string;
    readonly publishedAt: string;
    readonly publishedBy: EngineeringCommandActor;
  };
  readonly workItemId: string;
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
  readonly documentaryArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
    readonly producerRunId: string;
  };
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
  readonly lineage: SysonModelSeedLineage;
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
  /** Exact V3 approval, plan-change and documentary-baseline authorization. */
  readonly lineage: SysonModelSeedLineage;
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
  const lineage = parseSysonModelSeedLineage(input.lineage, "$lineage");
  const base = requireSysonModelSeedDocumentaryBaseline(input.base, lineage);
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
    lineage,
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
  lineage: SysonModelSeedLineage,
): ThreadSnapshot {
  return documentaryBaseline(value, parseSysonModelSeedLineage(lineage, "$lineage"));
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
      "lineage",
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
  const lineage = parseSysonModelSeedLineage(root.lineage, "$capture.lineage");

  return {
    schemaVersion: SYSON_MODEL_SEED_CAPTURE_SCHEMA,
    kind: CAPTURE_KIND,
    scope: CAPTURE_SCOPE,
    statement: CAPTURE_STATEMENT,
    capturedAt,
    trustedRunId,
    operation: SYSON_MODEL_SEED_OPERATION,
    lineage,
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

/**
 * Verify the exact V3 r2 SysON seed independently of a later product recipe.
 *
 * Both SysML authoring executors and future downstream adapters use this
 * helper. It binds the seed capture to its content-addressed artifact and to
 * the exact approved-brief documentary r1 inherited by the snapshot.
 */
export async function requireExactSysonModelSeed(
  value: ThreadSnapshot,
  seedCaptureValue: unknown,
): Promise<ExactSysonModelSeed> {
  let base: ThreadSnapshot;
  try {
    base = validateThreadSnapshot(value);
  } catch (error) {
    throw new SysonModelSeedBasisError(
      `base must be a valid immutable ThreadSnapshot: ${errorMessage(error)}`,
    );
  }
  if (
    base.revision !== 2 || !base.previous || base.previous.revision !== 1 ||
    base.artifacts.length !== 2 || base.consumptions.length !== 0 ||
    base.observations.length !== 0 || base.requirements.length !== 0 ||
    base.evaluations.length !== 0 || base.violations.length !== 0 ||
    base.proposedActions.length !== 0
  ) {
    throw new SysonModelSeedBasisError(
      "The exact r2 SysON model-container snapshot is required.",
    );
  }
  const seedArtifact = base.artifacts.find((artifact) =>
    artifact.kind === "sysml-model"
  );
  if (
    !seedArtifact || seedArtifact.producer.serverId !== "syson" ||
    seedArtifact.producer.tool !== "syson_model_create" ||
    seedArtifact.inputArtifactIds.length !== 0
  ) {
    throw new SysonModelSeedBasisError(
      "The r2 basis must expose one unmodified SysON model-container artifact.",
    );
  }
  let capture: SysonModelSeedCapture;
  try {
    capture = parseSysonModelSeedCapture(seedCaptureValue);
  } catch (error) {
    throw new SysonModelSeedBasisError(
      `The r2 SysON model-seed capture is invalid: ${errorMessage(error)}`,
    );
  }
  if (
    !fingerprintsEqual(seedArtifact.fingerprint, await sha256Fingerprint(capture)) ||
    seedArtifact.producer.runId !== capture.trustedRunId ||
    seedArtifact.id !== `syson-model-seed-${seedArtifact.fingerprint.digest}`
  ) {
    throw new SysonModelSeedBasisError(
      "The r2 SysON model-seed capture does not exactly match its model-container artifact.",
    );
  }
  const documentary = base.artifacts.find((artifact) =>
    artifact.id === capture.lineage.documentaryArtifact.id &&
    artifact.kind === "document"
  );
  if (
    !base.previous ||
    capture.lineage.baseSnapshot.snapshotId !== base.previous.snapshotId ||
    capture.lineage.baseSnapshot.revision !== base.previous.revision ||
    capture.lineage.baseSnapshot.subjectId !== base.subject.id ||
    !documentary ||
    !fingerprintsEqual(
      documentary.fingerprint,
      capture.lineage.documentaryArtifact.fingerprint,
    ) ||
    documentary.producer.tool !== "baseline_from_approved_brief" ||
    documentary.producer.runId !== capture.lineage.documentaryArtifact.producerRunId
  ) {
    throw new SysonModelSeedBasisError(
      "The r2 seed capture does not preserve the exact approved-brief documentary lineage inherited by its ThreadSnapshot.",
    );
  }
  return {
    artifactId: seedArtifact.id,
    fingerprint: structuredClone(seedArtifact.fingerprint),
    normalizedResults: structuredClone(capture.normalizedResults),
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

function documentaryBaseline(
  value: ThreadSnapshot,
  lineage: SysonModelSeedLineage,
): ThreadSnapshot {
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
    document.producer.tool !== "baseline_from_approved_brief"
  ) {
    throw invalid(
      "invalid_baseline",
      "The first SysON model seed requires the approved-brief documentary artifact as the current subject model reference.",
    );
  }
  if (
    lineage.baseSnapshot.snapshotId !== base.id ||
    lineage.baseSnapshot.revision !== base.revision ||
    lineage.baseSnapshot.subjectId !== base.subject.id ||
    lineage.documentaryArtifact.id !== document.id ||
    lineage.documentaryArtifact.fingerprint.algorithm !==
      document.fingerprint.algorithm ||
    lineage.documentaryArtifact.fingerprint.digest !== document.fingerprint.digest ||
    lineage.documentaryArtifact.uri !== document.uri ||
    lineage.documentaryArtifact.producerRunId !== document.producer.runId
  ) {
    throw invalid(
      "invalid_baseline",
      "The SysON model-seed lineage must name the exact approved-brief documentary snapshot and artifact.",
    );
  }
  return structuredClone(base);
}

function parseSysonModelSeedLineage(
  value: unknown,
  path: string,
): SysonModelSeedLineage {
  const root = closedRecord(
    value,
    [
      "approvedBriefBasis",
      "plan",
      "projectChange",
      "workItemId",
      "baseSnapshot",
      "documentaryArtifact",
    ],
    path,
  );
  const basis = closedRecord(
    root.approvedBriefBasis,
    [
      "kind",
      "projectId",
      "projectSnapshotId",
      "projectRevision",
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "approvedBriefFingerprint",
    ],
    `${path}.approvedBriefBasis`,
  );
  literal(basis.kind, "approved-brief", `${path}.approvedBriefBasis.kind`);
  const plan = closedRecord(root.plan, ["publishedAt", "publishedBy"], `${path}.plan`);
  const projectChange = closedRecord(
    root.projectChange,
    ["id", "commandId", "publishedAt", "publishedBy"],
    `${path}.projectChange`,
  );
  const baseSnapshot = closedRecord(
    root.baseSnapshot,
    ["snapshotId", "revision", "subjectId"],
    `${path}.baseSnapshot`,
  );
  const documentaryArtifact = closedRecord(
    root.documentaryArtifact,
    ["id", "fingerprint", "uri", "producerRunId"],
    `${path}.documentaryArtifact`,
  );
  return {
    approvedBriefBasis: {
      kind: "approved-brief",
      projectId: stableIdentifier(
        basis.projectId,
        `${path}.approvedBriefBasis.projectId`,
      ),
      projectSnapshotId: stableIdentifier(
        basis.projectSnapshotId,
        `${path}.approvedBriefBasis.projectSnapshotId`,
      ),
      projectRevision: positiveInteger(
        basis.projectRevision,
        `${path}.approvedBriefBasis.projectRevision`,
      ),
      briefId: stableIdentifier(basis.briefId, `${path}.approvedBriefBasis.briefId`),
      briefSnapshotId: stableIdentifier(
        basis.briefSnapshotId,
        `${path}.approvedBriefBasis.briefSnapshotId`,
      ),
      briefRevision: positiveInteger(
        basis.briefRevision,
        `${path}.approvedBriefBasis.briefRevision`,
      ),
      approvedBriefFingerprint: parseFingerprint(
        basis.approvedBriefFingerprint,
        `${path}.approvedBriefBasis.approvedBriefFingerprint`,
      ),
    },
    plan: {
      publishedAt: canonicalUtcInstant(plan.publishedAt, `${path}.plan.publishedAt`),
      publishedBy: parseActor(plan.publishedBy, `${path}.plan.publishedBy`, "agent"),
    },
    projectChange: {
      id: stableIdentifier(projectChange.id, `${path}.projectChange.id`),
      commandId: stableIdentifier(
        projectChange.commandId,
        `${path}.projectChange.commandId`,
      ),
      publishedAt: canonicalUtcInstant(
        projectChange.publishedAt,
        `${path}.projectChange.publishedAt`,
      ),
      publishedBy: parseActor(
        projectChange.publishedBy,
        `${path}.projectChange.publishedBy`,
        "agent",
      ),
    },
    workItemId: stableIdentifier(root.workItemId, `${path}.workItemId`),
    baseSnapshot: {
      snapshotId: stableIdentifier(
        baseSnapshot.snapshotId,
        `${path}.baseSnapshot.snapshotId`,
      ),
      revision: positiveInteger(
        baseSnapshot.revision,
        `${path}.baseSnapshot.revision`,
      ),
      subjectId: stableIdentifier(
        baseSnapshot.subjectId,
        `${path}.baseSnapshot.subjectId`,
      ),
    },
    documentaryArtifact: {
      id: stableIdentifier(
        documentaryArtifact.id,
        `${path}.documentaryArtifact.id`,
      ),
      fingerprint: parseFingerprint(
        documentaryArtifact.fingerprint,
        `${path}.documentaryArtifact.fingerprint`,
      ),
      uri: nonEmptyString(
        documentaryArtifact.uri,
        `${path}.documentaryArtifact.uri`,
        "invalid_input",
      ),
      producerRunId: stableIdentifier(
        documentaryArtifact.producerRunId,
        `${path}.documentaryArtifact.producerRunId`,
      ),
    },
  };
}

function parseActor(
  value: unknown,
  path: string,
  expectedOrigin: EngineeringCommandActor["origin"],
): EngineeringCommandActor {
  const actor = closedRecord(value, ["id", "origin"], path);
  literal(actor.origin, expectedOrigin, `${path}.origin`);
  return {
    id: nonEmptyString(actor.id, `${path}.id`, "invalid_input"),
    origin: expectedOrigin,
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = closedRecord(value, ["algorithm", "digest"], path);
  literal(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw invalid(
      "invalid_input",
      `${path}.digest must be a lowercase SHA-256 digest.`,
    );
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw invalid("invalid_input", `${path} must be a positive integer.`);
  }
  return value as number;
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
  try {
    return safeId(value, path);
  } catch {
    throw invalid(
      "invalid_input",
      `${path} must be a stable non-empty identifier containing only letters, digits, dot, underscore, colon, or hyphen.`,
    );
  }
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
