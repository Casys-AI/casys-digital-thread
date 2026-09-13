/**
 * Read-only presentation model for the server-owned project response index
 * (`project-response/1.0`).
 *
 * The domain server computes every join. React only renders. Types come
 * exclusively from the shared application DTO; this module keeps only the
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
  ProjectResponseCorrespondence,
  ProjectResponseDiagnostic,
  ProjectResponseGap,
  ProjectResponseItem,
  ProjectResponseOrigin,
  ProjectResponseReadModel,
  ProjectResponseRequirementEvaluation,
  ProjectResponseRequirementEvidence,
  ProjectResponseStatus,
} from "../../../application/ports/in/project-response/project-response-read-model.ts";
import {
  parseProjectResponseBasis,
  PROJECT_RESPONSE_SCHEMA,
  projectResponseBasesEqual,
} from "../../../application/ports/in/project-response/project-response-read-model.ts";
import type { RequirementsBriefSourceImpactState } from "../../../domain/architecture/requirements/requirements-brief-impact.ts";
import type { ProjectBriefItem } from "../../../domain/project/project-brief.ts";
import type {
  ThreadFreshness,
  ThreadFreshnessStatus,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadGraphRef } from "../thread/types.ts";

export type {
  ProjectResponseApplicability,
  ProjectResponseBasis,
  ProjectResponseCorrespondence,
  ProjectResponseDiagnostic,
  ProjectResponseGap,
  ProjectResponseItem,
  ProjectResponseOrigin,
  ProjectResponseReadModel,
  ProjectResponseRequirementEvidence,
  ProjectResponseStatus,
} from "../../../application/ports/in/project-response/project-response-read-model.ts";
export { PROJECT_RESPONSE_SCHEMA } from "../../../application/ports/in/project-response/project-response-read-model.ts";

/** Alias kept for the existing row rendering names. */
export type ProjectResponseEvaluation = ProjectResponseRequirementEvaluation;

/** Default visibility shows every item; the gap view is opt-in, never hiding. */
export const DEFAULT_RESPONSE_FILTER = "all" as const;

export type ProjectResponseParseResult =
  | { readonly ok: true; readonly model: ProjectResponseReadModel }
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
  if (!isNonEmptyString(value.code) || typeof value.message !== "string") {
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
    !isNonEmptyString(value.id) || typeof value.kind !== "string" ||
    value.kind.length === 0 || typeof value.statement !== "string" ||
    (!Array.isArray(value.sourceRefs) ||
      !value.sourceRefs.every((source) =>
        isRecord(source) && isNonEmptyString(source.kind) &&
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
): ProjectResponseItem | undefined {
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
  if (issues.length !== before || !item || !gaps) return undefined;
  return {
    item,
    correspondence: value.correspondence as ProjectResponseCorrespondence,
    requirements,
    gaps,
  };
}

/**
 * Strictly validate an unknown BFF payload against `project-response/1.0`.
 * Never casts unknown data blindly: every literal, array and referenced
 * identity is checked, and the first structural defect rejects the payload
 * with an explicit issue list for the read state. The basis itself is
 * validated by the shared application parser.
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
  if (value.schemaVersion !== PROJECT_RESPONSE_SCHEMA) {
    issues.push(
      issue(
        "response.unsupported-schema",
        `schemaVersion must be ${PROJECT_RESPONSE_SCHEMA}.`,
      ),
    );
  }
  checkLiteral(value.status, STATUS, "status", issues);
  if (value.grants !== "none") {
    issues.push(issue("response.invalid-shape", `grants must be "none".`));
  }
  const items: ProjectResponseItem[] = [];
  if (!Array.isArray(value.items)) {
    issues.push(issue("response.invalid-shape", "items must be an array."));
  } else {
    for (const [index, entry] of value.items.entries()) {
      const parsed = parseResponseItem(entry, `items[${index}]`, issues);
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
  return {
    ok: true,
    model: {
      schemaVersion: PROJECT_RESPONSE_SCHEMA,
      status: value.status as ProjectResponseStatus,
      ...(basis ? { basis } : {}),
      items,
      diagnostics,
      grants: "none",
    },
  };
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
 * Bind a parsed index to its containing Project/Thread. Returns true when
 * there is nothing to bind (either side omits its basis) so the panel falls
 * back to its own basis provenance instead of refusing to render.
 */
export function isResponseBasisMatch(
  expected: ProjectResponseBasis | undefined,
  actual: ProjectResponseBasis | undefined,
): boolean {
  if (!expected || !actual) return true;
  return projectResponseBasesEqual(expected, actual);
}

/**
 * V1 is not a readiness calculator, so the focused view uses only explicit
 * server gap facts (`gaps`), never UI inference. A current fail or error
 * evaluation, an unresolved or historical record, and a documentary mapping
 * are display facts on their row, not filter signals: assumptions,
 * exclusions and open questions never automatically need solver evidence.
 */
export function hasResponseGap(item: ProjectResponseItem): boolean {
  return item.gaps.length > 0;
}

export function responseIndexSummary(model: ProjectResponseReadModel): string {
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
