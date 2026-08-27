/** Exact shared parser for generic `model.write-requirements@1` captures. */

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

/** Current capture: every native RequirementUsage/ConstraintUsage identity is sealed. */
export const REQUIREMENTS_CAPTURE_SCHEMA = "requirements-capture/3.0" as const;

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

/**
 * Canonical semantic record persisted by `model.write-requirements@1`.
 *
 * This contract contains captured provider identities and reviewed values. It
 * does not authorize a provider call or infer a target from a label. Exact
 * keys always include the native RequirementUsage and ConstraintUsage
 * identities sealed at publication.
 */
export interface ExactRequirementsCapture {
  readonly schemaVersion: typeof REQUIREMENTS_CAPTURE_SCHEMA;
  readonly operation: typeof MODEL_WRITE_REQUIREMENTS_OPERATION;
  readonly trustedRunId: string;
  readonly containerComponent: string;
  readonly partDefName: string;
  readonly target: RequirementsTarget;
  readonly architectureBasis: RequirementsCaptureArchitectureBasis;
  readonly requirements: readonly OracleRequirement[];
  readonly seed: RequirementsCaptureArtifactReference;
  readonly architecture: RequirementsCaptureArtifactReference;
  readonly requirementsElementId: string;
  readonly insertedAt: string;
  /** Exact native identity proved by element-get before capture publication. */
  readonly requirementUsage: {
    readonly id: string;
    readonly kind: "RequirementUsage";
  };
  /** One exact native ConstraintUsage identity per reviewed requirement. */
  readonly constraintUsages: readonly RequirementsCaptureConstraintUsage[];
}

/**
 * Parse one current requirements-capture/3.0 record fail-closed.
 *
 * This parser deliberately validates only the self-contained capture. Callers
 * remain responsible for binding its artifact, architecture basis, seed, and
 * projected Thread entities to independently re-read evidence. Older schemas
 * are rejected.
 */
export function parseExactRequirementsCapture(
  value: unknown,
): ExactRequirementsCapture {
  const record = exactObject(value, "Requirements capture");
  if (record.schemaVersion !== REQUIREMENTS_CAPTURE_SCHEMA) {
    throw new Error("Requirements capture schema is not exact.");
  }
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

  const operation = exactObject(record.operation, "Requirements capture operation");
  exactKeys(
    operation,
    ["id", "version"],
    "Requirements capture operation",
  );
  if (
    operation.id !== MODEL_WRITE_REQUIREMENTS_OPERATION.id ||
    operation.version !== MODEL_WRITE_REQUIREMENTS_OPERATION.version
  ) {
    throw new Error("Requirements capture operation is not exact.");
  }

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
  const common = {
    operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
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
    insertedAt: exactCanonicalInstant(record.insertedAt, "insertedAt"),
  };

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
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    ...common,
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
  path: "seed" | "architecture",
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
