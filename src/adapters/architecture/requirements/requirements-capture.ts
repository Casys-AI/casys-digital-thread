/** Exact shared parser for generic requirements captures. */

import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  ORACLE_REQUIREMENT_OPERATORS,
  type OracleRequirement,
  SUPPORTED_ORACLE_UNITS,
} from "../../../domain/kernel/proof-case.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  type RequirementsTarget,
} from "../../../domain/architecture/requirements/requirements-proposal.ts";
import {
  MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL,
  REQUIREMENTS_RECAPTURE_CAPTURE_SCHEMA,
  REQUIREMENTS_WRITE_PRODUCER_TOOL,
} from "../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import { MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION } from "../../../domain/architecture/requirements/requirements-traced-proposal.ts";
import {
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL,
  REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA,
} from "../../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import {
  parseRequirementsBriefProvenance,
  type RequirementsBriefProvenance,
} from "../../../domain/architecture/requirements/requirements-brief-provenance.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { normaliseThreshold } from "../../../domain/kernel/unit-normalisation.ts";

/** Current writer capture: every native RequirementUsage/ConstraintUsage identity is sealed. */
export const REQUIREMENTS_CAPTURE_SCHEMA = "requirements-capture/3.0" as const;

export const REQUIREMENTS_RECAPTURE_SCHEMA = REQUIREMENTS_RECAPTURE_CAPTURE_SCHEMA;

export const REQUIREMENTS_TRACED_CAPTURE_SCHEMA = "requirements-capture/5.0" as const;
export const REQUIREMENTS_TRACED_RECAPTURE_SCHEMA =
  REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA;
export const REQUIREMENTS_TRACED_WRITE_PRODUCER_TOOL =
  "model.write-requirements@2" as const;

