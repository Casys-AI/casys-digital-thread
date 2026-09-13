/**
 * Read-only presentation model for the server-owned project response index
 * (`project-response/2.0`, with historical `project-response/1.0` accepted
 * as a distinct discriminator).
 *
 * The domain server computes every join. React only renders. Types come
 * exclusively from the shared domain contract; this module keeps only the
 * transport parser (which reports explicit UI read states instead of
 * throwing) and small pure presentation helpers (labels, gap detection,
 * exact evidence refs, basis binding).
 *
 * No aggregate verdict lives here: no readiness, no pass roll-up, no
 * coverage percentage, no clause-to-cost inference.
 */

import type {
  ProjectResponseApplicability,
  ProjectResponseBasis,
  ProjectResponseClauseResponse,
  ProjectResponseCorrespondence,
  ProjectResponseDiagnostic,
  ProjectResponseDocument,
  ProjectResponseGap,
  ProjectResponseItem,
  ProjectResponseOrigin,
  ProjectResponseRequirementEvaluation,
  ProjectResponseRequirementEvidence,
  ProjectResponseStatus,
  ProjectResponseV1Item,
} from "../../../domain/project/project-response.ts";
import {
  isProjectResponseV2,
  parseProjectResponseBasis,
  PROJECT_RESPONSE_SCHEMA,
  PROJECT_RESPONSE_SCHEMA_V1,
  projectResponseBasesEqual,
} from "../../../domain/project/project-response.ts";
import type { RequirementsBriefSourceImpactState } from "../../../domain/architecture/requirements/requirements-brief-impact.ts";
import {
  isProjectBriefItemKind,
  isProjectBriefSourceKind,
  type ProjectBriefItem,
} from "../../../domain/project/project-brief.ts";
import type {
  ThreadFreshness,
  ThreadFreshnessStatus,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadGraphRef } from "../thread/types.ts";

export type {
  ProjectResponseApplicability,
  ProjectResponseBasis,
  ProjectResponseClauseResponse,
  ProjectResponseCorrespondence,
  ProjectResponseDiagnostic,
  ProjectResponseDocument,
  ProjectResponseGap,
  ProjectResponseItem,
  ProjectResponseOrigin,
  ProjectResponseReadModel,
  ProjectResponseRequirementEvidence,
  ProjectResponseStatus,
  ProjectResponseV1Item,
  ProjectResponseV1ReadModel,
} from "../../../domain/project/project-response.ts";
export {
  isProjectResponseV2,
  PROJECT_RESPONSE_SCHEMA,
  PROJECT_RESPONSE_SCHEMA_V1,
} from "../../../domain/project/project-response.ts";

/** Alias kept for the existing row rendering names. */
export type ProjectResponseEvaluation = ProjectResponseRequirementEvaluation;

/** Default visibility shows every item; the gap view is opt-in, never hiding. */
export const DEFAULT_RESPONSE_FILTER = "all" as const;

export type ProjectResponseParseResult =
  | { readonly ok: true; readonly model: ProjectResponseDocument }
  | {
    readonly ok: false;
    readonly issues: readonly ProjectResponseDiagnostic[];
  };

const STATUS: readonly string[] = ["available", "unavailable", "unresolved"];
const CORRESPONDENCE: readonly string[] = [
  "native",
  "documentary",
  "unresolved",
  "TRACE GAP",
];
const ORIGIN: readonly string[] = ["native", "documentary"];
const APPLICABILITY: readonly string[] = [
  "current",
  "historical",
  "unresolved",
];
const EVALUATION_STATUS: readonly string[] = [
  "pass",
  "fail",
  "unresolved",
  "error",
];
const SOURCE_STATE: readonly string[] = [
  "unchanged",
  "changed",
  "removed",
  "brief-unavailable",
];
const FRESHNESS_STATUS: readonly ThreadFreshnessStatus[] = [
  "fresh",
  "stale",
  "running",
  "failed",
];
const FRESHNESS_KEYS: readonly string[] = [
  "status",
  "changedAt",
  "reason",
  "invalidatedByChangeIds",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string");
}

function issue(code: string, message: string): ProjectResponseDiagnostic {
  return { code, message };
}

function checkLiteral(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: ProjectResponseDiagnostic[],
): value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(
      issue(
        "response.invalid-literal",
        `${path} must be one of ${allowed.join(", ")}.`,
      ),
    );
    return false;
  }
  return true;
}

function checkGap(value: unknown): ProjectResponseGap | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.code) || !isNonEmptyString(value.message)) {
    return undefined;
  }
  return { code: value.code, message: value.message };
}

