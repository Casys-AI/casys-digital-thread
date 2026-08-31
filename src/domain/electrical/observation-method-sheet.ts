/**
 * Closed `electrical-observation-method-sheet/1.0` declaration.
 *
 * Agent-authored project data. It may contain human-reviewed numeric
 * thresholds. It is not server configuration, admission, ngspice dispatch,
 * SysON, or an L4 verdict. Callers cannot inject extra fields.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { sha256Hex } from "../compile/source/provider-resource-reader.ts";
import { sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "./spice/admitted/run-proposal.ts";
import {
  collectNativeObservationNames,
  deriveExpressionUnit,
  type ElectricalObservationExpression,
  validateElectricalObservationExpression,
} from "./spice/evaluation/expression.ts";

export const ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA =
  "electrical-observation-method-sheet/1.0" as const;

export type ElectricalObservationMethodSheetSourceKind =
  | "human"
  | "document"
  | "expert"
  | "tool";

export type ElectricalObservationComparator =
  | "<="
  | ">="
  | "between-inclusive";

export type ElectricalObservationThresholdUnit = "V" | "A" | "W";

export interface ElectricalObservationMethodSheetSource {
  readonly id: string;
  readonly kind: ElectricalObservationMethodSheetSourceKind;
  readonly reference: string;
  readonly justification: string;
}

export interface ElectricalObservationQuantityLiteral {
  readonly value: number;
  readonly unit: ElectricalObservationThresholdUnit;
}

export interface ElectricalObservationMethodCriterion {
  readonly id: string;
  readonly sourceId: string;
  readonly briefItem: {
    readonly id: string;
    readonly kind: "success-criterion" | "verification-activity";
  };
  readonly comparator: ElectricalObservationComparator;
  readonly threshold?: ElectricalObservationQuantityLiteral;
  readonly bounds?: {
    readonly min: ElectricalObservationQuantityLiteral;
    readonly max: ElectricalObservationQuantityLiteral;
  };
  readonly expression: ElectricalObservationExpression;
}

export interface ElectricalObservationMethodSheetSpiceArtifact {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export interface ElectricalObservationMethodSheetSpiceBranch {
  readonly producer: {
    readonly serverId: "digital-thread";
    readonly tool:
      `${typeof SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${typeof SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}`;
    readonly runId: string;
  };
  readonly capture: ElectricalObservationMethodSheetSpiceArtifact;
  readonly evidence: ElectricalObservationMethodSheetSpiceArtifact;
  readonly result: ElectricalObservationMethodSheetSpiceArtifact;
}

export interface ElectricalObservationMethodSheet {
  readonly schemaVersion: typeof ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA;
  readonly id: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
  };
  readonly subject: { readonly id: string };
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly spice: ElectricalObservationMethodSheetSpiceBranch;
  readonly scope: string;
  readonly limitations: string;
  readonly sources: readonly ElectricalObservationMethodSheetSource[];
  readonly criteria: readonly ElectricalObservationMethodCriterion[];
  readonly review: {
    readonly authorId: string;
    readonly reviewedAt: string;
    readonly sealDecisionId: string;
  };
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "project",
  "subject",
  "basis",
  "spice",
  "scope",
  "limitations",
  "sources",
  "criteria",
  "review",
] as const;

const SOURCE_KINDS = ["human", "document", "expert", "tool"] as const;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ADMITTED_SPICE_TOOL =
  `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}` as const;

export function validateElectricalObservationMethodSheet(
  value: unknown,
): ElectricalObservationMethodSheet {
  const root = exactRecord(value, ROOT_KEYS, "$sheet");
  literalValue(
    root.schemaVersion,
    ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
    "$sheet.schemaVersion",
  );
  const projectInput = exactRecord(
    root.project,
    ["id", "subjectId"],
    "$sheet.project",
  );
  const subjectInput = exactRecord(root.subject, ["id"], "$sheet.subject");
  const basisInput = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$sheet.basis",
  );
  const reviewInput = exactRecord(
    root.review,
    ["authorId", "reviewedAt", "sealDecisionId"],
    "$sheet.review",
  );
  const sources = nonEmptyArray(root.sources, "$sheet.sources").map((item, index) =>
    parseSource(item, `$sheet.sources[${index}]`)
  );
  rejectDuplicates(sources.map((item) => item.id), "$sheet.sources");
  const sourceIds = new Set(sources.map((item) => item.id));
  const criteria = nonEmptyArray(root.criteria, "$sheet.criteria").map(
    (item, index) => parseCriterion(item, `$sheet.criteria[${index}]`, sourceIds),
  );
  rejectDuplicates(
    criteria.map((item) => item.id),
    "$sheet.criteria",
  );
  const sheet: ElectricalObservationMethodSheet = {
    schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SCHEMA,
    id: safeId(root.id, "$sheet.id"),
    project: {
      id: safeId(projectInput.id, "$sheet.project.id"),
      subjectId: safeId(projectInput.subjectId, "$sheet.project.subjectId"),
    },
    subject: { id: safeId(subjectInput.id, "$sheet.subject.id") },
    basis: {
      snapshotId: safeId(basisInput.snapshotId, "$sheet.basis.snapshotId"),
      revision: positiveInteger(basisInput.revision, "$sheet.basis.revision"),
      fingerprint: parseFingerprint(
        basisInput.fingerprint,
        "$sheet.basis.fingerprint",
      ),
    },
    spice: parseSpiceBranch(root.spice, "$sheet.spice"),
    scope: nonEmptyText(root.scope, "$sheet.scope"),
    limitations: nonEmptyText(root.limitations, "$sheet.limitations"),
    sources,
    criteria,
    review: {
      authorId: safeId(reviewInput.authorId, "$sheet.review.authorId"),
      reviewedAt: parseReviewedAt(
        reviewInput.reviewedAt,
        "$sheet.review.reviewedAt",
      ),
      sealDecisionId: safeId(
        reviewInput.sealDecisionId,
        "$sheet.review.sealDecisionId",
      ),
    },
  };
  if (sheet.project.subjectId !== sheet.subject.id) {
    throw new TypeError(
      "$sheet.project.subjectId must equal $sheet.subject.id.",
    );
  }
  return deepFreeze(sheet);
}

export function fingerprintElectricalObservationMethodSheet(
  sheet: ElectricalObservationMethodSheet,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(sheet);
}

export function methodSheetNativeObservationNames(
  sheet: ElectricalObservationMethodSheet,
): readonly string[] {
  const names = sheet.criteria.flatMap((criterion) =>
    collectNativeObservationNames(criterion.expression)
  );
  return deepFreeze([...new Set(names)].sort());
}

function parseSource(
  value: unknown,
  path: string,
): ElectricalObservationMethodSheetSource {
  const input = exactRecord(
    value,
    ["id", "kind", "reference", "justification"],
    path,
  );
  const kind = nonEmptyText(input.kind, `${path}.kind`);
  if (
    !SOURCE_KINDS.includes(kind as ElectricalObservationMethodSheetSourceKind)
  ) {
    throw new TypeError(`${path}.kind must be human, document, expert or tool.`);
  }
  return {
    id: safeId(input.id, `${path}.id`),
    kind: kind as ElectricalObservationMethodSheetSourceKind,
    reference: nonEmptyText(input.reference, `${path}.reference`),
    justification: nonEmptyText(input.justification, `${path}.justification`),
  };
}

function parseCriterion(
  value: unknown,
  path: string,
  sourceIds: ReadonlySet<string>,
): ElectricalObservationMethodCriterion {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const comparator = nonEmptyText(rec.comparator, `${path}.comparator`);
  if (comparator === "<=" || comparator === ">=") {
    const input = exactRecord(
      value,
      ["id", "sourceId", "briefItem", "comparator", "threshold", "expression"],
      path,
    );
    const expression = validateElectricalObservationExpression(
      input.expression,
      `${path}.expression`,
    );
    const threshold = parseQuantity(input.threshold, `${path}.threshold`);
    assertExpressionUnit(
      expression,
      threshold.unit,
      `${path}.expression`,
    );
    return {
      id: safeId(input.id, `${path}.id`),
      sourceId: requireSourceId(input.sourceId, `${path}.sourceId`, sourceIds),
      briefItem: parseBriefItem(input.briefItem, `${path}.briefItem`),
      comparator,
      threshold,
      expression,
    };
  }
  if (comparator === "between-inclusive") {
    const input = exactRecord(
      value,
      ["id", "sourceId", "briefItem", "comparator", "bounds", "expression"],
      path,
    );
    const expression = validateElectricalObservationExpression(
      input.expression,
      `${path}.expression`,
    );
    const boundsInput = exactRecord(
      input.bounds,
      ["min", "max"],
      `${path}.bounds`,
    );
    const min = parseQuantity(boundsInput.min, `${path}.bounds.min`);
    const max = parseQuantity(boundsInput.max, `${path}.bounds.max`);
    if (min.unit !== max.unit) {
      throw new TypeError(`${path}.bounds min and max units must match.`);
    }
    if (min.value > max.value) {
      throw new TypeError(
        `${path}.bounds.min.value must be <= ${path}.bounds.max.value.`,
      );
    }
    assertExpressionUnit(expression, min.unit, `${path}.expression`);
    return {
      id: safeId(input.id, `${path}.id`),
      sourceId: requireSourceId(input.sourceId, `${path}.sourceId`, sourceIds),
      briefItem: parseBriefItem(input.briefItem, `${path}.briefItem`),
      comparator: "between-inclusive",
      bounds: { min, max },
      expression,
    };
  }
  throw new TypeError(
    `${path}.comparator must be <=, >= or between-inclusive.`,
  );
}

function parseBriefItem(
  value: unknown,
  path: string,
): ElectricalObservationMethodCriterion["briefItem"] {
  const input = exactRecord(value, ["id", "kind"], path);
  const kind = nonEmptyText(input.kind, `${path}.kind`);
  if (kind !== "success-criterion" && kind !== "verification-activity") {
    throw new TypeError(
      `${path}.kind must be success-criterion or verification-activity.`,
    );
  }
  return {
    id: safeId(input.id, `${path}.id`),
    kind,
  };
}

function parseQuantity(
  value: unknown,
  path: string,
): ElectricalObservationQuantityLiteral {
  const input = exactRecord(value, ["value", "unit"], path);
  const unit = nonEmptyText(input.unit, `${path}.unit`);
  if (unit !== "V" && unit !== "A" && unit !== "W") {
    throw new TypeError(`${path}.unit must be V, A or W.`);
  }
  return {
    value: finite(input.value, `${path}.value`),
    unit,
  };
}

function requireSourceId(
  value: unknown,
  path: string,
  sourceIds: ReadonlySet<string>,
): string {
  const sourceId = safeId(value, path);
  if (!sourceIds.has(sourceId)) {
    throw new TypeError(`${path} "${sourceId}" is not in $sheet.sources.`);
  }
  return sourceId;
}

function assertExpressionUnit(
  expression: ElectricalObservationExpression,
  expected: ElectricalObservationThresholdUnit,
  path: string,
): void {
  const unit = deriveExpressionUnit(expression, path);
  if (unit !== expected) {
    throw new TypeError(
      `${path} unit ${unit} does not match comparator unit ${expected}.`,
    );
  }
}

function parseSpiceBranch(
  value: unknown,
  path: string,
): ElectricalObservationMethodSheetSpiceBranch {
  const input = exactRecord(
    value,
    ["producer", "capture", "evidence", "result"],
    path,
  );
  const producer = exactRecord(
    input.producer,
    ["serverId", "tool", "runId"],
    `${path}.producer`,
  );
  literalValue(producer.serverId, "digital-thread", `${path}.producer.serverId`);
  literalValue(producer.tool, ADMITTED_SPICE_TOOL, `${path}.producer.tool`);
  const capture = parseSpiceArtifact(
    input.capture,
    `${path}.capture`,
    "spice-admitted-capture-",
  );
  const evidence = parseSpiceArtifact(
    input.evidence,
    `${path}.evidence`,
    "spice-admitted-evidence-",
  );
  const result = parseSpiceArtifact(
    input.result,
    `${path}.result`,
    "spice-admitted-result-",
  );
  return {
    producer: {
      serverId: "digital-thread",
      tool: ADMITTED_SPICE_TOOL,
      runId: safeId(producer.runId, `${path}.producer.runId`),
    },
    capture,
    evidence,
    result,
  };
}

function parseSpiceArtifact(
  value: unknown,
  path: string,
  prefix: string,
): ElectricalObservationMethodSheetSpiceArtifact {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  const fingerprint = parseFingerprint(input.fingerprint, `${path}.fingerprint`);
  const id = safeId(input.id, `${path}.id`);
  if (id !== `${prefix}${fingerprint.digest}`) {
    throw new TypeError(`${path}.id must derive from its digest.`);
  }
  return { id, fingerprint };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  return {
    algorithm: "sha256",
    digest: sha256Hex(input.digest, `${path}.digest`),
  };
}

function parseReviewedAt(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!ISO_DATE_TIME.test(text)) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp.`);
  }
  return text;
}

export function criterionDeclaredUnit(
  criterion: ElectricalObservationMethodCriterion,
): ElectricalObservationThresholdUnit {
  if (criterion.comparator === "between-inclusive") {
    return criterion.bounds!.min.unit;
  }
  return criterion.threshold!.unit;
}
