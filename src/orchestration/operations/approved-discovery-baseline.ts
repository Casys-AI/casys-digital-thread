import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectDiscoveryHandoff,
  EngineeringProjectIdentity,
  EngineeringProjectPlan,
  EngineeringProjectSnapshot,
  EngineeringWorkItemKind,
  EngineeringWorkOwner,
} from "../../domain/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/engineering-project-validation.ts";
import type { ProjectDiscoverySnapshot } from "../../domain/project-discovery.ts";
import { validateProjectDiscoverySnapshot } from "../../domain/project-discovery-validation.ts";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { validateRegisteredEngineeringOperationInput } from "./registry.ts";

/** The stable, canonical JSON payload recorded by the first intake operation. */
export const APPROVED_DISCOVERY_BASELINE_CAPTURE_SCHEMA =
  "approved-discovery-baseline-capture/1.0" as const;

/** The only registered operation this primitive can materialize. */
export const APPROVED_DISCOVERY_BASELINE_OPERATION = {
  id: "baseline.from-approved-discovery",
  version: "1",
} as const;

/**
 * Inputs deliberately contain complete immutable project and discovery snapshots.
 * The primitive never resolves `latest`, reads a store, or calls a provider.
 */
export interface MaterializeApprovedDiscoveryBaselineInput {
  readonly project: EngineeringProjectSnapshot;
  readonly discovery: ProjectDiscoverySnapshot;
  readonly runId: string;
  /** Canonical UTC instant supplied by the trusted executor. */
  readonly capturedAt: string;
  /**
   * Optional immutable storage location supplied by the caller after it has
   * allocated a content-addressed target. It is deliberately not hash input.
   */
  readonly captureUri?: string;
}

/**
 * The stable planning definition relevant to this operation. Runtime state such
 * as agent-run transitions, receipts, blockers, and evidence links is excluded
 * so the documentary content remains stable while the executor advances a run.
 */
export interface ApprovedDiscoveryBaselineProjectDefinition {
  readonly identity: EngineeringProjectIdentity;
  readonly discoveryHandoff: EngineeringProjectDiscoveryHandoff;
  readonly plan: EngineeringProjectPlan;
  readonly workItem: {
    readonly id: string;
    readonly phaseId: string;
    readonly title: string;
    readonly description: string;
    readonly kind: EngineeringWorkItemKind;
    readonly owner: EngineeringWorkOwner;
    readonly dependsOnWorkItemIds: readonly string[];
    readonly operation: EngineeringOperationRef;
  };
}

/**
 * The bytes behind the document artefact. This is a documentary planning capture,
 * not a claim that a model, CAD design, calculation, or test has been produced.
 */
export interface ApprovedDiscoveryBaselineCapture {
  readonly schemaVersion: typeof APPROVED_DISCOVERY_BASELINE_CAPTURE_SCHEMA;
  readonly kind: "approved-discovery-documentary-baseline";
  readonly scope: "pre-technical-documentation";
  readonly statement: string;
  readonly runId: string;
  readonly capturedAt: string;
  readonly operation: {
    readonly id: typeof APPROVED_DISCOVERY_BASELINE_OPERATION.id;
    readonly version: typeof APPROVED_DISCOVERY_BASELINE_OPERATION.version;
  };
  readonly workItemId: string;
  readonly projectDefinition: ApprovedDiscoveryBaselineProjectDefinition;
  readonly discoverySnapshot: ProjectDiscoverySnapshot;
}

/**
 * Pure materialization result. Persistence, provider execution, and project state
 * transitions belong to a caller outside this module.
 */
export interface ApprovedDiscoveryBaselineMaterialization {
  readonly capture: ApprovedDiscoveryBaselineCapture;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly sha256: ContentFingerprint;
  readonly snapshot: ThreadSnapshot;
}

export type ApprovedDiscoveryBaselineMaterializationErrorCode =
  | "invalid_input"
  | "invalid_handoff"
  | "invalid_plan"
  | "invalid_discovery"
  | "baseline_already_exists";

export class ApprovedDiscoveryBaselineMaterializationError extends Error {
  constructor(
    readonly code: ApprovedDiscoveryBaselineMaterializationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApprovedDiscoveryBaselineMaterializationError";
  }
}

/**
 * Materialize the r1 documentary baseline from one exact human-approved discovery.
 *
 * This is intentionally a pure function: it neither performs I/O nor interprets
 * the discovery as technical evidence. A future trusted executor may persist the
 * returned bytes and attach the returned ThreadSnapshot atomically.
 */