export interface RequirementsCaptureArtifactReference {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface RequirementsCaptureArchitectureBasis {
  readonly snapshotId: string;
  readonly revision: number;
  readonly fingerprint: string;
}

export interface RequirementsCaptureConstraintUsage {
  /** Reviewed canonical requirement joined by its exact metric expression. */
  readonly requirementId: string;
  /** Native SysON ConstraintUsage UUID returned by the extractor. */
  readonly id: string;
  readonly kind: "ConstraintUsage";
  /** Exact provider source identity; current SysON requires it to equal `id`. */
  readonly sourceId: string;
}

export interface RequirementsCaptureRequirementUsage {
  readonly id: string;
  readonly kind: "RequirementUsage";
}

export interface RequirementsCaptureSubjectUsage {
  readonly id: string;
  readonly kind: "ReferenceUsage";
  readonly name: "target";
}

interface RequirementsCaptureCommon {
  readonly trustedRunId: string;
  readonly containerComponent: string;
  readonly partDefName: string;
  readonly target: RequirementsTarget;
  readonly architectureBasis: RequirementsCaptureArchitectureBasis;
  readonly requirements: readonly OracleRequirement[];
  readonly seed: RequirementsCaptureArtifactReference;
  readonly architecture: RequirementsCaptureArtifactReference;
  readonly requirementsElementId: string;
  readonly requirementUsage: RequirementsCaptureRequirementUsage;
  readonly constraintUsages: readonly RequirementsCaptureConstraintUsage[];
}

/**
 * Canonical semantic record persisted by `model.write-requirements@1`.
 *
 * This contract contains captured provider identities and reviewed values. It
 * does not authorize a provider call or infer a target from a label. Exact
 * keys always include the native RequirementUsage and ConstraintUsage
 * identities sealed at publication.
 */
export interface ExactRequirementsCaptureV3 extends RequirementsCaptureCommon {
  readonly schemaVersion: typeof REQUIREMENTS_CAPTURE_SCHEMA;
  readonly operation: typeof MODEL_WRITE_REQUIREMENTS_OPERATION;
  readonly insertedAt: string;
}

/**
 * Canonical semantic record persisted by `model.recapture-requirements@1`.
 *
 * Retains the exact 3.0 semantics plus predecessor identity, current
 * architecture, explicit recapture timestamp, and the newly observed native
 * subject UUID. That subject identity is not historically continuous with 3.0.
 */
export interface ExactRequirementsCaptureV4 extends RequirementsCaptureCommon {
  readonly schemaVersion: typeof REQUIREMENTS_RECAPTURE_SCHEMA;
  readonly operation: typeof MODEL_RECAPTURE_REQUIREMENTS_OPERATION;
  readonly capturedAt: string;
  readonly predecessor: RequirementsCaptureArtifactReference;
  readonly subject: RequirementsCaptureSubjectUsage;
}

/** Reviewed scalar requirements with exact immutable approved-brief origins. */
export interface ExactRequirementsCaptureV5 extends RequirementsCaptureCommon {
  readonly schemaVersion: typeof REQUIREMENTS_TRACED_CAPTURE_SCHEMA;
  readonly operation: typeof MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION;
  readonly insertedAt: string;
  readonly briefProvenance: RequirementsBriefProvenance;
}

/** Read-only recapture that preserves the traced predecessor's brief origins. */
export interface ExactRequirementsCaptureV6 extends RequirementsCaptureCommon {
  readonly schemaVersion: typeof REQUIREMENTS_TRACED_RECAPTURE_SCHEMA;
  readonly operation: typeof MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION;
  readonly capturedAt: string;
  readonly predecessor: RequirementsCaptureArtifactReference;
  readonly subject: RequirementsCaptureSubjectUsage;
  readonly briefProvenance: RequirementsBriefProvenance;
}

export type ExactRequirementsCapture =
  | ExactRequirementsCaptureV3
  | ExactRequirementsCaptureV4
  | ExactRequirementsCaptureV5
  | ExactRequirementsCaptureV6;

/**
 * Parse one current requirements capture fail-closed.
 *
 * Schemas 3.0 through 6.0 discriminate operation, producer, observed-at field
 * and mandatory brief provenance together. Historical 3.0/4.0 remain untraced;
 * older schemas and forged pairs are rejected.
 */
export function parseExactRequirementsCapture(
  value: unknown,
): ExactRequirementsCapture {
  const record = exactObject(value, "Requirements capture");
  if (record.schemaVersion === REQUIREMENTS_CAPTURE_SCHEMA) {
    return parseExactRequirementsCaptureV3(record);
  }
  if (record.schemaVersion === REQUIREMENTS_RECAPTURE_SCHEMA) {
    return parseExactRequirementsCaptureV4(record);
  }
  if (record.schemaVersion === REQUIREMENTS_TRACED_CAPTURE_SCHEMA) {
    return parseExactRequirementsCaptureV5(record);
  }
  if (record.schemaVersion === REQUIREMENTS_TRACED_RECAPTURE_SCHEMA) {
    return parseExactRequirementsCaptureV6(record);
  }
  throw new Error("Requirements capture schema is not exact.");
}

export function isWriteRequirementsCapture(
  capture: ExactRequirementsCapture,
): capture is ExactRequirementsCaptureV3 | ExactRequirementsCaptureV5 {
  return capture.schemaVersion === REQUIREMENTS_CAPTURE_SCHEMA ||
    capture.schemaVersion === REQUIREMENTS_TRACED_CAPTURE_SCHEMA;
}

export function isRecaptureRequirementsCapture(
  capture: ExactRequirementsCapture,
): capture is ExactRequirementsCaptureV4 | ExactRequirementsCaptureV6 {
  return capture.schemaVersion === REQUIREMENTS_RECAPTURE_SCHEMA ||
    capture.schemaVersion === REQUIREMENTS_TRACED_RECAPTURE_SCHEMA;
}

export function isTracedRequirementsCapture(
  capture: ExactRequirementsCapture,
): capture is ExactRequirementsCaptureV5 | ExactRequirementsCaptureV6 {
  return capture.schemaVersion === REQUIREMENTS_TRACED_CAPTURE_SCHEMA ||
    capture.schemaVersion === REQUIREMENTS_TRACED_RECAPTURE_SCHEMA;
}

/**
 * Keep a recapture inside the same provenance era as its exact requirements
 * predecessor.  This is deliberately a readback guard: parsing a capture in
 * isolation cannot establish the identity of the artifact it names.
 */
export function assertRequirementsRecaptureProvenanceContinuity(
  capture: ExactRequirementsCapture,
  predecessor: ExactRequirementsCapture,
): void {
  if (!isRecaptureRequirementsCapture(capture)) {
    throw new Error(
      "Requirements provenance continuity applies only to a recapture capture.",
    );
  }
  if (capture.schemaVersion === REQUIREMENTS_RECAPTURE_SCHEMA) {
    if (
      predecessor.schemaVersion !== REQUIREMENTS_CAPTURE_SCHEMA &&
      predecessor.schemaVersion !== REQUIREMENTS_RECAPTURE_SCHEMA
    ) {
      throw new Error(
        "Legacy requirements recapture cannot downgrade a traced predecessor.",
      );
    }
    return;
  }
  if (
    predecessor.schemaVersion !== REQUIREMENTS_TRACED_CAPTURE_SCHEMA &&
    predecessor.schemaVersion !== REQUIREMENTS_TRACED_RECAPTURE_SCHEMA
  ) {
    throw new Error(
      "Traced requirements recapture requires a traced predecessor provenance.",
    );
  }
  if (
    deterministicJson(capture.briefProvenance) !==
      deterministicJson(predecessor.briefProvenance)
  ) {
    throw new Error(
      "Traced requirements recapture brief provenance is not exactly continuous with its predecessor.",
    );
  }
}

/**
 * Reopen the complete V6 predecessor chain before a consumer relies on its
 * preserved brief origin.  V3/V4 remain readable historical evidence; only a
 * traced recapture claims this additional continuity invariant.
 */
export async function assertTracedRequirementsRecaptureThreadContinuity(
  capture: ExactRequirementsCapture,
  artifact: RequirementsCaptureThreadArtifact,
  artifacts: readonly RequirementsCaptureThreadArtifact[],
  captures: RequirementsCaptureTextReader,
): Promise<void> {
  if (capture.schemaVersion !== REQUIREMENTS_TRACED_RECAPTURE_SCHEMA) return;

  let currentCapture: ExactRequirementsCapture = capture;
  let currentArtifact = artifact;
  const visitedArtifactIds = new Set<string>();
  while (currentCapture.schemaVersion === REQUIREMENTS_TRACED_RECAPTURE_SCHEMA) {
    if (visitedArtifactIds.has(currentArtifact.id)) {
      throw new Error("Traced requirements recapture predecessor chain is cyclic.");
    }
    visitedArtifactIds.add(currentArtifact.id);
    const predecessorId = currentCapture.predecessor.artifactId;
    const predecessor = artifacts.find((candidate) => candidate.id === predecessorId);
    if (
      predecessorId === currentArtifact.id ||
      !currentArtifact.inputArtifactIds.includes(predecessorId) ||
      !predecessor ||
      predecessor.producer.runId !== currentCapture.predecessor.producerRunId ||
      !fingerprintsEqual(
        predecessor.fingerprint,
        currentCapture.predecessor.fingerprint,
      )
    ) {
      throw new Error(
        "Traced requirements recapture predecessor is not its exact Thread input.",
      );
    }
    let predecessorCapture: ExactRequirementsCapture;
    try {
      const text = await captures.read(predecessor.fingerprint);
      if (text === undefined) {
        throw new Error("capture is not durably readable");
      }
      predecessorCapture = parseExactRequirementsCapture(JSON.parse(text));
      if (deterministicJson(predecessorCapture) !== text) {
        throw new Error("capture bytes are not canonical JSON");
      }
      if (
        !fingerprintsEqual(
          await sha256Fingerprint(predecessorCapture),
          predecessor.fingerprint,
        )
      ) {
        throw new Error("capture bytes do not match the Thread fingerprint");
      }
    } catch (error) {
      throw new Error(
        `Traced requirements recapture predecessor capture is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      predecessor.producer.tool !==
        requirementsCaptureProducerTool(predecessorCapture) ||
      predecessorCapture.trustedRunId !== predecessor.producer.runId
    ) {
      throw new Error(
        "Traced requirements recapture predecessor producer is not the exact schema/operation pair.",
      );
    }
    assertRequirementsRecaptureProvenanceContinuity(
      currentCapture,
      predecessorCapture,
    );
    currentCapture = predecessorCapture;
    currentArtifact = predecessor;
  }
}

export interface RequirementsCaptureTextReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface RequirementsCaptureThreadArtifact {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producer: {
    readonly tool: string;
    readonly runId: string;
  };
  readonly inputArtifactIds: readonly string[];
}

/** Freshness timestamp sealed by the capture discriminant. */
export function requirementsCaptureObservedAt(
  capture: ExactRequirementsCapture,
): string {
  return isWriteRequirementsCapture(capture) ? capture.insertedAt : capture.capturedAt;
}

/** Honest Thread producer implied by the capture discriminant. */
export function requirementsCaptureProducerTool(
  capture: ExactRequirementsCapture,
):
  | typeof REQUIREMENTS_WRITE_PRODUCER_TOOL
  | typeof MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL
  | typeof REQUIREMENTS_TRACED_WRITE_PRODUCER_TOOL
  | typeof MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL {
  switch (capture.schemaVersion) {
    case REQUIREMENTS_CAPTURE_SCHEMA:
      return REQUIREMENTS_WRITE_PRODUCER_TOOL;
    case REQUIREMENTS_RECAPTURE_SCHEMA:
      return MODEL_RECAPTURE_REQUIREMENTS_PRODUCER_TOOL;
    case REQUIREMENTS_TRACED_CAPTURE_SCHEMA:
      return REQUIREMENTS_TRACED_WRITE_PRODUCER_TOOL;
    case REQUIREMENTS_TRACED_RECAPTURE_SCHEMA:
      return MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL;
  }
}

function parseExactRequirementsCaptureV5(
  record: Record<string, unknown>,
): ExactRequirementsCaptureV5 {
  const operation = parseOperation(
    record.operation,
    MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
  );
  const { briefProvenance: source, ...nativeRecord } = record;
  // Reuse the unchanged strict native-field parser only after proving @2.
  // This transient validation view is never published as historical evidence.
  const native = parseExactRequirementsCaptureV3({
    ...nativeRecord,
    operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
  });
  assertRequirementsNativeIdentitiesPairwiseDisjoint(native);
  const briefProvenance = parseCaptureBriefProvenance(source, native);
  return {
    ...native,
    schemaVersion: REQUIREMENTS_TRACED_CAPTURE_SCHEMA,
    operation,
    briefProvenance,
  };
}

function parseExactRequirementsCaptureV6(
  record: Record<string, unknown>,
): ExactRequirementsCaptureV6 {
  const operation = parseOperation(
    record.operation,
    MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
  );
  const { briefProvenance: source, ...nativeRecord } = record;
  const native = parseExactRequirementsCaptureV4({
    ...nativeRecord,
    operation: MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  });
  const briefProvenance = parseCaptureBriefProvenance(source, native);
  return {
    ...native,
    schemaVersion: REQUIREMENTS_TRACED_RECAPTURE_SCHEMA,
    operation,
    briefProvenance,
  };
}

function parseCaptureBriefProvenance(
  value: unknown,
  capture: RequirementsCaptureCommon,
): RequirementsBriefProvenance {
  const provenance = parseRequirementsBriefProvenance(value);
  const requirements = new Map(
    capture.requirements.map((requirement) => [requirement.id, requirement]),
  );
  if (
    provenance.requirements.length !== requirements.size ||
    capture.requirements.some((requirement) =>
      requirement.id !== requirement.metric ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(requirement.id)
    )
  ) {
    throw new Error(
      "briefProvenance must be bijective with the canonical captured requirement metrics.",
    );
  }
  const seen = new Set<string>();
  for (const source of provenance.requirements) {
    const requirement = requirements.get(source.requirementId);
    if (!requirement || seen.has(source.requirementId)) {
      throw new Error(
        "briefProvenance must be bijective with the canonical captured requirement metrics.",
      );
    }
    seen.add(source.requirementId);
    // parseCommon already proves the native constraints bijectively name these
    // same requirements. Never join origins by display name or UI slug.
    const normalised = normaliseThreshold(
      source.declaredThreshold.value,
      source.declaredThreshold.unit,
    );
    if (
      !Object.is(normalised.value, requirement.limit.value) ||
      normalised.unit !== requirement.limit.unit ||
      normalised.transformation !== source.transformation
    ) {
      throw new Error(
        `briefProvenance for ${source.requirementId} does not match the captured threshold, unit and transformation.`,
      );
    }
  }
  return provenance;
}

function parseExactRequirementsCaptureV3(
  record: Record<string, unknown>,
): ExactRequirementsCaptureV3 {
  exactKeys(
    record,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "containerComponent",
      "partDefName",
      "target",
      "architectureBasis",
      "requirements",
      "seed",
      "architecture",
      "requirementsElementId",
      "insertedAt",
      "requirementUsage",
      "constraintUsages",
    ],
    "Requirements capture",
  );
  const operation = parseOperation(
    record.operation,
    MODEL_WRITE_REQUIREMENTS_OPERATION,
  );
  const common = parseCommon(record);
  return {
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    operation,
    ...common,
    insertedAt: exactCanonicalInstant(record.insertedAt, "insertedAt"),
  };
}

function parseExactRequirementsCaptureV4(
  record: Record<string, unknown>,
): ExactRequirementsCaptureV4 {
  exactKeys(
    record,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "containerComponent",
      "partDefName",
      "target",
      "architectureBasis",
      "requirements",
      "seed",
      "architecture",
      "predecessor",
      "requirementsElementId",
      "capturedAt",
      "requirementUsage",
      "constraintUsages",
      "subject",
    ],
    "Requirements recapture",
  );
  const operation = parseOperation(
    record.operation,
    MODEL_RECAPTURE_REQUIREMENTS_OPERATION,
  );
  const common = parseCommon(record);
  const predecessor = parseArtifactReference(record.predecessor, "predecessor");
  if (predecessor.artifactId === common.architecture.artifactId) {
    throw new Error(
      "Requirements recapture predecessor must be distinct from the current architecture.",
    );
  }
  const subject = exactObject(record.subject, "Requirements recapture subject");
  exactKeys(
    subject,
    ["id", "kind", "name"],
    "Requirements recapture subject",
  );
  const subjectId = nonEmptyString(subject.id, "subject.id");
  if (subject.kind !== "ReferenceUsage" || subject.name !== "target") {
    throw new Error("subject must name the exact native target ReferenceUsage.");
  }
  assertRequirementsNativeIdentitiesPairwiseDisjoint(common, subjectId);
  return {
    schemaVersion: REQUIREMENTS_RECAPTURE_SCHEMA,
    operation,
    ...common,
    predecessor,
    capturedAt: exactCanonicalInstant(record.capturedAt, "capturedAt"),
    subject: { id: subjectId, kind: "ReferenceUsage", name: "target" },
  };
}

function assertRequirementsNativeIdentitiesPairwiseDisjoint(
  common: RequirementsCaptureCommon,
  subjectId?: string,
): void {
  const nativeIdentities = [
    common.target.elementId,
    common.requirementsElementId,
    ...(subjectId === undefined ? [] : [subjectId]),
    ...common.constraintUsages.map((constraint) => constraint.id),
  ];
  if (new Set(nativeIdentities).size !== nativeIdentities.length) {
    throw new Error(
      "target PartDefinition, RequirementUsage, subject when present and ConstraintUsage identities must be pairwise disjoint.",
    );
  }
}

function parseOperation<
  T extends { readonly id: string; readonly version: string },
>(
  value: unknown,
  expected: T,
): T {
  const operation = exactObject(value, "Requirements capture operation");
  exactKeys(operation, ["id", "version"], "Requirements capture operation");
  if (operation.id !== expected.id || operation.version !== expected.version) {
    throw new Error("Requirements capture operation is not exact.");
  }
  return expected;
}

function parseCommon(
  record: Record<string, unknown>,
): RequirementsCaptureCommon {
  const targetRecord = exactObject(record.target, "Requirements capture target");
  exactKeys(
    targetRecord,
    ["kind", "label", "elementId"],
    "Requirements capture target",
  );
  if (targetRecord.kind !== "part-definition") {
    throw new Error("Requirements capture target kind is not exact.");
  }
  const target: RequirementsTarget = {
    kind: "part-definition",
    label: nonEmptyString(targetRecord.label, "target.label"),
    elementId: nonEmptyString(targetRecord.elementId, "target.elementId"),
  };

  const basisRecord = exactObject(
    record.architectureBasis,
    "Requirements capture architectureBasis",
  );
  exactKeys(
    basisRecord,
    ["snapshotId", "revision", "fingerprint"],
    "Requirements capture architectureBasis",
  );
  if (!Number.isSafeInteger(basisRecord.revision)) {
    throw new Error("architectureBasis.revision must be a safe integer.");
  }
  const architectureBasis: RequirementsCaptureArchitectureBasis = {
    snapshotId: nonEmptyString(
      basisRecord.snapshotId,
      "architectureBasis.snapshotId",
    ),
    revision: basisRecord.revision as number,
    fingerprint: exactSha256Digest(
      basisRecord.fingerprint,
      "architectureBasis.fingerprint",
    ),
  };

  const requirements = parseRequirements(record.requirements);
  const requirementsElementId = nonEmptyString(
    record.requirementsElementId,
    "requirementsElementId",
  );
  const requirementUsage = exactObject(
    record.requirementUsage,
    "Requirements capture requirementUsage",
  );
  exactKeys(
    requirementUsage,
    ["id", "kind"],
    "Requirements capture requirementUsage",
  );
  const requirementUsageId = nonEmptyString(
    requirementUsage.id,
    "requirementUsage.id",
  );
  if (
    requirementUsage.kind !== "RequirementUsage" ||
    requirementUsageId !== requirementsElementId
  ) {
    throw new Error(
      "requirementUsage must name the exact captured RequirementUsage identity.",
    );
  }
  const constraintUsages = parseConstraintUsages(
    record.constraintUsages,
    requirements,
    requirementUsageId,
  );
  return {
    trustedRunId: nonEmptyString(record.trustedRunId, "trustedRunId"),
    containerComponent: nonEmptyString(
      record.containerComponent,
      "containerComponent",
    ),
    partDefName: nonEmptyString(record.partDefName, "partDefName"),
    target,
    architectureBasis,
    requirements,
    seed: parseArtifactReference(record.seed, "seed"),
    architecture: parseArtifactReference(record.architecture, "architecture"),
    requirementsElementId,
    requirementUsage: { id: requirementUsageId, kind: "RequirementUsage" },
    constraintUsages,
  };
}

function parseConstraintUsages(
  value: unknown,
  requirements: readonly OracleRequirement[],
  requirementUsageId: string,
): readonly RequirementsCaptureConstraintUsage[] {
  if (!Array.isArray(value) || value.length !== requirements.length) {
    throw new Error(
      "constraintUsages must contain exactly one identity per requirement.",
    );
  }
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const seenRequirementIds = new Set<string>();
  const seenElementIds = new Set<string>();
  const parsed = value.map((entry, index) => {
    const record = exactObject(
      entry,
      `Requirements capture constraintUsages[${index}]`,
    );
    exactKeys(
      record,
      ["requirementId", "id", "kind", "sourceId"],
      `Requirements capture constraintUsages[${index}]`,
    );
    const requirementId = nonEmptyString(
      record.requirementId,
      `constraintUsages[${index}].requirementId`,
    );
    const id = nonEmptyString(record.id, `constraintUsages[${index}].id`);
    const sourceId = nonEmptyString(
      record.sourceId,
      `constraintUsages[${index}].sourceId`,
    );
    if (record.kind !== "ConstraintUsage") {
      throw new Error(`constraintUsages[${index}].kind is not exact.`);
    }
    if (id !== sourceId) {
      throw new Error(
        `constraintUsages[${index}] id and sourceId must be identical.`,
      );
    }
    if (!requirementIds.has(requirementId) || seenRequirementIds.has(requirementId)) {
      throw new Error(
        "constraintUsages must be bijective with the captured requirements.",
      );
    }
    if (id === requirementUsageId || seenElementIds.has(id)) {
      throw new Error("constraintUsages contain a duplicate native SysON identity.");
    }
    seenRequirementIds.add(requirementId);
    seenElementIds.add(id);
    return { requirementId, id, kind: "ConstraintUsage" as const, sourceId };
  });
  if (seenRequirementIds.size !== requirementIds.size) {
    throw new Error(
      "constraintUsages must be bijective with the captured requirements.",
    );
  }
  const sorted = [...parsed].sort((left, right) =>
    compareText(left.requirementId, right.requirementId)
  );
  if (
    parsed.some((entry, index) => entry.requirementId !== sorted[index]!.requirementId)
  ) {
    throw new Error("constraintUsages must use canonical requirement-id order.");
  }
  return parsed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArtifactReference(
  value: unknown,
  path: "seed" | "architecture" | "predecessor",
): RequirementsCaptureArtifactReference {
  const record = exactObject(value, `Requirements capture ${path}`);
  exactKeys(
    record,
    ["artifactId", "fingerprint", "producerRunId"],
    `Requirements capture ${path}`,
  );
  return {
    artifactId: nonEmptyString(record.artifactId, `${path}.artifactId`),
    fingerprint: exactFingerprint(record.fingerprint, `${path}.fingerprint`),
    producerRunId: nonEmptyString(record.producerRunId, `${path}.producerRunId`),
  };
}

function parseRequirements(value: unknown): readonly OracleRequirement[] {
  if (!Array.isArray(value)) {
    throw new Error("Requirements capture requirements must be an array.");
  }
  if (value.length === 0) {
    throw new Error("The prior requirements capture contains no requirement.");
  }
  const requirements: OracleRequirement[] = [];
  const ids = new Set<string>();
  const metrics = new Set<string>();
  const allowedOperators: ReadonlySet<string> = new Set<string>(
    ORACLE_REQUIREMENT_OPERATORS,
  );
  for (let index = 0; index < value.length; index++) {
    const record = exactObject(
      value[index],
      `Prior requirements capture requirements[${index}]`,
    );
    exactKeys(
      record,
      ["id", "name", "metric", "operator", "limit"],
      `Prior requirements capture requirements[${index}]`,
    );
    if (
      typeof record.id !== "string" || !record.id.trim() ||
      typeof record.name !== "string" || !record.name.trim() ||
      typeof record.metric !== "string" || !record.metric.trim()
    ) {
      throw new Error(
        `Prior requirements capture requirements[${index}] missing required string fields (id, name, metric).`,
      );
    }
    if (
      typeof record.operator !== "string" ||
      !allowedOperators.has(record.operator)
    ) {
      throw new Error(
        `Prior requirements capture requirements[${index}].operator "${
          String(record.operator)
        }" is not a valid comparison operator.`,
      );
    }
    const limit = exactObject(
      record.limit,
      `Prior requirements capture requirements[${index}].limit`,
    );
    exactKeys(
      limit,
      ["value", "unit"],
      `Prior requirements capture requirements[${index}].limit`,
    );
    if (
      typeof limit.value !== "number" || !Number.isSafeInteger(limit.value) ||
      typeof limit.unit !== "string"
    ) {
      throw new Error(
        `Prior requirements capture requirements[${index}].limit is missing or has wrong types.`,
      );
    }
    if (!SUPPORTED_ORACLE_UNITS.includes(limit.unit)) {
      throw new Error(
        `Prior requirements capture requirements[${index}].limit.unit "${limit.unit}" is not in the supported vocabulary.`,
      );
    }
    if (ids.has(record.id) || metrics.has(record.metric)) {
      throw new Error(
        "The prior requirements capture repeats a requirement id or metric.",
      );
    }
    ids.add(record.id);
    metrics.add(record.metric);
    requirements.push({
      id: record.id,
      name: record.name,
      metric: record.metric,
      operator: record.operator as OracleRequirement["operator"],
      limit: { value: limit.value, unit: limit.unit },
    });
  }
  return requirements;
}

function exactObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${path} has non-exact fields.`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function exactFingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactObject(value, path);
  exactKeys(record, ["algorithm", "digest"], path);
  if (record.algorithm !== "sha256") {
    throw new Error(`${path}.algorithm must equal "sha256".`);
  }
  return {
    algorithm: "sha256",
    digest: exactSha256Digest(record.digest, `${path}.digest`),
  };
}

function exactSha256Digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function exactCanonicalInstant(value: unknown, path: string): string {
  if (
    typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${path} must be a canonical ISO instant.`);
  }
  return value;
}