function parseGaps(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
): readonly ProjectResponseGap[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue("response.invalid-shape", `${path} must be an array.`));
    return undefined;
  }
  const parsed: ProjectResponseGap[] = [];
  for (const [index, entry] of value.entries()) {
    const item = checkGap(entry);
    if (!item) {
      issues.push(
        issue(
          "response.invalid-shape",
          `${path}[${index}] must have code and message.`,
        ),
      );
      return undefined;
    }
    parsed.push(item);
  }
  return parsed;
}

function parseBriefItem(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
): ProjectBriefItem | undefined {
  if (!isRecord(value)) {
    issues.push(issue("response.invalid-shape", `${path} must be an object.`));
    return undefined;
  }
  if (
    !isNonEmptyString(value.id) || !isProjectBriefItemKind(value.kind) ||
    typeof value.statement !== "string" ||
    (!Array.isArray(value.sourceRefs) ||
      !value.sourceRefs.every((source) =>
        isRecord(source) && isProjectBriefSourceKind(source.kind) &&
        isNonEmptyString(source.reference)
      ))
  ) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path} must carry exact id, kind, statement and sourceRefs.`,
      ),
    );
    return undefined;
  }
  return value as unknown as ProjectBriefItem;
}

function parseEvaluation(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
): ProjectResponseRequirementEvaluation | undefined {
  if (!isRecord(value)) {
    issues.push(issue("response.invalid-shape", `${path} must be an object.`));
    return undefined;
  }
  const before = issues.length;
  checkLiteral(value.status, EVALUATION_STATUS, `${path}.status`, issues);
  checkLiteral(
    value.applicability,
    APPLICABILITY,
    `${path}.applicability`,
    issues,
  );
  const freshness = parseFreshness(
    value.freshness,
    `${path}.freshness`,
    issues,
  );
  if (
    !isNonEmptyString(value.evaluationId) ||
    !isStringArray(value.observationIds) ||
    !isStringArray(value.evidenceArtifactIds) ||
    typeof value.evaluatedAt !== "string"
  ) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path} must carry evaluationId, observationIds, evidenceArtifactIds and evaluatedAt.`,
      ),
    );
  }
  if (issues.length !== before || !freshness) return undefined;
  return {
    evaluationId: value.evaluationId as string,
    status: value.status as ProjectResponseRequirementEvaluation["status"],
    applicability: value
      .applicability as ProjectResponseRequirementEvaluation["applicability"],
    observationIds: value.observationIds as readonly string[],
    evidenceArtifactIds: value.evidenceArtifactIds as readonly string[],
    evaluatedAt: value.evaluatedAt as string,
    freshness,
  };
}

/**
 * Canonical `ThreadFreshness` is an object, never a status string. A string
 * (or any other shape) is refused so stale/failed reasons stay visible
 * instead of collapsing into an unreadable label.
 */