export async function materializeApprovedDiscoveryBaseline(
  input: MaterializeApprovedDiscoveryBaselineInput,
): Promise<ApprovedDiscoveryBaselineMaterialization> {
  const project = validatedProject(input.project);
  const discovery = validatedDiscovery(input.discovery);
  const runId = requiredIdentifier(input.runId, "runId");
  const capturedAt = canonicalUtcInstant(input.capturedAt, "capturedAt");
  const captureUri = optionalCaptureUri(input.captureUri);

  const workItem = verifyExactApprovedDiscoveryPlan(project, discovery);

  const capture: ApprovedDiscoveryBaselineCapture = {
    schemaVersion: APPROVED_DISCOVERY_BASELINE_CAPTURE_SCHEMA,
    kind: "approved-discovery-documentary-baseline",
    scope: "pre-technical-documentation",
    statement:
      "Immutable documentary capture of the exact human-approved discovery and its reviewed plan. It is not provider evidence, a technical model, a calculation, or a verification verdict.",
    runId,
    capturedAt,
    operation: APPROVED_DISCOVERY_BASELINE_OPERATION,
    workItemId: workItem.id,
    projectDefinition: projectDefinitionFor(project, workItem),
    discoverySnapshot: structuredClone(discovery),
  };
  const text = deterministicJson(capture);
  const bytes = new TextEncoder().encode(text);
  const sha256 = await sha256Fingerprint(capture);
  const snapshot = documentaryThreadSnapshot({
    project,
    runId,
    capturedAt,
    sha256,
    captureUri,
  });

  return {
    capture: structuredClone(capture),
    text,
    bytes: bytes.slice(),
    sha256: structuredClone(sha256),
    snapshot: structuredClone(snapshot),
  };
}

function validatedProject(
  value: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  try {
    return validateEngineeringProjectSnapshot(value);
  } catch (error) {
    throw invalid(
      "invalid_input",
      `project must be a valid immutable EngineeringProjectSnapshot: ${
        errorMessage(error)
      }`,
    );
  }
}

function validatedDiscovery(value: ProjectDiscoverySnapshot): ProjectDiscoverySnapshot {
  try {
    return validateProjectDiscoverySnapshot(value);
  } catch (error) {
    throw invalid(
      "invalid_input",
      `discovery must be a valid immutable ProjectDiscoverySnapshot: ${
        errorMessage(error)
      }`,
    );
  }
}

function verifyExactApprovedDiscoveryPlan(
  project: EngineeringProjectSnapshot,
  discovery: ProjectDiscoverySnapshot,
): ApprovedDiscoveryBaselineProjectDefinition["workItem"] {
  if (project.threadSnapshots.length > 0) {
    throw invalid(
      "baseline_already_exists",
      "An approved-discovery documentary baseline is only valid as the initial r1 thread snapshot.",
    );
  }

  const handoff = project.discoveryHandoff;
  if (handoff === undefined) {
    throw invalid(
      "invalid_handoff",
      "The project does not carry an approved discovery handoff.",
    );
  }
  const plan = project.plan;
  if (plan === undefined || plan.startingPoint !== "idea-or-spec") {
    throw invalid(
      "invalid_plan",
      "The project must carry the reviewed idea-or-spec plan before its first baseline can be materialized.",
    );
  }
  if (
    plan.basis.kind !== "approved-discovery" ||
    plan.basis.discoveryId !== handoff.discoveryId ||
    plan.basis.snapshotId !== handoff.snapshotId ||
    plan.basis.revision !== handoff.revision ||
    plan.basis.briefId !== handoff.briefId ||
    !fingerprintsEqual(
      plan.basis.approvedBriefFingerprint,
      handoff.approvedBriefFingerprint,
    )
  ) {
    throw invalid(
      "invalid_plan",
      "The plan basis must exactly match the immutable approved discovery handoff.",
    );
  }

  if (
    discovery.discoveryId !== handoff.discoveryId ||
    discovery.id !== handoff.snapshotId ||
    discovery.revision !== handoff.revision
  ) {
    throw invalid(
      "invalid_handoff",
      "The supplied discovery must be the exact revision accepted by the project handoff.",
    );
  }
  if (
    discovery.status !== "approved" ||
    discovery.brief === undefined ||
    discovery.review === undefined ||
    discovery.review.status !== "approved" ||
    discovery.brief.id !== handoff.briefId ||
    discovery.review.briefId !== handoff.briefId ||
    discovery.review.decidedAt !== handoff.approvedAt ||
    discovery.review.decidedBy?.origin !== "human" ||
    discovery.review.decidedBy?.id !== handoff.approvedBy.id ||
    handoff.approvedBy.origin !== "human" ||
    !fingerprintsEqual(
      discovery.review.inputFingerprint,
      handoff.approvedBriefFingerprint,
    )
  ) {
    throw invalid(
      "invalid_discovery",
      "The supplied discovery is not the exact human-approved brief recorded by the project handoff.",
    );
  }

  const candidates = project.workItems.filter((item) =>
    item.operation?.id === APPROVED_DISCOVERY_BASELINE_OPERATION.id &&
    item.operation.version === APPROVED_DISCOVERY_BASELINE_OPERATION.version
  );
  if (candidates.length !== 1 || candidates[0].operation === undefined) {
    throw invalid(
      "invalid_plan",
      "The reviewed plan must contain exactly one approved-discovery baseline operation.",
    );
  }
  const workItem = candidates[0];
  try {
    const registered = validateRegisteredEngineeringOperationInput({
      operation: workItem.operation,
      basisKind: "approved-discovery",
    });
    if (
      registered.operation.id !== APPROVED_DISCOVERY_BASELINE_OPERATION.id ||
      registered.operation.version !== APPROVED_DISCOVERY_BASELINE_OPERATION.version
    ) {
      throw new Error("unexpected registered operation");
    }
  } catch (error) {
    throw invalid(
      "invalid_plan",
      `The baseline work item does not satisfy the reviewed operation contract: ${
        errorMessage(error)
      }`,
    );
  }

  return {
    id: workItem.id,
    phaseId: workItem.phaseId,
    title: workItem.title,
    description: workItem.description,
    kind: workItem.kind,
    owner: workItem.owner,
    dependsOnWorkItemIds: structuredClone(workItem.dependsOnWorkItemIds),
    operation: structuredClone(workItem.operation!),
  };
}