function parseFreshness(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
): ThreadFreshness | undefined {
  if (!isRecord(value)) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path} must be a freshness object with status, changedAt and invalidatedByChangeIds.`,
      ),
    );
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!FRESHNESS_KEYS.includes(key)) {
      issues.push(
        issue(
          "response.invalid-shape",
          `${path} has unsupported field ${key}.`,
        ),
      );
      return undefined;
    }
  }
  const before = issues.length;
  checkLiteral(value.status, FRESHNESS_STATUS, `${path}.status`, issues);
  if (typeof value.changedAt !== "string" || value.changedAt.length === 0) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.changedAt must be a non-empty string.`,
      ),
    );
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.reason must be a string when present.`,
      ),
    );
  }
  if (
    (value.status === "stale" || value.status === "failed") &&
    !isNonEmptyString(value.reason)
  ) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.reason is required for ${value.status}.`,
      ),
    );
  }
  if (!isStringArray(value.invalidatedByChangeIds)) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.invalidatedByChangeIds must be an array of strings.`,
      ),
    );
  }
  if (issues.length !== before) return undefined;
  return {
    status: value.status as ThreadFreshnessStatus,
    changedAt: value.changedAt as string,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    invalidatedByChangeIds: value.invalidatedByChangeIds as readonly string[],
  };
}

function parseRequirement(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
): ProjectResponseRequirementEvidence | undefined {
  if (!isRecord(value)) {
    issues.push(issue("response.invalid-shape", `${path} must be an object.`));
    return undefined;
  }
  const before = issues.length;
  checkLiteral(value.origin, ORIGIN, `${path}.origin`, issues);
  checkLiteral(
    value.applicability,
    APPLICABILITY,
    `${path}.applicability`,
    issues,
  );
  checkLiteral(
    value.sourceState,
    SOURCE_STATE,
    `${path}.sourceState`,
    issues,
  );
  if (
    !isNonEmptyString(value.threadRequirementId) ||
    !isNonEmptyString(value.requirementsArtifactId) ||
    !isNonEmptyString(value.traceArtifactId) ||
    !isNonEmptyString(value.sourceItemId) || !Array.isArray(value.evaluations)
  ) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path} must carry exact requirement, artifact, trace and evaluation references.`,
      ),
    );
  }
  const sourceBrief = isRecord(value.sourceBrief) &&
      isNonEmptyString(value.sourceBrief.briefId) &&
      isNonEmptyString(value.sourceBrief.snapshotId) &&
      Number.isInteger(value.sourceBrief.revision)
    ? {
      briefId: value.sourceBrief.briefId as string,
      snapshotId: value.sourceBrief.snapshotId as string,
      revision: value.sourceBrief.revision as number,
    }
    : undefined;
  if (!sourceBrief) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.sourceBrief must carry briefId, snapshotId and revision.`,
      ),
    );
  }
  const evaluations: ProjectResponseRequirementEvaluation[] = [];
  if (Array.isArray(value.evaluations)) {
    for (const [index, entry] of value.evaluations.entries()) {
      const parsed = parseEvaluation(
        entry,
        `${path}.evaluations[${index}]`,
        issues,
      );
      if (!parsed) break;
      evaluations.push(parsed);
    }
  }
  if (issues.length !== before || !sourceBrief) return undefined;
  return {
    threadRequirementId: value.threadRequirementId as string,
    requirementsArtifactId: value.requirementsArtifactId as string,
    traceArtifactId: value.traceArtifactId as string,
    origin: value.origin as ProjectResponseOrigin,
    sourceBrief,
    sourceItemId: value.sourceItemId as string,
    sourceState: value
      .sourceState as ProjectResponseRequirementEvidence["sourceState"],
    applicability: value.applicability as ProjectResponseApplicability,
    evaluations,
  };
}

function parseResponseItem(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
  schemaVersion: string,
): ProjectResponseV1Item | ProjectResponseItem | undefined {
  if (!isRecord(value)) {
    issues.push(issue("response.invalid-shape", `${path} must be an object.`));
    return undefined;
  }
  const before = issues.length;
  checkLiteral(
    value.correspondence,
    CORRESPONDENCE,
    `${path}.correspondence`,
    issues,
  );
  const item = parseBriefItem(value.item, `${path}.item`, issues);
  const gaps = parseGaps(value.gaps, `${path}.gaps`, issues);
  const requirements: ProjectResponseRequirementEvidence[] = [];
  if (!Array.isArray(value.requirements)) {
    issues.push(
      issue("response.invalid-shape", `${path}.requirements must be an array.`),
    );
  } else {
    for (const [index, entry] of value.requirements.entries()) {
      const parsed = parseRequirement(
        entry,
        `${path}.requirements[${index}]`,
        issues,
      );
      if (!parsed) break;
      requirements.push(parsed);
    }
  }
  if (schemaVersion === PROJECT_RESPONSE_SCHEMA_V1) {
    if (Object.hasOwn(value, "clauseResponses")) {
      issues.push(
        issue(
          "response.invalid-shape",
          `${path}.clauseResponses is not a project-response/1.0 field.`,
        ),
      );
    }
    if (issues.length !== before || !item || !gaps) return undefined;
    return {
      item,
      correspondence: value.correspondence as ProjectResponseCorrespondence,
      requirements,
      gaps,
    };
  }
  const clauseResponses: ProjectResponseClauseResponse[] = [];
  if (!Array.isArray(value.clauseResponses)) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.clauseResponses must be an array.`,
      ),
    );
  } else {
    for (const [index, entry] of value.clauseResponses.entries()) {
      const parsed = parseClauseResponse(
        entry,
        `${path}.clauseResponses[${index}]`,
        issues,
      );
      if (!parsed) break;
      clauseResponses.push(parsed);
    }
  }
  if (issues.length !== before || !item || !gaps) return undefined;
  return {
    item,
    correspondence: value.correspondence as ProjectResponseCorrespondence,
    requirements,
    clauseResponses,
    gaps,
  };
}