function projectDefinitionFor(
  project: EngineeringProjectSnapshot,
  workItem: ApprovedDiscoveryBaselineProjectDefinition["workItem"],
): ApprovedDiscoveryBaselineProjectDefinition {
  return {
    identity: structuredClone(project.project),
    discoveryHandoff: structuredClone(project.discoveryHandoff!),
    plan: structuredClone(project.plan!),
    workItem: structuredClone(workItem),
  };
}

function documentaryThreadSnapshot(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly runId: string;
  readonly capturedAt: string;
  readonly sha256: ContentFingerprint;
  readonly captureUri: string | undefined;
}): ThreadSnapshot {
  const artifactId = `approved-discovery-document-${input.sha256.digest}`;
  const changeSetId = `approved-discovery-baseline-${input.sha256.digest}`;
  const changeId = `${changeSetId}:record-document`;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${input.project.project.subjectId}:r1:${changeSetId}`,
    revision: 1,
    generatedAt: input.capturedAt,
    subject: {
      id: input.project.project.subjectId,
      name: input.project.project.name,
      kind: "system",
      version: input.sha256.digest,
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: input.capturedAt,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: changeSetId,
      name: "Record approved discovery documentary baseline",
      status: "applied",
      createdAt: input.capturedAt,
      appliedAt: input.capturedAt,
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary:
          "Recorded the approved discovery as a documentary, pre-technical baseline; no provider evidence, model, measurement, or technical verdict was created.",
        afterFingerprint: input.sha256,
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Approved discovery documentary baseline (pre-technical)",
      kind: "document",
      version: input.sha256.digest,
      fingerprint: input.sha256,
      ...(input.captureUri === undefined ? {} : { uri: input.captureUri }),
      mediaType: "application/json",
      producer: {
        serverId: "casys-digital-thread",
        tool: "baseline_from_approved_discovery",
        runId: input.runId,
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: input.capturedAt,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `${changeSetId}:changes:${artifactId}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale:
        "This immutable capture records only the exact human-approved discovery and its reviewed planning provenance; it is not provider evidence or a technical evaluation.",
    }],
    proposedActions: [],
  });
  return snapshot;
}

function requiredIdentifier(value: string, path: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    throw invalid(
      "invalid_input",
      `${path} must be a non-empty stable identifier containing only letters, digits, dot, underscore, colon, or hyphen.`,
    );
  }
  return value;
}

function canonicalUtcInstant(value: string, path: string): string {
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

function optionalCaptureUri(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(
      "invalid_input",
      "captureUri must be a non-empty URI or immutable storage reference when supplied.",
    );
  }
  return value;
}

function invalid(
  code: ApprovedDiscoveryBaselineMaterializationErrorCode,
  message: string,
): ApprovedDiscoveryBaselineMaterializationError {
  return new ApprovedDiscoveryBaselineMaterializationError(code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