function parseClauseResponse(
  value: unknown,
  path: string,
  issues: ProjectResponseDiagnostic[],
): ProjectResponseClauseResponse | undefined {
  if (!isRecord(value)) {
    issues.push(issue("response.invalid-shape", `${path} must be an object.`));
    return undefined;
  }
  const before = issues.length;
  checkLiteral(
    value.applicability,
    APPLICABILITY,
    `${path}.applicability`,
    issues,
  );
  checkLiteral(
    value.sourceState,
    SOURCE_STATE,
    `${path}.sourceState`,
    issues,
  );
  if (value.recordingStatus !== "proposal") {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.recordingStatus must be "proposal".`,
      ),
    );
  }
  if (value.authorKind !== "agent") {
    issues.push(
      issue("response.invalid-shape", `${path}.authorKind must be "agent".`),
    );
  }
  if (
    !isNonEmptyString(value.artifactId) ||
    !Number.isInteger(value.revision) ||
    !isNonEmptyString(value.sourceItemId) ||
    !isNonEmptyString(value.scope) ||
    !isNonEmptyString(value.answer) ||
    !Array.isArray(value.sourceRefs)
  ) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path} must carry exact artifact, brief item, scope, answer and source refs.`,
      ),
    );
  }
  const sourceBrief = isRecord(value.sourceBrief) &&
      isNonEmptyString(value.sourceBrief.briefId) &&
      isNonEmptyString(value.sourceBrief.snapshotId) &&
      Number.isInteger(value.sourceBrief.revision)
    ? {
      briefId: value.sourceBrief.briefId as string,
      snapshotId: value.sourceBrief.snapshotId as string,
      revision: value.sourceBrief.revision as number,
    }
    : undefined;
  if (!sourceBrief) {
    issues.push(
      issue(
        "response.invalid-shape",
        `${path}.sourceBrief must carry briefId, snapshotId and revision.`,
      ),
    );
  }
  if (issues.length !== before || !sourceBrief) return undefined;
  return {
    artifactId: value.artifactId as string,
    revision: value.revision as number,
    sourceItemId: value.sourceItemId as string,
    sourceBrief,
    sourceState: value
      .sourceState as ProjectResponseClauseResponse["sourceState"],
    applicability: value.applicability as ProjectResponseApplicability,
    recordingStatus: "proposal",
    authorKind: "agent",
    scope: value.scope as string,
    answer: value.answer as string,
    sourceRefs: (value.sourceRefs as readonly unknown[]).map((ref) => {
      const record = isRecord(ref) ? ref : {};
      return {
        kind: record
          .kind as ProjectResponseClauseResponse["sourceRefs"][number]["kind"],
        ...(typeof record.artifactId === "string"
          ? { artifactId: record.artifactId }
          : {}),
        ...(typeof record.uri === "string" ? { uri: record.uri } : {}),
      };
    }),
    ...(typeof value.predecessorArtifactId === "string"
      ? { predecessorArtifactId: value.predecessorArtifactId }
      : {}),
  };
}

/**
 * Strictly validate an unknown BFF payload as historical `project-response/1.0`
 * or current `project-response/2.0`. V1 remains closed: V2 fields are refused
 * rather than folded into the historical discriminator. V2 requires the
 * extended item fields. The first structural defect rejects the payload with
 * an explicit issue list. The basis itself is validated by the shared contract
 * parser.
 */
export function parseProjectResponse(
  value: unknown,
): ProjectResponseParseResult {
  const issues: ProjectResponseDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        issue("response.invalid-shape", "Response payload must be an object."),
      ],
    };
  }
  const schemaVersion = value.schemaVersion;
  if (
    schemaVersion !== PROJECT_RESPONSE_SCHEMA_V1 &&
    schemaVersion !== PROJECT_RESPONSE_SCHEMA
  ) {
    issues.push(
      issue(
        "response.unsupported-schema",
        `schemaVersion must be ${PROJECT_RESPONSE_SCHEMA_V1} or ${PROJECT_RESPONSE_SCHEMA}.`,
      ),
    );
  }
  checkLiteral(value.status, STATUS, "status", issues);
  if (value.grants !== "none") {
    issues.push(issue("response.invalid-shape", `grants must be "none".`));
  }
  const items: Array<ProjectResponseV1Item | ProjectResponseItem> = [];
  if (!Array.isArray(value.items)) {
    issues.push(issue("response.invalid-shape", "items must be an array."));
  } else {
    const itemSchema = typeof schemaVersion === "string"
      ? schemaVersion
      : PROJECT_RESPONSE_SCHEMA;
    for (const [index, entry] of value.items.entries()) {
      const parsed = parseResponseItem(
        entry,
        `items[${index}]`,
        issues,
        itemSchema,
      );
      if (!parsed) break;
      items.push(parsed);
    }
  }
  const diagnostics = parseGaps(value.diagnostics, "diagnostics", issues);
  let basis: ProjectResponseBasis | undefined;
  if (value.basis !== undefined) {
    try {
      basis = parseProjectResponseBasis(value.basis, "basis");
    } catch (error) {
      issues.push(
        issue(
          "response.invalid-shape",
          `basis is not a valid response basis: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  }
  if (issues.length > 0 || !diagnostics) {
    return { ok: false, issues };
  }
  const envelope = {
    status: value.status as ProjectResponseStatus,
    ...(basis ? { basis } : {}),
    diagnostics,
    grants: "none" as const,
  };
  if (schemaVersion === PROJECT_RESPONSE_SCHEMA_V1) {
    return {
      ok: true,
      model: {
        schemaVersion: PROJECT_RESPONSE_SCHEMA_V1,
        ...envelope,
        items: items as readonly ProjectResponseV1Item[],
      },
    };
  }
  return {
    ok: true,
    model: {
      schemaVersion: PROJECT_RESPONSE_SCHEMA,
      ...envelope,
      items: items as readonly ProjectResponseItem[],
    },
  };
}

/** Documentary answers exist only on the current V2 discriminator. */
export function clauseResponsesOn(
  model: ProjectResponseDocument,
  item: ProjectResponseV1Item | ProjectResponseItem,
): readonly ProjectResponseClauseResponse[] {
  if (!isProjectResponseV2(model)) return [];
  return (item as ProjectResponseItem).clauseResponses;
}

/**
 * Read the optional server-owned response field off an already resolved
 * workbench projection without touching presentation or server DTOs. Older
 * hosts omit the field; the caller preserves the old view in that case.
 */
export function selectWorkbenchProjectResponse(workbench: unknown): unknown {
  if (!isRecord(workbench)) return undefined;
  return workbench.response;
}

/**
 * Bind a parsed index to its containing Project/Thread. A host-supplied
 * expected basis requires the payload to name the same exact basis before
 * any evidence link can target the displayed Thread.
 */
export function isResponseBasisMatch(
  expected: ProjectResponseBasis | undefined,
  actual: ProjectResponseBasis | undefined,
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return projectResponseBasesEqual(expected, actual);
}

/**
 * V1 is not a readiness calculator, so the focused view uses only explicit
 * server gap facts (`gaps`), never UI inference. A current fail or error
 * evaluation, an unresolved or historical record, and a documentary mapping
 * are display facts on their row, not filter signals: assumptions,
 * exclusions and open questions never automatically need solver evidence.
 */
export function hasResponseGap(item: ProjectResponseV1Item): boolean {
  return item.gaps.length > 0;
}

export function responseIndexSummary(model: ProjectResponseDocument): string {
  const brief = model.basis?.brief;
  const basis = brief ? ` · brief approuvé r${brief.revision}` : "";
  const count = model.items.length === 1
    ? "1 élément"
    : `${model.items.length} éléments`;
  return `${count}${basis}`;
}

/** Exact evidence refs for one requirement row, in stable link order. */
export function requirementEvidenceRefs(
  requirement: ProjectResponseRequirementEvidence,
): readonly ThreadGraphRef[] {
  const refs: ThreadGraphRef[] = [
    { kind: "requirement", id: requirement.threadRequirementId },
    { kind: "artifact", id: requirement.traceArtifactId },
    { kind: "artifact", id: requirement.requirementsArtifactId },
  ];
  for (const evaluation of requirement.evaluations) {
    refs.push({ kind: "evaluation", id: evaluation.evaluationId });
    for (const id of evaluation.observationIds) {
      refs.push({ kind: "observation", id });
    }
    for (const id of evaluation.evidenceArtifactIds) {
      refs.push({ kind: "artifact", id });
    }
  }
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function correspondenceLabel(
  correspondence: ProjectResponseCorrespondence,
): string {
  switch (correspondence) {
    case "native":
      return "native";
    case "documentary":
      return "documentaire";
    case "unresolved":
      return "non résolu";
    case "TRACE GAP":
      return "TRACE GAP";
  }
}

export function applicabilityLabel(
  applicability: ProjectResponseApplicability,
): string {
  switch (applicability) {
    case "current":
      return "actuel";
    case "historical":
      return "historique";
    case "unresolved":
      return "non résolu";
  }
}

export function freshnessLabel(freshness: ThreadFreshness): string {
  return freshness.reason
    ? `${freshness.status} · ${freshness.reason}`
    : freshness.status;
}

export function sourceStateLabel(
  state: RequirementsBriefSourceImpactState,
): string {
  switch (state) {
    case "unchanged":
      return "inchangé";
    case "changed":
      return "modifié";
    case "removed":
      return "retiré";
    case "brief-unavailable":
      return "brief indisponible";
  }
}
